# Satoshi Quest admin CLI

- Update whitelist (using google spreadsheets && web3-rust)
- Disable whitelist (using web3-rust)

## Build and Run

1. Install [rustup](https://rustup.rs/)


Adding Windows target (if compiling from Linux to Windows)

2. rustup target add x86_64-pc-windows-gnu
3. rustup toolchain install stable-x86_64-pc-windows-gnu

(You might also have to install `mingw64-gcc` packages for linking)

Building the CLI tool

1. Run `cargo build --release` (Linux) or `cargo build --release --target x86_64-pc-windows-gnu
` (Windows) This will take a while (only the first time)
5. `mv target/release/client .` or `mv target/x86_64-pc-windows-gnu/release/client .`

Set up the `secret.json` file according to the example `secret.json.example` file.

## Help screen

        ./client --help
