use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const H: &str = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

fn ctx(predecessor: usize, height: u64, ts_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(accounts(predecessor))
        .block_height(height)
        .block_timestamp(ts_ms * 1_000_000);
    testing_env!(b.build());
}

fn contract() -> Contract {
    ctx(0, 1, 1_000);
    Contract::new(accounts(0))
}

#[test]
fn starts_empty() {
    let c = contract();
    assert_eq!(c.read_anchor(), None);
    assert_eq!(c.get_owner(), accounts(0));
}

#[test]
fn owner_anchors_and_latest_replaces() {
    let mut c = contract();
    ctx(0, 10, 5_000);
    c.anchor(H.to_string(), 3);
    assert_eq!(
        c.read_anchor(),
        Some(Anchor { head_hash: H.to_string(), count: 3, block_height: 10, timestamp_ms: 5_000 })
    );
    let h2 = "f".repeat(64);
    ctx(0, 11, 6_000);
    c.anchor(h2.clone(), 4);
    let a = c.read_anchor().unwrap();
    assert_eq!((a.head_hash, a.count, a.block_height, a.timestamp_ms), (h2, 4, 11, 6_000));
}

#[test]
fn normalizes_prefix_and_case() {
    let mut c = contract();
    ctx(0, 2, 2_000);
    let a = c.anchor(format!("0x{}", H.to_uppercase()), 1);
    assert_eq!(a.head_hash, H);
}

#[test]
#[should_panic(expected = "only owner")]
fn rejects_non_owner() {
    let mut c = contract();
    ctx(1, 2, 2_000);
    c.anchor(H.to_string(), 1);
}

#[test]
#[should_panic(expected = "head_hash must be 32 bytes of hex")]
fn rejects_short_hash() {
    let mut c = contract();
    ctx(0, 2, 2_000);
    c.anchor("abcd".to_string(), 1);
}

#[test]
#[should_panic(expected = "head_hash must be 32 bytes of hex")]
fn rejects_non_hex() {
    let mut c = contract();
    ctx(0, 2, 2_000);
    c.anchor(format!("{}zz", &H[..62]), 1);
}

#[test]
#[should_panic(expected = "count must be > 0")]
fn rejects_zero_count() {
    let mut c = contract();
    ctx(0, 2, 2_000);
    c.anchor(H.to_string(), 0);
}
