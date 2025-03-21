use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use std::time::Instant;

use evalexpr::EvalexprError;
use notify::{RecursiveMode, Watcher};
use redis::{AsyncCommands, RedisResult};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{mpsc, RwLock};
use tokio::time::sleep;
use tracing::{debug, error, info};

use crate::eval::eval_on_flat_hash;
use crate::flatten::flatten_json;
use crate::unflatten::unflatten_json;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub default: DefaultConfig,
    pub rules: Vec<Rule>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DefaultConfig {
    pub redis_url: String,
    pub redis_topic: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Rule {
    pub expr: String,
    pub redis_url: Option<String>,
    pub redis_topic: Option<String>,

    #[serde(default)]
    pub include: Vec<String>, // 如果字段不存在则使用默认值（空 Vec）

    #[serde(default)]
    pub exclude: Vec<String>, // 如果字段不存在则使用默认值（空 Vec）
}

impl Rule {
    pub fn get_redis_url<'a>(&'a self, default: &'a str) -> &'a str {
        self.redis_url.as_deref().unwrap_or(default)
    }

    pub fn get_redis_topic<'a>(&'a self, default: &'a str) -> &'a str {
        self.redis_topic.as_deref().unwrap_or(default)
    }
}

impl Config {
    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: Config = toml::from_str(&content)?;
        Ok(config)
    }
}

#[derive(Debug, Clone)]
pub struct Dispatcher {
    config_path: String,
    config: Arc<RwLock<Config>>,
    redis_clients: Arc<RwLock<HashMap<String, redis::Client>>>,
}

impl Dispatcher {
    pub async fn new(config_path: String, config: Config) -> Result<Self, Box<dyn std::error::Error>> {
        let dispatcher = Arc::new(Self {
            config_path: config_path.clone(),
            config: Arc::new(RwLock::new(config.clone())),
            redis_clients: Arc::new(RwLock::new(Self::create_redis_clients(&config).await?)),
        });

        let watcher_path = std::path::Path::new(&config_path).parent().ok_or("Invalid config path")?.to_path_buf();

        let config_file = std::path::Path::new(&config_path)
            .file_name()
            .ok_or("Invalid config filename")?
            .to_str()
            .ok_or("Invalid config filename")?
            .to_string();

        let dispatcher_clone = Arc::clone(&dispatcher);
        let dispatcher_clone2 = Arc::clone(&dispatcher);

        let (tx, mut rx) = mpsc::channel(1);

        // 启动文件监听
        tokio::spawn(async move {
            let tx = tx.clone();
            let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                if let Ok(event) = res {
                    debug!("notified event: {:?}", event);
                    if let notify::EventKind::Modify(_) = event.kind {
                        // 检查是否是我们关注的配置文件
                        for path in event.paths.iter() {
                            if let Some(filename) = path.file_name() {
                                if filename.to_string_lossy() == config_file {
                                    let _ = tx.try_send(());
                                    info!("config reloading event sent");
                                    break;
                                }
                            }
                        }
                    }
                }
            })
            .unwrap();

            // 监听整个目录
            watcher.watch(&watcher_path, RecursiveMode::Recursive).unwrap();

            // 保持 watcher 存活
            info!("watching directory {:?} ...", watcher_path);
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });

        // 处理重载消息
        tokio::spawn(async move {
            let mut last_reload = Instant::now();

            while let Some(_) = rx.recv().await {
                if last_reload.elapsed() < Duration::from_secs(1) {
                    sleep(Duration::from_secs(1)).await;
                }

                if let Err(e) = dispatcher_clone.reload_config().await {
                    error!("Failed to reload config: {}", e);
                }
                last_reload = Instant::now();
            }
        });

        Ok((*dispatcher_clone2).clone())
    }

    // 创建Redis客户端的辅助方法
    async fn create_redis_clients(config: &Config) -> Result<HashMap<String, redis::Client>, Box<dyn std::error::Error>> {
        let mut redis_clients = HashMap::new();

        // 添加默认 Redis 客户端
        redis_clients.insert(config.default.redis_url.clone(), redis::Client::open(config.default.redis_url.as_str())?);

        // 添加规则中的 Redis 客户端（去重）
        for rule in &config.rules {
            if let Some(url) = &rule.redis_url {
                if !redis_clients.contains_key(url) {
                    redis_clients.insert(url.clone(), redis::Client::open(url.as_str())?);
                }
            }
        }

        Ok(redis_clients)
    }

    // 重新加载配置
    pub async fn reload_config(&self) -> Result<(), Box<dyn std::error::Error>> {
        info!("Reloading configuration from {}", self.config_path);

        // 加载新配置
        let new_config = Config::load(&self.config_path)?;

        // 创建新的Redis客户端
        let new_clients = Self::create_redis_clients(&new_config).await?;

        // 更新配置和客户端
        {
            let mut config = self.config.write().await;
            let mut clients = self.redis_clients.write().await;

            *config = new_config;
            *clients = new_clients;
        }

        info!("Configuration reloaded successfully");
        Ok(())
    }

    fn create_filtered_json(original: &HashMap<String, Value>, fields: &[String]) -> HashMap<String, Value> {
        let mut filtered_map = HashMap::new();
        for field in fields {
            if let Some(value) = original.get(field) {
                filtered_map.insert(field.clone(), value.clone());
            }
        }
        filtered_map
    }

    fn create_excluded_json(original: &HashMap<String, Value>, exclude_fields: &[String]) -> HashMap<String, Value> {
        let mut filtered_map = HashMap::new();
        'outer: for (key, value) in original {
            // 检查当前键是否是被排除的键的前缀
            for exclude in exclude_fields {
                if key == exclude || key.starts_with(&format!("{}.", exclude)) {
                    continue 'outer;
                }
            }
            filtered_map.insert(key.clone(), value.clone());
        }
        filtered_map
    }

    fn filter_json_fields(flattened: &HashMap<String, Value>, rule: &Rule) -> Result<String, Box<dyn std::error::Error>> {
        let filtered_map = if !rule.include.is_empty() {
            // include 不为空，按照 include 列表过滤
            Self::create_filtered_json(flattened, &rule.include)
        } else if !rule.exclude.is_empty() {
            // include 为空但 exclude 不为空，排除指定字段
            Self::create_excluded_json(flattened, &rule.exclude)
        } else {
            // 两者都为空，使用原始数据
            flattened.clone()
        };

        // 将过滤后的扁平 HashMap 重新构建为嵌套的 JSON
        let unflattened = unflatten_json(&filtered_map);
        Ok(serde_json::to_string(&unflattened)?)
    }

    pub async fn process_message(&self, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        let json: Value = serde_json::from_str(message)?;
        let mut flattened = HashMap::new();
        flatten_json(&json, "", &mut flattened);

        let config = self.config.read().await;
        let clients = self.redis_clients.read().await;

        for rule in &config.rules {
            let redis_url = rule.get_redis_url(&config.default.redis_url);
            let redis_topic = rule.get_redis_topic(&config.default.redis_topic);

            // fast path
            // if message.contains(r#""df":"17"#) {
            //     if let Some(client) = clients.get(redis_url) {
            //         let mut conn = client.get_multiplexed_async_connection().await?;
            //         let publish_result: RedisResult<String> = conn.publish(redis_topic, message).await;
            //         if let Err(e) = publish_result {
            //             error!("Failed to publish to redis ({}): {}", redis_url, e);
            //         }
            //     }
            //     continue;
            // }

            match eval_on_flat_hash(&flattened, &rule.expr) {
                Ok(result) if result => {
                    let filtered_message = Self::filter_json_fields(&flattened, rule)?;

                    if let Some(client) = clients.get(redis_url) {
                        let mut conn = client.get_multiplexed_async_connection().await?;
                        let publish_result: RedisResult<String> = conn.publish(redis_topic, &filtered_message).await;
                        if let Err(e) = publish_result {
                            error!("Failed to publish to redis ({}): {}", redis_url, e);
                        }
                    }
                }
                Ok(_) => {}
                Err(EvalexprError::VariableIdentifierNotFound(_)) => {} // no operator for this yet
                Err(e) => error!("Expression evaluation error: {}", e),
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Seek;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_config_loading() -> Result<(), Box<dyn std::error::Error>> {
        let config_content = r#"
               [default]
               redis_url = "redis://localhost:6379"
               redis_topic = "default-topic"

               [[rules]]
               expr = 'df == "21"'
               redis_url = "redis://192.168.11.37:6379"
               redis_topic = "just-a-topic"
               include = ["timestamp", "df", "icao24"]

               [[rules]]
               expr = "user.age > 20"
               redis_topic = "adult-users"
               include = ["timestamp", "icao24"]
           "#;

        let mut temp_file = NamedTempFile::new()?;
        write!(temp_file, "{}", config_content)?;

        let config = Config::load(temp_file.path().to_str().unwrap())?;

        assert_eq!(config.default.redis_url, "redis://localhost:6379");
        assert_eq!(config.default.redis_topic, "default-topic");
        assert_eq!(config.rules.len(), 2);

        let rule = &config.rules[0];
        assert_eq!(rule.expr, r#"df == "21""#);
        assert_eq!(rule.redis_url.as_deref(), Some("redis://192.168.11.37:6379"));
        assert_eq!(rule.redis_topic.as_deref(), Some("just-a-topic"));
        assert_eq!(rule.include, vec!["timestamp", "df", "icao24"]);

        let rule = &config.rules[1];
        assert_eq!(rule.expr, "user.age > 20");
        assert_eq!(rule.redis_url.as_deref(), None);
        assert_eq!(rule.redis_topic.as_deref(), Some("adult-users"));
        assert_eq!(rule.include, vec!["timestamp", "icao24"]);

        Ok(())
    }

    #[test]
    fn test_filter_json_fields() -> Result<(), Box<dyn std::error::Error>> {
        let input = json!({
            "user": {
                "name": "John",
                "age": 30,
                "address": {
                    "city": "New York",
                    "zip": "10001"
                }
            },
            "timestamp": "2024-01-22T10:00:00"
        });

        let mut flattened = HashMap::new();
        flatten_json(&input, "", &mut flattened);

        // 测试 include 过滤
        let rule_with_include = Rule {
            expr: "true".to_string(),
            redis_url: None,
            redis_topic: None,
            include: vec!["user.name".to_string(), "user.address.city".to_string()],
            exclude: vec![],
        };

        let result = Dispatcher::filter_json_fields(&flattened, &rule_with_include)?;
        let filtered: Value = serde_json::from_str(&result)?;
        let expected = json!({
            "user": {
                "name": "John",
                "address": {
                    "city": "New York"
                }
            }
        });
        assert_eq!(filtered, expected);

        // 测试 exclude 过滤
        let rule_with_exclude = Rule {
            expr: "true".to_string(),
            redis_url: None,
            redis_topic: None,
            include: vec![],
            exclude: vec!["user.address".to_string()],
        };

        let result = Dispatcher::filter_json_fields(&flattened, &rule_with_exclude)?;
        let filtered: Value = serde_json::from_str(&result)?;

        println!("Filtered JSON with exclude: {}", serde_json::to_string_pretty(&filtered)?);

        let expected = json!({
            "user": {
                "name": "John",
                "age": 30
            },
            "timestamp": "2024-01-22T10:00:00"
        });
        assert_eq!(filtered, expected);

        // 测试全部保留（include 和 exclude 都为空）
        let rule_keep_all = Rule {
            expr: "true".to_string(),
            redis_url: None,
            redis_topic: None,
            include: vec![],
            exclude: vec![],
        };

        let result = Dispatcher::filter_json_fields(&flattened, &rule_keep_all)?;
        let filtered: Value = serde_json::from_str(&result)?;
        assert_eq!(filtered, input);

        Ok(())
    }

    #[test]
    fn test_rule_defaults() {
        let rule = Rule {
            expr: "test".to_string(),
            redis_url: None,
            redis_topic: None,
            include: vec![],
            exclude: vec![],
        };

        assert_eq!(rule.get_redis_url("default_url"), "default_url");
        assert_eq!(rule.get_redis_topic("default_topic"), "default_topic");

        let rule = Rule {
            expr: "test".to_string(),
            redis_url: Some("custom_url".to_string()),
            redis_topic: Some("custom_topic".to_string()),
            include: vec![],
            exclude: vec![],
        };

        assert_eq!(rule.get_redis_url("default_url"), "custom_url");
        assert_eq!(rule.get_redis_topic("default_topic"), "custom_topic");
    }

    #[tokio::test]
    async fn test_config_reload() -> Result<(), Box<dyn std::error::Error>> {
        // 创建临时配置文件
        let mut temp_file = NamedTempFile::new()?;
        let initial_config = r#"
               [default]
               redis_url = "redis://localhost:6379"
               redis_topic = "default-topic"

               [[rules]]
               expr = "value == 1"
               redis_topic = "topic-1"
           "#;
        write!(temp_file, "{}", initial_config)?;

        // 创建 Dispatcher
        let config = Config::load(temp_file.path().to_str().unwrap())?;
        let dispatcher = Dispatcher::new(temp_file.path().to_str().unwrap().to_string(), config).await?;

        // 验证初始配置
        {
            let config = dispatcher.config.read().await;
            assert_eq!(config.rules.len(), 1);
            assert_eq!(config.rules[0].expr, "value == 1");
        }

        // 重写配置文件内容
        let new_config = r#"
               [default]
               redis_url = "redis://localhost:6379"
               redis_topic = "default-topic"

               [[rules]]
               expr = "value == 1"
               redis_topic = "topic-1"

               [[rules]]
               expr = "value == 2"
               redis_topic = "topic-2"
           "#;
        temp_file.rewind()?;
        std::io::Write::write_all(&mut temp_file, new_config.as_bytes())?;
        temp_file.flush()?;

        // 重新加载配置
        dispatcher.reload_config().await?;

        // 验证新配置
        {
            let config = dispatcher.config.read().await;
            assert_eq!(config.rules.len(), 2);
            assert_eq!(config.rules[1].expr, "value == 2");
        }

        Ok(())
    }
}
