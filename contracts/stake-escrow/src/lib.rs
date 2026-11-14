//! Argue Rock stake escrow.
//!
//! Two debaters each stake the same amount of NEAR on a debate. When the debate has a final verdict, the judge
//! account (the Argue Rock server, acting only after a person approves the settlement) calls `settle`.
//!
//! The judge decides *who* wins, but this contract limits *what* the judge can do with the money:
//! - it can pay the whole pot to side A's staker or side B's staker, or refund both. Nobody else, ever.
//! - it can settle a debate once.
//! - if the judge never settles, anyone can call `refund` after the refund window and both stakers get their
//!   NEAR back.
//!
//! The verdict hash (sha256 of the stored verdict) is written on-chain with the settlement, so anyone can check
//! that the payout matches the verdict the app shows.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// Smallest stake accepted (0.01 NEAR).
pub const MIN_STAKE: NearToken = NearToken::from_millinear(10);
/// Largest stake accepted (10 NEAR). This is a demo on testnet; the cap keeps mistakes small.
pub const MAX_STAKE: NearToken = NearToken::from_near(10);

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    A,
    B,
}

/// What the judge reports. "Inconclusive" verdicts are never settled: they wait for a person.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    A,
    B,
    Draw,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Open,
    Settled,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pool {
    /// Stake each side must put in. Set by the first staker.
    pub stake: NearToken,
    pub side_a: Option<AccountId>,
    pub side_b: Option<AccountId>,
    pub opened_at_ms: u64,
    pub status: Status,
    pub outcome: Option<Outcome>,
    /// sha256 of the verdict record, hex. Written by `settle`.
    pub verdict_hash: Option<String>,
    /// Who received the pot (None for refunds).
    pub paid_to: Option<AccountId>,
    pub paid_amount: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct StakeEscrow {
    judge: AccountId,
    refund_after_ms: u64,
    pools: LookupMap<String, Pool>,
}

#[near(serializers = [json])]
pub struct Config {
    pub judge: AccountId,
    pub refund_after_ms: u64,
    pub min_stake: NearToken,
    pub max_stake: NearToken,
}

#[near]
impl StakeEscrow {
    #[init]
    pub fn new(judge: AccountId, refund_after_ms: u64) -> Self {
        Self { judge, refund_after_ms, pools: LookupMap::new(b"p") }
    }

    /// Stake on one side of a debate. The attached deposit is the stake.
    /// The first staker sets the amount; the other side must match it exactly.
    #[payable]
    pub fn stake(&mut self, debate_id: String, side: Side) -> Pool {
        require!(!debate_id.is_empty() && debate_id.len() <= 64, "debate_id must be 1-64 characters");
        let deposit = env::attached_deposit();
        let staker = env::predecessor_account_id();
        require!(staker != self.judge, "the judge cannot stake");

        let mut pool = match self.pools.get(&debate_id) {
            Some(existing) => existing.clone(),
            None => {
                require!(deposit >= MIN_STAKE && deposit <= MAX_STAKE, "stake must be between 0.01 and 10 NEAR");
                Pool {
                    stake: deposit,
                    side_a: None,
                    side_b: None,
                    opened_at_ms: env::block_timestamp_ms(),
                    status: Status::Open,
                    outcome: None,
                    verdict_hash: None,
                    paid_to: None,
                    paid_amount: NearToken::from_yoctonear(0),
                }
            }
        };

        require!(pool.status == Status::Open, "this debate's stakes are already closed");
        require!(deposit == pool.stake, "deposit must equal the stake the other side put in");
        let (mine, other) = match side {
            Side::A => (&pool.side_a, &pool.side_b),
            Side::B => (&pool.side_b, &pool.side_a),
        };
        require!(mine.is_none(), "that side already has a stake");
        require!(other.as_ref() != Some(&staker), "you cannot stake on both sides");

        match side {
            Side::A => pool.side_a = Some(staker),
            Side::B => pool.side_b = Some(staker),
        }
        self.pools.insert(debate_id, pool.clone());
        pool
    }

    /// Judge only. Pays the pot to the winner, or refunds both on a draw.
    /// If only one side ever staked, that stake is refunded whatever the outcome.
    pub fn settle(&mut self, debate_id: String, outcome: Outcome, verdict_hash: String) -> Pool {
        require!(env::predecessor_account_id() == self.judge, "only the judge can settle");
        require!(
            verdict_hash.len() == 64 && verdict_hash.chars().all(|c| c.is_ascii_hexdigit()),
            "verdict_hash must be a sha256 hex string"
        );
        let mut pool = self.pools.get(&debate_id).cloned().unwrap_or_else(|| env::panic_str("no stakes on this debate"));
        require!(pool.status == Status::Open, "already settled or refunded");

        pool.outcome = Some(outcome);
        pool.verdict_hash = Some(verdict_hash);

        match (pool.side_a.clone(), pool.side_b.clone(), outcome) {
            (Some(a), Some(_), Outcome::A) => Self::pay(&mut pool, a),
            (Some(_), Some(b), Outcome::B) => Self::pay(&mut pool, b),
            _ => Self::refund_all(&mut pool),
        }
        self.pools.insert(debate_id, pool.clone());
        pool
    }

    /// Anyone. After the refund window, an unsettled debate refunds both stakers.
    pub fn refund(&mut self, debate_id: String) -> Pool {
        let mut pool = self.pools.get(&debate_id).cloned().unwrap_or_else(|| env::panic_str("no stakes on this debate"));
        require!(pool.status == Status::Open, "already settled or refunded");
        let unlocks_at = pool.opened_at_ms.saturating_add(self.refund_after_ms);
        require!(env::block_timestamp_ms() >= unlocks_at, "the refund window has not opened yet");
        Self::refund_all(&mut pool);
        self.pools.insert(debate_id, pool.clone());
        pool
    }

    pub fn get_pool(&self, debate_id: String) -> Option<Pool> {
        self.pools.get(&debate_id).cloned()
    }

    pub fn get_config(&self) -> Config {
        Config { judge: self.judge.clone(), refund_after_ms: self.refund_after_ms, min_stake: MIN_STAKE, max_stake: MAX_STAKE }
    }

    fn pay(pool: &mut Pool, to: AccountId) {
        let pot = pool.stake.saturating_mul(2);
        pool.status = Status::Settled;
        pool.paid_to = Some(to.clone());
        pool.paid_amount = pot;
        Promise::new(to).transfer(pot).detach();
    }

    fn refund_all(pool: &mut Pool) {
        let mut total = NearToken::from_yoctonear(0);
        for acct in [pool.side_a.clone(), pool.side_b.clone()].into_iter().flatten() {
            Promise::new(acct).transfer(pool.stake).detach();
            total = total.saturating_add(pool.stake);
        }
        pool.status = if pool.outcome.is_some() { Status::Settled } else { Status::Refunded };
        pool.paid_to = None;
        pool.paid_amount = total;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const HASH: &str = "a3f1c2d4e5b6a7980112233445566778899aabbccddeeff00112233445566778";
    const DAY_MS: u64 = 86_400_000;

    fn judge() -> AccountId {
        accounts(0)
    }
    fn ctx(who: AccountId, deposit: NearToken, ts_ms: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who)
            .attached_deposit(deposit)
            .block_timestamp(ts_ms * 1_000_000)
            .build());
    }
    fn one() -> NearToken {
        NearToken::from_near(1)
    }
    fn setup() -> StakeEscrow {
        ctx(judge(), NearToken::from_yoctonear(0), 1_000);
        StakeEscrow::new(judge(), 7 * DAY_MS)
    }
    fn staked() -> StakeEscrow {
        let mut c = setup();
        ctx(accounts(1), one(), 1_000);
        c.stake("d1".into(), Side::A);
        ctx(accounts(2), one(), 2_000);
        c.stake("d1".into(), Side::B);
        c
    }

    #[test]
    fn both_sides_stake() {
        let c = staked();
        let p = c.get_pool("d1".into()).unwrap();
        assert_eq!(p.side_a, Some(accounts(1)));
        assert_eq!(p.side_b, Some(accounts(2)));
        assert_eq!(p.status, Status::Open);
    }

    #[test]
    #[should_panic(expected = "deposit must equal")]
    fn second_side_must_match() {
        let mut c = setup();
        ctx(accounts(1), one(), 1_000);
        c.stake("d1".into(), Side::A);
        ctx(accounts(2), NearToken::from_millinear(500), 1_000);
        c.stake("d1".into(), Side::B);
    }

    #[test]
    #[should_panic(expected = "both sides")]
    fn cannot_stake_both_sides() {
        let mut c = setup();
        ctx(accounts(1), one(), 1_000);
        c.stake("d1".into(), Side::A);
        c.stake("d1".into(), Side::B);
    }

    #[test]
    #[should_panic(expected = "already has a stake")]
    fn side_taken() {
        let mut c = staked();
        ctx(accounts(3), one(), 3_000);
        c.stake("d1".into(), Side::A);
    }

    #[test]
    #[should_panic(expected = "between 0.01 and 10")]
    fn stake_bounds() {
        let mut c = setup();
        ctx(accounts(1), NearToken::from_near(11), 1_000);
        c.stake("d1".into(), Side::A);
    }

    #[test]
    #[should_panic(expected = "judge cannot stake")]
    fn judge_cannot_stake() {
        let mut c = setup();
        ctx(judge(), one(), 1_000);
        c.stake("d1".into(), Side::A);
    }

    #[test]
    fn winner_gets_pot() {
        let mut c = staked();
        ctx(judge(), NearToken::from_yoctonear(0), 5_000);
        let p = c.settle("d1".into(), Outcome::B, HASH.into());
        assert_eq!(p.status, Status::Settled);
        assert_eq!(p.paid_to, Some(accounts(2)));
        assert_eq!(p.paid_amount, NearToken::from_near(2));
        assert_eq!(p.verdict_hash.as_deref(), Some(HASH));
    }

    #[test]
    fn draw_refunds_both() {
        let mut c = staked();
        ctx(judge(), NearToken::from_yoctonear(0), 5_000);
        let p = c.settle("d1".into(), Outcome::Draw, HASH.into());
        assert_eq!(p.status, Status::Settled);
        assert_eq!(p.paid_to, None);
        assert_eq!(p.paid_amount, NearToken::from_near(2));
    }

    #[test]
    fn unmatched_stake_is_refunded_on_settle() {
        let mut c = setup();
        ctx(accounts(1), one(), 1_000);
        c.stake("d1".into(), Side::A);
        ctx(judge(), NearToken::from_yoctonear(0), 5_000);
        let p = c.settle("d1".into(), Outcome::A, HASH.into());
        assert_eq!(p.paid_to, None);
        assert_eq!(p.paid_amount, one());
    }

    #[test]
    #[should_panic(expected = "only the judge")]
    fn only_judge_settles() {
        let mut c = staked();
        ctx(accounts(1), NearToken::from_yoctonear(0), 5_000);
        c.settle("d1".into(), Outcome::A, HASH.into());
    }

    #[test]
    #[should_panic(expected = "already settled")]
    fn settle_once() {
        let mut c = staked();
        ctx(judge(), NearToken::from_yoctonear(0), 5_000);
        c.settle("d1".into(), Outcome::A, HASH.into());
        c.settle("d1".into(), Outcome::B, HASH.into());
    }

    #[test]
    #[should_panic(expected = "stakes are already closed")]
    fn no_stake_after_settle() {
        let mut c = setup();
        ctx(accounts(1), one(), 1_000);
        c.stake("d1".into(), Side::A);
        ctx(judge(), NearToken::from_yoctonear(0), 5_000);
        c.settle("d1".into(), Outcome::A, HASH.into());
        ctx(accounts(2), one(), 6_000);
        c.stake("d1".into(), Side::B);
    }

    #[test]
    #[should_panic(expected = "sha256")]
    fn bad_hash() {
        let mut c = staked();
        ctx(judge(), NearToken::from_yoctonear(0), 5_000);
        c.settle("d1".into(), Outcome::A, "nope".into());
    }

    #[test]
    #[should_panic(expected = "refund window")]
    fn refund_waits() {
        let mut c = staked();
        ctx(accounts(3), NearToken::from_yoctonear(0), 3 * DAY_MS);
        c.refund("d1".into());
    }

    #[test]
    fn refund_after_window() {
        let mut c = staked();
        ctx(accounts(3), NearToken::from_yoctonear(0), 8 * DAY_MS);
        let p = c.refund("d1".into());
        assert_eq!(p.status, Status::Refunded);
        assert_eq!(p.paid_amount, NearToken::from_near(2));
    }
}
