use secp256k1::SecretKey;
use structopt::StructOpt;

use serde::Deserialize;
use std::str::FromStr;

use std::fs;
use web3::signing::SecretKeyRef;

mod actions;
mod args;
mod utils;

pub type NodeURL = String;
pub type LambdaURL = String;
pub type ContractAddress = String;
pub type SecretCookie = String;

#[derive(Deserialize)]
#[serde(rename_all(deserialize = "camelCase"))]
struct SecretFile {
    maintainer_secret_key: String,
    secret_cookie: SecretCookie,
    node_url: NodeURL,
    contract_address: ContractAddress,
    lambda_url: LambdaURL,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let opt = args::Opt::from_args();
    let secret = fs::read_to_string(opt.secret_file.to_str().unwrap()).unwrap();
    let secret =
        serde_json::from_str::<SecretFile>(&secret).expect("Could not deserialize secrets file!");

    let secret_key = SecretKey::from_str(&secret.maintainer_secret_key).unwrap();
    let secret_key = SecretKeyRef::new(&secret_key);
    let (contract, gas_price) = utils::selling_contract(&secret.contract_address, &secret.node_url).await;
    println!("lambda_url {:?}", &secret.lambda_url);
    match &opt.action {
        args::Actions::DisableWhitelist => actions::disable_whitelist(contract, secret_key, gas_price).await?,
        args::Actions::UpdateWhitelist => {
            actions::update_whitelist(
                contract,
                secret_key,
                &secret.secret_cookie,
                &secret.lambda_url,
                gas_price
            )
            .await?
        } // TODO: Change maintainer/ change vault && other utilities
    };
    Ok(())
}
