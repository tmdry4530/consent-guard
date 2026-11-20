//! Consent Guard anchor contract.
//!
//! Stores the single latest head hash of the off-chain consent ledger (a sha256
//! hash chain of `LedgerEvent`s) together with the number of events it covers and
//! the block it was anchored in. Anyone can read it; only the owner can update it.

use near_sdk::{env, near, require, AccountId, PanicOnDefault};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Anchor {
    /// sha256 of the last ledger event: 64 lowercase hex chars, no 0x
    pub head_hash: String,
    /// number of ledger events covered by `head_hash` (last seq + 1)
    pub count: u64,
    pub block_height: u64,
    pub timestamp_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    latest: Option<Anchor>,
}

/// Accepts 64 hex chars with an optional 0x/0X prefix; returns lowercase hex without prefix.
fn normalize_head_hash(raw: &str) -> String {
    let s = raw
        .strip_prefix("0x")
        .or_else(|| raw.strip_prefix("0X"))
        .unwrap_or(raw);
    require!(
        s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()),
        "head_hash must be 32 bytes of hex (64 hex chars, optional 0x)"
    );
    s.to_ascii_lowercase()
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self { owner, latest: None }
    }

    /// Owner only. Replaces the latest anchor and returns it.
    pub fn anchor(&mut self, head_hash: String, count: u64) -> Anchor {
        require!(env::predecessor_account_id() == self.owner, "only owner");
        require!(count > 0, "count must be > 0");
        let a = Anchor {
            head_hash: normalize_head_hash(&head_hash),
            count,
            block_height: env::block_height(),
            timestamp_ms: env::block_timestamp_ms(),
        };
        env::log_str(&format!("anchor {} count {}", a.head_hash, a.count));
        self.latest = Some(a.clone());
        a
    }

    pub fn read_anchor(&self) -> Option<Anchor> {
        self.latest.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[cfg(test)]
mod tests;
