# Satoshi Quest Smart Contracts

## Project setup

1. yarn install
2. Install [rust](https://rustup.rs).
3. `cargo build --manifest-path scripts/whitelist-parser/Cargo.toml --release`
4. For running tests
   1. For integration (E2E) tests, set up Docker for hardhat node

           # This will build the hardhat node as a Dockerised environment -
           # necessary because of Hardhat bug: https://github.com/nomiclabs/hardhat/issues/1138
           docker build . -f Dockerfile.hh-node -t hh-node-local

   2. You must also build Dockerised versions of the `backend` code and the `shuffle-gen` code from the [backend repository](https://gitlab.com/blockvis/satoshiquest/satoshi-quest-backend). It includes the instructions.

## Deploy

1. Create a `.env` file by looking at the example file `.env.example`

### Rinkeby

2. Run `yarn stage-1:deploy-rinkeby`
3. Run `yarn stage-2:deploy-rinkeby`
1. Run `yarn stage-3:deploy-rinkeby`

### Mainnet:

2. Run `yarn stage-1:deploy-main`
3. Run `yarn stage-2:deploy-main`
1. Run `yarn stage-3:deploy-main`

### Mainnet:

2. Run `yarn stage-1:deploy-local`
3. Run `yarn stage-2:deploy-local`
1. Run `yarn stage-3:deploy-local`
