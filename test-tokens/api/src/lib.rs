pub mod consts;
pub mod error;
pub mod instruction;
pub mod sdk;
pub mod state;

pub mod prelude {
    pub use crate::consts::*;
    pub use crate::error::*;
    pub use crate::instruction::*;
    pub use crate::sdk::*;
    pub use crate::state::*;
}

use steel::*;

// TODO: update after first deploy
declare_id!("C3YBZVUriPRKb9RtDLrjVW4tvsN85gi9KQ7x2usx1xoF");
