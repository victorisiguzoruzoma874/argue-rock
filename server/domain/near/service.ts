/**
 * Argue Rock stakes: debaters stake NEAR on their own side of a debate; once the debate has a final verdict, a
 * moderator approves the settlement and the judge account tells the escrow who won.
 *
 * Trust model (README "What NEAR enables"):
 * - The escrow contract caps what the judge key can do: pay side A's staker, pay side B's staker, or refund.
 * - This service decides the outcome from the stored verdict only, and only when a person approves it.
 * - A stake counts for a side only if the debater on that side recorded it from their own session
 *   (`recordStake`). If the account on-chain is not the one the debater recorded, the settlement refunds both.
 */
import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getCurrentVerdict, loadCompetitionCore, type CompetitionCore } from "@domain/appeals/core";
import { hasRole, type SessionUser } from "@domain/auth";
import { db } from "@domain/db";
import { appeals, nearSettlements, nearStakes, type Verdict } from "@domain/db/schema";
import { ActionError } from "@domain/lib/action-result";

import {
  nearConfig,
  settleOnChain,
  verifyStakeTx,
  viewPool,
  type ChainPool,
  type ContractOutcome,
  type NearPublicConfig,
  type StakeSide,
} from "./chain";

const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

export interface StakeSideView {
  side: StakeSide;
  userId: string;
  displayName: string;
  /** NEAR account the debater recorded, if any. */
  recordedAccount: string | null;
  recordedTx: string | null;
  /** NEAR account the contract holds for this side, if any. */
  onChainAccount: string | null;
  /** True when both exist and match. */
  verified: boolean;
}

export interface StakesView {
  config: NearPublicConfig;
  competitionId: string;
  status: string;
  viewer: { side: StakeSide | null; isStaff: boolean };
  pool: ChainPool | null;
  sides: { A: StakeSideView; B: StakeSideView };
  verdict: { id: string; outcome: string } | null;
  settlement: { txHash: string; outcome: string; verdictHash: string; createdAt: string } | null;
  /** Why a moderator can't settle right now, or null if they can. */
  settleBlocker: string | null;
  /** What `settle` would tell the contract, for the approval screen. */
  plannedOutcome: { outcome: ContractOutcome; reason: string } | null;
  chainError: string | null;
}

function viewerSide(core: CompetitionCore, viewer: SessionUser | null): StakeSide | null {
  if (!viewer) return null;
  if (core.sides.A.userId === viewer.id) return "A";
  if (core.sides.B.userId === viewer.id) return "B";
  return null;
}

/** sha256 over the fields that decide the payout. Recomputable from the verdict page. */
export function verdictHash(competitionId: string, verdict: Verdict): string {
  const canonical = JSON.stringify({
    app: "argue-rock",
    competitionId,
    verdictId: verdict.id,
    version: verdict.version,
    outcome: verdict.outcome,
    winnerUserId: verdict.winnerUserId,
    totals: verdict.scores?.totals ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Maps the stored verdict to what the contract understands. Null = never settle (a person must decide). */
export function contractOutcomeFor(
  verdict: Pick<Verdict, "outcome" | "winnerUserId">,
  core: Pick<CompetitionCore, "sides">,
): ContractOutcome | null {
  switch (verdict.outcome) {
    case "A":
      return "A";
    case "B":
      return "B";
    case "draw":
      return "Draw";
    case "forfeit":
      if (verdict.winnerUserId === core.sides.A.userId) return "A";
      if (verdict.winnerUserId === core.sides.B.userId) return "B";
      return null;
    default:
      return null;
  }
}

interface StakeRow {
  side: string;
  nearAccountId: string;
  txHash: string;
}

/**
 * The outcome actually sent on-chain. A win only pays out if BOTH on-chain stakers are the accounts the two
 * debaters recorded; otherwise someone else holds a side, and the only safe move is a refund.
 */
export function plannedSettlement(
  verdictOutcome: ContractOutcome,
  pool: Pick<ChainPool, "side_a" | "side_b">,
  rows: StakeRow[],
): { outcome: ContractOutcome; reason: string } {
  const rec = (s: StakeSide) => rows.find((r) => r.side === s)?.nearAccountId ?? null;
  const aOk = pool.side_a !== null && pool.side_a === rec("A");
  const bOk = pool.side_b !== null && pool.side_b === rec("B");
  if (verdictOutcome === "Draw") return { outcome: "Draw", reason: "The verdict is a draw: both stakes are refunded." };
  if (!pool.side_a || !pool.side_b) {
    return { outcome: "Draw", reason: "Only one side staked, so there is no pot: the stake is refunded." };
  }
  if (!aOk || !bOk) {
    return {
      outcome: "Draw",
      reason: "A NEAR account on-chain doesn't match the debater who recorded the stake, so both stakes are refunded.",
    };
  }
  return { outcome: verdictOutcome, reason: `Side ${verdictOutcome} won the verdict: the whole pot goes to their account.` };
}

async function settleBlockerFor(
  core: CompetitionCore,
  verdict: Verdict | undefined,
  pool: ChainPool | null,
  viewer: SessionUser | null,
): Promise<string | null> {
  if (!viewer || !hasRole(viewer.role, "moderator")) return "Only a moderator can approve a settlement.";
  if (viewerSide(core, viewer)) return "You're in this debate, so another moderator has to approve the settlement.";
  if (!pool) return "Nobody has staked on this debate.";
  if (pool.status !== "Open") return "The stakes are already settled.";
  if (!verdict) return "There is no verdict yet.";
  if (core.competition.status !== "completed") return "The debate isn't final yet (it's being judged, reviewed or appealed).";
  const open = await db.query.appeals.findFirst({
    where: and(eq(appeals.competitionId, core.competition.id), eq(appeals.status, "open")),
  });
  if (open) return "An appeal is open. Decide it first.";
  if (contractOutcomeFor(verdict, core) === null) return "Inconclusive verdicts are never settled automatically.";
  return null;
}

export async function getStakes(competitionId: string, viewer: SessionUser | null): Promise<StakesView | null> {
  const core = await loadCompetitionCore(competitionId);
  if (!core) return null;
  const config = nearConfig();
  const [rows, verdict, settlement] = await Promise.all([
    db.select().from(nearStakes).where(eq(nearStakes.competitionId, competitionId)),
    getCurrentVerdict(competitionId),
    db.query.nearSettlements.findFirst({ where: eq(nearSettlements.competitionId, competitionId) }),
  ]);

  let pool: ChainPool | null = null;
  let chainError: string | null = null;
  if (config.enabled) {
    try {
      pool = await viewPool(competitionId);
    } catch (e) {
      chainError = e instanceof Error ? e.message : "Couldn't reach NEAR.";
    }
  }

  const sideView = (side: StakeSide): StakeSideView => {
    const p = core.sides[side];
    const row = rows.find((r) => r.side === side);
    const onChain = pool ? (side === "A" ? pool.side_a : pool.side_b) : null;
    return {
      side,
      userId: p.userId,
      displayName: p.displayName,
      recordedAccount: row?.nearAccountId ?? null,
      recordedTx: row?.txHash ?? null,
      onChainAccount: onChain,
      verified: !!row && onChain === row.nearAccountId,
    };
  };

  const verdictOutcome = verdict ? contractOutcomeFor(verdict, core) : null;
  return {
    config,
    competitionId,
    status: core.competition.status,
    viewer: { side: viewerSide(core, viewer), isStaff: viewer ? hasRole(viewer.role, "moderator") : false },
    pool,
    sides: { A: sideView("A"), B: sideView("B") },
    verdict: verdict ? { id: verdict.id, outcome: verdict.outcome } : null,
    settlement: settlement
      ? {
          txHash: settlement.txHash,
          outcome: settlement.outcome,
          verdictHash: settlement.verdictHash,
          createdAt: settlement.createdAt.toISOString(),
        }
      : null,
    settleBlocker: chainError ? "Couldn't reach NEAR." : await settleBlockerFor(core, verdict, pool, viewer),
    plannedOutcome: verdictOutcome && pool ? plannedSettlement(verdictOutcome, pool, rows) : null,
    chainError,
  };
}

/** Called by the debater's browser after their wallet signed `stake`. Verifies the transaction on-chain. */
export async function recordStake(
  input: { competitionId: string; txHash: string; nearAccountId: string },
  viewer: SessionUser,
): Promise<StakesView> {
  if (!nearConfig().enabled) throw new ActionError("CONFLICT", "NEAR staking isn't set up on this server.");
  if (!ACCOUNT_ID.test(input.nearAccountId)) throw new ActionError("VALIDATION", "That isn't a NEAR account id.");
  if (!TX_HASH.test(input.txHash)) throw new ActionError("VALIDATION", "That isn't a NEAR transaction hash.");
  const core = await loadCompetitionCore(input.competitionId);
  if (!core) throw new ActionError("NOT_FOUND", "That debate doesn't exist.");
  const side = viewerSide(core, viewer);
  if (!side) throw new ActionError("FORBIDDEN", "Only the two debaters can stake on a debate.");

  const tx = await verifyStakeTx(input.txHash, input.nearAccountId);
  if (!tx || tx.debateId !== input.competitionId) {
    throw new ActionError("VALIDATION", "We couldn't find a successful stake for this debate in that transaction.");
  }
  if (tx.side !== side) throw new ActionError("VALIDATION", `You're side ${side}, but that stake is on side ${tx.side}.`);
  const pool = await viewPool(input.competitionId);
  const onChain = pool ? (side === "A" ? pool.side_a : pool.side_b) : null;
  if (onChain !== input.nearAccountId) {
    throw new ActionError("CONFLICT", "The contract doesn't hold that account's stake for your side.");
  }

  await db
    .insert(nearStakes)
    .values({
      competitionId: input.competitionId,
      userId: viewer.id,
      side,
      nearAccountId: input.nearAccountId,
      amountYocto: tx.depositYocto,
      txHash: input.txHash,
    })
    .onConflictDoNothing();
  const view = await getStakes(input.competitionId, viewer);
  if (!view) throw new ActionError("NOT_FOUND", "That debate doesn't exist.");
  return view;
}

/** Moderator-approved. Tells the escrow the outcome of the stored verdict. */
export async function settleStakes(competitionId: string, viewer: SessionUser) {
  const core = await loadCompetitionCore(competitionId);
  if (!core) throw new ActionError("NOT_FOUND", "That debate doesn't exist.");
  if (!nearConfig().enabled) throw new ActionError("CONFLICT", "NEAR staking isn't set up on this server.");
  const [verdict, pool, rows] = await Promise.all([
    getCurrentVerdict(competitionId),
    viewPool(competitionId),
    db.select().from(nearStakes).where(eq(nearStakes.competitionId, competitionId)),
  ]);
  const blocker = await settleBlockerFor(core, verdict, pool, viewer);
  if (blocker || !verdict || !pool) throw new ActionError("CONFLICT", blocker ?? "Nothing to settle.");
  const verdictOutcome = contractOutcomeFor(verdict, core);
  if (!verdictOutcome) throw new ActionError("CONFLICT", "Inconclusive verdicts are never settled automatically.");

  const plan = plannedSettlement(verdictOutcome, pool, rows);
  const hash = verdictHash(competitionId, verdict);
  const result = await settleOnChain(competitionId, plan.outcome, hash);
  await db
    .insert(nearSettlements)
    .values({
      competitionId,
      verdictId: verdict.id,
      outcome: plan.outcome,
      verdictHash: hash,
      txHash: result.txHash,
      approvedBy: viewer.id,
    })
    .onConflictDoNothing();
  const config = nearConfig();
  return {
    competitionId,
    outcome: plan.outcome,
    reason: plan.reason,
    verdictHash: hash,
    txHash: result.txHash,
    explorerTxUrl: `${config.explorerUrl}/txns/${result.txHash}`,
    paidTo: result.pool?.paid_to ?? null,
    paidAmountYocto: result.pool?.paid_amount ?? null,
    poolStatus: result.pool?.status ?? null,
  };
}
