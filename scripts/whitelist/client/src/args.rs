use std::{ffi::OsString, path::PathBuf};

use structopt::StructOpt;
use strum::VariantNames;
use strum_macros::*;

#[derive(EnumString, EnumVariantNames, Debug)]
#[strum(serialize_all = "kebab_case")]
pub enum Actions {
    DisableWhitelist,
    UpdateWhitelist,
}

/// A basic example
#[derive(StructOpt, Debug)]
#[structopt(name = "Client")]
pub struct Opt {
    #[structopt(
        long,
        possible_values = Actions::VARIANTS,
        case_insensitive = true,
    )]
    pub action: Actions,

    /// Output file
    #[structopt(short, long, parse(from_os_str), default_value = "./secret.json")]
    pub secret_file: PathBuf,
}
