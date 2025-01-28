use std::io::{self, BufRead};

use clap::{Parser, Subcommand};
use redis::{AsyncCommands, RedisResult};
use tracing::error;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::prelude::*;
use tracing_subscriber::{fmt::format::FmtSpan, EnvFilter};

use line_filter::conf::{Config, Dispatcher};

#[derive(Parser)]
#[command(version, about, long_about = None)]
struct Args {
    #[command(subcommand)]
    command: Commands,
}

/// 定义匹配模式
#[derive(Debug, Clone)]
enum MatchMode {
    And,
    Or,
}

/// 每个 --texts 参数解析后的结果
#[derive(Debug, Clone)]
struct TextsParam {
    mode: MatchMode,
    texts: Vec<String>,
}

/// 解析 --texts 的自定义函数
fn parse_texts(s: &str) -> Result<TextsParam, String> {
    // 期望格式: "and:abc,def" 或 "or:xx,yy"
    let (mode_str, text_str) = s
        .split_once(':')
        .ok_or_else(|| format!("无效的 --texts 格式: {s}, 应为 and:xx,yy 或 or:aa,bb"))?;

    // 解析 and/or
    let mode = match mode_str {
        "and" => MatchMode::And,
        "or" => MatchMode::Or,
        _ => return Err(format!("无效的匹配模式: {mode_str}, 只能是 and 或 or")),
    };

    // 拆分逗号分隔的匹配字符串
    let texts = text_str
        .split(',')
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect::<Vec<_>>();

    if texts.is_empty() {
        return Err("匹配字符串列表不能为空".to_string());
    }

    Ok(TextsParam { mode, texts })
}

#[derive(Subcommand)]
enum Commands {
    LineSpeed {
        #[arg(long, default_value = "redis://127.0.0.1:6379", help = "redis url, line speed mode only")]
        redis_url: String,

        #[arg(long, default_value = "line-speed", help = "redis topic, line speed mode only")]
        redis_topic: String,

        #[arg(long = "texts", value_parser = parse_texts)]
        texts: Vec<TextsParam>,
    },
    Decode {
        #[arg(short, long, default_value = "config.toml", help = "config file name")]
        config_file: String,

        #[arg(short, long, default_value = "line-filter.log", help = "log file path")]
        log_file: String,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    match args.command {
        Commands::LineSpeed {
            redis_url,
            redis_topic,
            texts,
        } => line_speed(&redis_url, &redis_topic, texts).await,
        Commands::Decode { config_file, log_file } => decode(config_file, log_file).await,
    }
}

async fn decode(config_file: String, log_file: String) -> Result<(), Box<dyn std::error::Error>> {
    let file_appender = RollingFileAppender::new(Rotation::DAILY, "", &log_file);
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let file_layer = tracing_subscriber::fmt::layer()
        .with_file(true)
        .with_line_number(true)
        .with_thread_ids(true)
        .with_thread_names(true)
        .with_span_events(FmtSpan::CLOSE)
        .with_writer(file_appender)
        .with_ansi(false);
    let stdout_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout)
        .with_span_events(FmtSpan::CLOSE)
        .with_writer(move || {
            struct Writer(std::io::Stdout);
            impl std::io::Write for Writer {
                fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
                    print!("\r");
                    self.0.write(buf)
                }
                fn flush(&mut self) -> io::Result<()> {
                    self.0.flush()
                }
            }
            Writer(std::io::stdout())
        });
    tracing_subscriber::registry().with(env_filter).with(file_layer).with(stdout_layer).init();

    let stdin = io::stdin();
    let reader = stdin.lock();

    let config = Config::load(&config_file)?;
    let dispatcher = Dispatcher::new(config_file, config).await?;

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            break;
        }
        if let Err(e) = dispatcher.process_message(&line).await {
            error!("Error processing message: {}", e);
        }
    }
    Ok(())
}

async fn publish(conn: &mut redis::aio::MultiplexedConnection, redis_url: &str, redis_topic: &str, line: &str) {
    let publish_result: RedisResult<String> = conn.publish(redis_topic, line).await;
    if let Err(e) = publish_result {
        error!("Failed to publish to redis ({}): {}", redis_url, e);
    }
}

fn is_match(line: &str, param: &TextsParam) -> bool {
    match param.mode {
        MatchMode::And => param.texts.iter().all(|t| line.contains(t)),
        MatchMode::Or => param.texts.iter().any(|t| line.contains(t)),
    }
}

/// Line seepd mode with just forwarding whatever received
async fn line_speed(redis_url: &str, redis_topic: &str, texts: Vec<TextsParam>) -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let reader = stdin.lock();

    let redis_client = redis::Client::open(redis_url)?;
    let mut conn = redis_client.get_multiplexed_async_connection().await?;

    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() {
            break;
        }
        if texts.is_empty() || texts.iter().any(|text| is_match(&line, text)) {
            publish(&mut conn, redis_url, redis_topic, &line).await;
        }
    }
    Ok(())
}
