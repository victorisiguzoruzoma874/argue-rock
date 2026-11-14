/**
 * Argue Rock ↔ NEAR. Thin wrapper over near-api-js for the stake escrow contract
 * (contracts/stake-escrow). Reads use the public RPC; the only write is `settle`, signed by the judge account,
 * whose key lives in the server env and is never sent to the browser.
 */
import "server-only";

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";

export type StakeSide = "A" | "B";
export type ContractOutcome = "A" | "B" | "Draw";

export interface ChainPool {
  stake: string;
  side_a: string | null;
  side_b: string | null;
  opened_at_ms: number;
  status: "Open" | "Settled" | "Refunded";
  outcome: ContractOutcome | null;
  verdict_hash: string | null;
  paid_to: string | null;
  paid_amount: string;
}

export interface NearPublicConfig {
  enabled: boolean;
  network: "testnet" | "mainnet";
  contractId: string | null;
  rpcUrl: string;
  explorerUrl: string;
}

export function nearConfig(): NearPublicConfig {
  const network = process.env.NEAR_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const contractId = process.env.NEAR_ESCROW_CONTRACT?.trim() || null;
  const rpcUrl =
    process.env.NEAR_RPC_URL?.trim() ||
    (network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
  return {
    enabled: contractId !== null,
    network,
    contractId,
    rpcUrl,
    explorerUrl: network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io",
  };
}

/** The escrow keys pools by debate id; Argue Rock uses the competition uuid (36 chars, within the 64 limit). */
export function debateKey(competitionId: string): string {
  return competitionId;
}

function provider(): JsonRpcProvider {
  return new JsonRpcProvider({ url: nearConfig().rpcUrl });
}

function requireContract(): string {
  const { contractId } = nearConfig();
  if (!contractId) throw new Error("NEAR staking is not configured (NEAR_ESCROW_CONTRACT is empty).");
  return contractId;
}

export async function viewPool(competitionId: string): Promise<ChainPool | null> {
  const pool = await provider().callFunction({
    contractId: requireContract(),
    method: "get_pool",
    args: { debate_id: debateKey(competitionId) },
    blockQuery: { finality: "final" },
  });
  return (pool as unknown as ChainPool | null | undefined) ?? null;
}

export interface VerifiedStakeTx {
  signerId: string;
  debateId: string;
  side: StakeSide;
  depositYocto: string;
}

/**
 * Confirms a transaction hash is a successful `stake` call on our escrow, signed by `signerId`.
 * The browser reports the hash; the server never trusts the browser's description of it.
 */
export async function verifyStakeTx(txHash: string, signerId: string): Promise<VerifiedStakeTx | null> {
  const contractId = requireContract();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await provider().viewTransactionStatus({ txHash, accountId: signerId, waitUntil: "FINAL" });
  const tx = res?.transaction;
  if (!tx || tx.signer_id !== signerId || tx.receiver_id !== contractId) return null;
  const status = res.status;
  if (!status || typeof status !== "object" || !("SuccessValue" in status)) return null;
  for (const action of tx.actions ?? []) {
    const call = action?.FunctionCall;
    if (!call || call.method_name !== "stake") continue;
    try {
      const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8")) as { debate_id?: string; side?: string };
      if ((args.side === "A" || args.side === "B") && typeof args.debate_id === "string") {
        return { signerId, debateId: args.debate_id, side: args.side, depositYocto: String(call.deposit) };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export interface SettleResult {
  txHash: string;
  pool: ChainPool | null;
}

export async function settleOnChain(
  competitionId: string,
  outcome: ContractOutcome,
  verdictHash: string,
): Promise<SettleResult> {
  const contractId = requireContract();
  const judgeId = process.env.NEAR_JUDGE_ACCOUNT?.trim();
  const judgeKey = process.env.NEAR_JUDGE_PRIVATE_KEY?.trim() as KeyPairString | undefined;
  if (!judgeId || !judgeKey) throw new Error("NEAR_JUDGE_ACCOUNT / NEAR_JUDGE_PRIVATE_KEY are not set.");
  const judge = new Account(judgeId, provider(), judgeKey);
  const outcomeTx = await judge.callFunctionRaw({
    contractId,
    methodName: "settle",
    args: { debate_id: debateKey(competitionId), outcome, verdict_hash: verdictHash },
    gas: teraToGas("50"),
  });
  const txHash = outcomeTx.transaction.hash;
  let pool: ChainPool | null = null;
  for (let i = 0; i < 8; i++) {
    pool = await viewPool(competitionId);
    if (pool && pool.status !== "Open") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { txHash, pool };
}
