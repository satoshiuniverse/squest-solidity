use std::str::FromStr;

use web3::{contract::Contract, transports::Http, types::{H160, U256}};

use crate::{ContractAddress, NodeURL};

pub async fn selling_contract(contract_address: &ContractAddress, node_url: &NodeURL) -> (Contract<Http>, U256)  {
    let contract_address = H160::from_str(contract_address).unwrap();
    let abi_bytes = include_bytes!("assets/SellingController.json");

    println!("Connecting to the smart contract");
    let http = web3::transports::Http::new(node_url).expect("Could not connect to node");
    let web3 = web3::Web3::new(http);
    let price = web3.eth().gas_price().await.expect("Could not read suggested gas price from provider");
    let price = price + U256::from(price.as_u128() / 10); // Add 10% to the estimated gas price.
    println!("estimated gas price price {price}", price=price);
    let contract = Contract::from_json(web3.eth(), contract_address, abi_bytes).unwrap();
    (contract, price)
}
