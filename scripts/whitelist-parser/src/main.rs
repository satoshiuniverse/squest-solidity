use serde_derive::{Deserialize, Serialize};
use serde_json::{self, json};
use std::path::PathBuf;
use structopt::StructOpt;

#[derive(StructOpt, Debug)]
#[structopt(name = "whitelist-constructor")]
struct Opt {
    /// Output file
    #[structopt(short, long, parse(from_os_str))]
    output: PathBuf,

    /// Output file
    #[structopt(short, long, parse(from_os_str))]
    input: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
struct RecordInput {
    address: String,
    cap: u32,
    partner: bool,
}

fn main() -> anyhow::Result<()> {
    let opt = Opt::from_args();
    let mut reader = csv::Reader::from_path(opt.input)?;
    let result = reader
        .deserialize()
        .into_iter()
        .map(|result| {
            let record: RecordInput = result.unwrap();
            record
        })
        .collect::<Vec<_>>();

    let result = json!({ "addresses": result });
    std::fs::write(opt.output, result.to_string())?;
    Ok(())
}
