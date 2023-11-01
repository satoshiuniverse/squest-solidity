use promptly::{prompt, prompt_default};
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
    tx_hash: String,
}

pub async fn update_whitelist(
    contract: Contract<Http>,
    secret_key: impl signing::Key,
    cookie: &SecretCookie,
    lambda_url: &LambdaURL,
    gas_price: U256,
) -> Result<(), Box<dyn std::error::Error>> {
    // ---------- Get the items from spreadsheets ---------- //
    let secret_cookie = cookie;
    let jar = Jar::default();
    let url = Url::from_str(&lambda_url)?;
    jar.add_cookie_str(secret_cookie, &url);
    let client = reqwest::Client::builder()
        .cookie_provider(jar.into())
        .build()?;

    println!("Connecting to the spreadsheet");
    let resp = client
        .get(url.clone())
        .send()
        .await
        .expect("Cannot connect to Google Cloud Function")
        .json::<GETResponse>()
        .await?;

    let mut errors = false;
    let addresses_to_update = resp
        .rows
        .into_iter()
        .filter_map(|e| match &e.address {
            Some(address) if !e.synced && e.approved => {
                let res = Address::from_str(address);
                match res {
                    Ok(res) => Some((res, e)),
                    Err(_) => {
                        errors = true;
                        println!(
                            "Invalid address {:?} specified on line {:}! Ignoring this line...",
                            e.address.unwrap_or("".to_owned()),
                            e.index + 2
                        );
                        return None;
                    }
                }
            }
            None => {
                println!(
                    "Address not available for row {:?}! Ignoring this line...",
                    e.index + 2
                );
                None
            }
            _ => None,
        })
        .take(10)
        .collect::<Vec<_>>();

    if errors {
        let mut response = prompt_default(
            "There are invalid addresses present. Do you wish to continue?",
            false,
        );

        while response.is_err() {
            response = prompt_default(
                "There are invalid addresses present. Do you wish to continue?",
                false,
            );
        }
        let response = response.unwrap();
        if !response {
            return Ok(());
        }
    }

    // ---------- Communicate with the SC ---------- //
    {
        let only_addresses = addresses_to_update.iter().map(|e| e.0).collect::<Vec<_>>();

        if only_addresses.len() == 0 {
            println!("Nothing to whitelist");
        } else {
            println!("Whitelisting addresses {:#?}", only_addresses);

            let gas_estimation = contract
                .estimate_gas(
                    "addBatchToWhitelist",
                    only_addresses.clone(),
                    secret_key.address(),
                    Options::default(),
                )
                .await
                .unwrap();

            println!("Gas estimation: {:#?}", gas_estimation);
            let receipt = contract
                .signed_call_with_confirmations(
                    "addBatchToWhitelist",
                    only_addresses,
                    Options {
                        gas: Some(gas_estimation),
                        gas_price: Some(gas_price),
                        ..Options::default()
                    },
                    1,
                    secret_key,
                )
                .await?;
            let tx_hash_string = format!("{:#?}", receipt.transaction_hash);
            let patch_body = PATCHData {
                rows: addresses_to_update.iter().map(|f| f.1.index).collect(),
                tx_hash: tx_hash_string,
            };

            println!("Updating the spreadsheet");
            let response = client
                .patch(url.clone())
                .json(&patch_body)
                .send()
                .await
                .expect("Cannot connect to Google Cloud Function");
            println!("{:?}", response.status());
        }
    }

    Ok(())
}
