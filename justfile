default:
    @just --list

# Auto-format the source tree
fmt:
    treefmt

# Run 'cargo run' on the project
run *ARGS:
    cargo run {{ARGS}}

# Run 'cargo watch' to run the project (auto-recompiles)
watch *ARGS:
    cargo watch -x "run -- {{ARGS}}"


# run example server
server:
    watchexec -w . -r -n -c -- RUST_LOG=debug cargo run --example server

wd:
  watchexec -w . -e rs -r -- RUST_LOG=debug cargo run --bin wd -- --redis-url redis://192.168.11.37:6379 --redis-topic streaing:data
