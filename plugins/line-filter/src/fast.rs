use std::collections::HashMap;
use std::io::{self, BufRead};
use std::str::FromStr;
use std::time::{Duration, Instant};

use clap::Parser;
use redis::{AsyncCommands, RedisResult};

#[derive(Parser)]
#[command(version, about, long_about = None)]
struct Cli {
    #[arg(long, default_value = "redis://127.0.0.1:6379")]
    redis_url: String,

    #[arg(long = "match", value_parser = parse_match_pair)]
    matches: Vec<MatchPair>,
}

/// 单个缓存条目
struct CacheEntry {
    last_publish: Instant,
    rate_limit: Duration,
}

/// 每个匹配表达式的缓存表
struct PublishCache {
    entries: HashMap<String, CacheEntry>,
    rate_limit: Duration,
}

impl PublishCache {
    fn new(rate_limit_ms: u64) -> Self {
        Self {
            entries: HashMap::new(),
            rate_limit: Duration::from_millis(rate_limit_ms),
        }
    }

    fn can_publish(&mut self, icao24: &str) -> bool {
        let now = Instant::now();
        match self.entries.get(icao24) {
            Some(entry) if now.duration_since(entry.last_publish) < self.rate_limit => false,
            _ => {
                self.entries.insert(
                    icao24.to_string(),
                    CacheEntry {
                        last_publish: now,
                        rate_limit: self.rate_limit,
                    },
                );
                true
            }
        }
    }

    fn cleanup(&mut self) {
        let now = Instant::now();
        self.entries.retain(|_, entry| now.duration_since(entry.last_publish) < entry.rate_limit);
    }
}

#[derive(Debug, Clone)]
struct MatchPair {
    expression: MatchExpression,
    topic: String,
    rate_limit_ms: u64,
}

fn parse_match_pair(s: &str) -> Result<MatchPair, String> {
    // expr:::topic:::rate_limit_ms
    let parts: Vec<&str> = s.split(":::").collect();
    if parts.len() != 3 {
        return Err("Invalid format. Expected 'expression:::topic:::rate_limit_ms'".to_string());
    }

    let expr_str = parts[0];
    let topic = parts[1];
    let rate_limit = parts[2].parse::<u64>().map_err(|_| "Invalid rate limit value".to_string())?;

    if expr_str.trim().is_empty() {
        return Err("Expression cannot be empty".to_string());
    }
    if topic.trim().is_empty() {
        return Err("Topic cannot be empty".to_string());
    }

    Ok(MatchPair {
        expression: parse_expression(expr_str)?,
        topic: topic.trim().to_string(),
        rate_limit_ms: rate_limit,
    })
}

fn extract_string(line: &str, key: &str) -> Option<String> {
    let key_pattern = format!(r#""{key}":""#);
    let value_start = line.find(&key_pattern)? + key_pattern.len();
    let value_end = line[value_start..].find('"')?;
    Some(line[value_start..value_start + value_end].to_string())
}

fn extract_number<T: FromStr>(line: &str, key: &str) -> Option<T> {
    let key_pattern = format!(r#""{key}":"#);
    let value_start = line.find(&key_pattern)? + key_pattern.len();
    let rest = &line[value_start..];
    let value_end = rest.find(|c| c == ',' || c == '}').unwrap_or(rest.len());
    let value_str = &rest[..value_end];
    value_str.parse::<T>().ok()
}

struct MatcherWithCache {
    matcher: MatchPair,
    cache: PublishCache,
    cleanup_counter: usize,
}

impl MatcherWithCache {
    fn new(matcher: MatchPair) -> Self {
        Self {
            cache: PublishCache::new(matcher.rate_limit_ms),
            matcher,
            cleanup_counter: 0,
        }
    }

    async fn try_publish(&mut self, icao24: &str, line: &str, con: &mut redis::aio::MultiplexedConnection) -> RedisResult<()> {
        if self.matcher.rate_limit_ms == 0 {
            if evaluate_expression(line, &self.matcher.expression) {
                let _ = con.publish::<&std::string::String, &str, ()>(&self.matcher.topic, line).await;
            }
            return Ok(());
        }

        if evaluate_expression(line, &self.matcher.expression) && self.cache.can_publish(icao24) {
            let _ = con.publish::<&std::string::String, &str, ()>(&self.matcher.topic, line).await;
        }

        // 每处理1000次检查是否需要清理缓存
        self.cleanup_counter += 1;
        if self.cleanup_counter >= 1000 {
            self.cache.cleanup();
            self.cleanup_counter = 0;
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
enum MatchExpression {
    Text(String),
    And(Vec<MatchExpression>),
    Or(Vec<MatchExpression>),
    Not(Box<MatchExpression>),
}

fn parse_expression(s: &str) -> Result<MatchExpression, String> {
    let mut tokens = tokenize(s)?;
    tokens.reverse();
    parse_expr(&mut tokens)
}

fn tokenize(s: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut chars: Vec<char> = s.chars().collect();

    while !chars.is_empty() {
        while chars.first().map_or(false, |c| c.is_whitespace()) {
            chars.remove(0);
        }

        if chars.is_empty() {
            break;
        }

        match chars[0] {
            '(' | ')' => {
                tokens.push(chars.remove(0).to_string());
            }
            '"' => {
                chars.remove(0); // 移除开引号
                let mut text = String::new();
                while let Some(c) = chars.first() {
                    if *c == '"' {
                        chars.remove(0);
                        break;
                    }
                    text.push(chars.remove(0));
                }
                tokens.push(text);
            }
            _ => {
                let mut token = String::new();
                while let Some(c) = chars.first() {
                    if c.is_whitespace() || *c == '(' || *c == ')' {
                        break;
                    }
                    token.push(chars.remove(0));
                }
                if !token.is_empty() {
                    tokens.push(token);
                }
            }
        }
    }
    Ok(tokens)
}

fn parse_expr(tokens: &mut Vec<String>) -> Result<MatchExpression, String> {
    match tokens.pop() {
        None => Err("Unexpected end of expression".to_string()),
        Some(token) => {
            if token == "(" {
                // 读取操作符或文本
                let op = tokens.pop().ok_or("Expected operator or text after (")?;
                let mut exprs = Vec::new();

                match op.as_str() {
                    "AND" | "OR" => {
                        // 解析子表达式直到遇到右括号
                        while tokens.last().map_or(false, |t| t != ")") {
                            exprs.push(parse_expr(tokens)?);
                        }
                        // 移除右括号
                        tokens.pop();

                        if exprs.is_empty() {
                            return Err(format!("Empty {} expression", op));
                        }

                        match op.as_str() {
                            "AND" => Ok(MatchExpression::And(exprs)),
                            "OR" => Ok(MatchExpression::Or(exprs)),
                            _ => unreachable!(),
                        }
                    }
                    "NOT" => {
                        // NOT 只能有一个操作数
                        let expr = parse_expr(tokens)?;
                        match tokens.pop() {
                            Some(t) if t == ")" => Ok(MatchExpression::Not(Box::new(expr))),
                            _ => Err("Expected ) after NOT expression".to_string()),
                        }
                    }
                    _ => {
                        // 处理单个文本的情况：(text)
                        exprs.push(MatchExpression::Text(op));
                        while tokens.last().map_or(false, |t| t != ")") {
                            match tokens.pop() {
                                Some(text) => exprs.push(MatchExpression::Text(text)),
                                None => return Err("Unexpected end of expression".to_string()),
                            }
                        }
                        tokens.pop(); // 移除右括号

                        if exprs.len() == 1 {
                            Ok(exprs.pop().unwrap())
                        } else {
                            // 如果有多个文本，默认用 AND 连接
                            Ok(MatchExpression::And(exprs))
                        }
                    }
                }
            } else {
                Ok(MatchExpression::Text(token))
            }
        }
    }
}

fn evaluate_expression(text: &str, expr: &MatchExpression) -> bool {
    match expr {
        MatchExpression::Text(pattern) => text.contains(pattern),
        MatchExpression::And(expressions) => expressions.iter().all(|e| evaluate_expression(text, e)),
        MatchExpression::Or(expressions) => expressions.iter().any(|e| evaluate_expression(text, e)),
        MatchExpression::Not(expression) => !evaluate_expression(text, expression),
    }
}

#[tokio::main]
async fn main() -> RedisResult<()> {
    let cli = Cli::parse();
    let redis_client = redis::Client::open(cli.redis_url).unwrap();
    let mut conn = redis_client.get_multiplexed_async_connection().await?;

    let mut matchers: Vec<MatcherWithCache> = cli.matches.into_iter().map(MatcherWithCache::new).collect();

    let mut line = String::new();
    let stdin = io::stdin();
    let mut handle = stdin.lock();

    while handle.read_line(&mut line).unwrap() > 0 {
        {
            let line = line.trim();
            if !line.is_empty() {
                if let Some(icao24) = extract_string(line, "icao24") {
                    for matcher in &mut matchers {
                        let _ = matcher.try_publish(&icao24, line, &mut conn).await;
                    }
                }
            }
        }
        line.clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
        fn test_extract_string() {
            // 测试正常情况
            let input = r#"{"icao":"ABC123","other":"xyz"}"#;
            assert_eq!(extract_string(input, "icao"), Some("ABC123".to_string()));

            // 测试key不存在的情况
            assert_eq!(extract_string(input, "notexist"), None);

            // 测试空值的情况
            let input = r#"{"icao":"","other":"xyz"}"#;
            assert_eq!(extract_string(input, "icao"), Some("".to_string()));
        }

        #[test]
        fn test_extract_number() {
            // 测试整数
            let input = r#"{"value":123,"other":"xyz"}"#;
            assert_eq!(extract_number::<i32>(input, "value"), Some(123));

            // 测试浮点数
            let input = r#"{"value":123.45,"other":"xyz"}"#;
            assert_eq!(extract_number::<f64>(input, "value"), Some(123.45));

            // 测试key不存在的情况
            assert_eq!(extract_number::<i32>(input, "notexist"), None);

            // 测试无效数字格式
            let input = r#"{"value":"abc","other":"xyz"}"#;
            assert_eq!(extract_number::<i32>(input, "value"), None);
        }

    #[test]
    fn test_parse_match_pair_with_rate_limit() {
        let result = parse_match_pair("(AND error critical):::error-topic:::5").unwrap();
        assert_eq!(result.topic, "error-topic");
        assert_eq!(result.rate_limit_ms, 5);
    }

    #[test]
    fn test_publish_cache_with_different_limits() {
        let mut cache1 = PublishCache::new(1_000); // 1秒限制
        let mut cache2 = PublishCache::new(2_000); // 2秒限制

        // 测试不同的速率限制
        assert!(cache1.can_publish("test123"));
        assert!(cache2.can_publish("test123"));

        // 立即尝试
        assert!(!cache1.can_publish("test123"));
        assert!(!cache2.can_publish("test123"));

        // 等待1秒
        thread::sleep(Duration::from_secs(1));
        assert!(cache1.can_publish("test123")); // cache1应该可以发布
        assert!(!cache2.can_publish("test123")); // cache2还不能发布

        // 再等待1秒
        thread::sleep(Duration::from_secs(1));
        assert!(cache2.can_publish("test123")); // cache2现在可以发布
    }

    #[test]
    fn test_publish_cache() {
        let mut cache = PublishCache::new(1_000);

        assert!(cache.can_publish("test123")); // 第一次应该可以发布
        assert!(!cache.can_publish("test123")); // 立即尝试应该被限制
        assert!(cache.can_publish("other456")); // 不同的 icao24 应该可以发布

        // 等待超过限制时间后应该可以再次发布
        thread::sleep(Duration::from_millis(1_000));
        assert!(cache.can_publish("test123"));
    }

    #[test]
    fn test_invalid_match_pair() {
        assert!(parse_match_pair("(AND error critical)").is_err());
        assert!(parse_match_pair(":::topic").is_err());
        assert!(parse_match_pair("expr:::").is_err());
    }

    #[test]
    fn test_simple_text() {
        let result = parse_expression("(text)").unwrap();
        assert!(matches!(result, MatchExpression::Text(text) if text == "text"));
    }

    #[test]
    fn test_and_expression() {
        let result = parse_expression("(AND hello world)").unwrap();
        match result {
            MatchExpression::And(exprs) => {
                assert_eq!(exprs.len(), 2);
                assert!(matches!(&exprs[0], MatchExpression::Text(text) if text == "hello"));
                assert!(matches!(&exprs[1], MatchExpression::Text(text) if text == "world"));
            }
            _ => panic!("Expected And expression"),
        }
    }

    #[test]
    fn test_or_expression() {
        let result = parse_expression("(OR error warning critical)").unwrap();
        match result {
            MatchExpression::Or(exprs) => {
                assert_eq!(exprs.len(), 3);
                assert!(matches!(&exprs[0], MatchExpression::Text(text) if text == "error"));
                assert!(matches!(&exprs[1], MatchExpression::Text(text) if text == "warning"));
                assert!(matches!(&exprs[2], MatchExpression::Text(text) if text == "critical"));
            }
            _ => panic!("Expected Or expression"),
        }
    }

    #[test]
    fn test_not_expression() {
        let result = parse_expression("(NOT error)").unwrap();
        assert!(matches!(result, MatchExpression::Not(_)));
    }

    #[test]
    fn test_complex_expression() {
        let result = parse_expression("(AND error (OR warning critical) (NOT debug))").unwrap();
        match result {
            MatchExpression::And(exprs) => {
                assert_eq!(exprs.len(), 3);
                assert!(matches!(&exprs[0], MatchExpression::Text(text) if text == "error"));
                match &exprs[1] {
                    MatchExpression::Or(or_exprs) => {
                        assert_eq!(or_exprs.len(), 2);
                        assert!(matches!(&or_exprs[0], MatchExpression::Text(text) if text == "warning"));
                        assert!(matches!(&or_exprs[1], MatchExpression::Text(text) if text == "critical"));
                    }
                    _ => panic!("Expected Or expression"),
                }
                assert!(matches!(&exprs[2], MatchExpression::Not(_)));
            }
            _ => panic!("Expected And expression"),
        }
    }

    #[test]
    fn test_implicit_and() {
        let result = parse_expression("(text1 text2 text3)").unwrap();
        match result {
            MatchExpression::And(exprs) => {
                assert_eq!(exprs.len(), 3);
                assert!(matches!(&exprs[0], MatchExpression::Text(text) if text == "text1"));
                assert!(matches!(&exprs[1], MatchExpression::Text(text) if text == "text2"));
                assert!(matches!(&exprs[2], MatchExpression::Text(text) if text == "text3"));
            }
            _ => panic!("Expected And expression"),
        }
    }
}
