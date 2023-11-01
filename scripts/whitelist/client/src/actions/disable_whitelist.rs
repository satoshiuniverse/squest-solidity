use reqwest::{cookie::Jar, Url};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use web3::{
    contract::{Contract, Options},
    signing::{self},
    transports::Http,
    types::{Address, U256},
};

use crate::{LambdaURL, SecretCookie};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all(serialize = "camelCase"))]
struct RowInfo {
    index: u32,
    address: Option<String>,
    approved: bool,
    synced: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all(serialize = "camelCase"))]
struct GETResponse {
    rows: Vec<RowInfo>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all(serialize = "camelCase"))]
struct PATCHData {
    rows: Vec<u32>,
}

pub async fn disable_whitelist(
    contract: Contract<Http>,
    secret_key: impl signing::Key,
    gas_price: U256,
) -> Result<(), Box<dyn std::error::Error>> {

    let _res = contract
        .signed_call_with_confirmations(
            "disableWhitelist",
            (),
            Options {
                gas_price: Some(gas_price),
                ..Options::default()
            },
            1,
            secret_key,
        )
        .await?;
    Ok(())
}
