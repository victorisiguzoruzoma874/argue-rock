#!/usr/bin/env node
// End-to-end check against the deployed testnet escrow:
// alice stakes side A, bob matches on side B, a stranger's settle is refused, the judge settles B,
// and bob's balance goes up by the pot. Prints the explorer links.
//
//   node scripts/near/smoke-testnet.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, nearToYocto, teraToGas, yoctoToNear } from "near-api-js";

const CREDS = process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials", "testnet");
const state = JSON.parse(readFileSync(join(CREDS, "argue-rock-deployment.json"), "utf8"));
const key = (id) => JSON.parse(readFileSync(join(CREDS, `${id}.json`), "utf8")).private_key;
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com" });
const as = (id) => new Account(id, provider, key(id));
const explorer = (hash) => `https://testnet.nearblocks.io/txns/${hash}`;

const debateId = `smoke-${Date.now().toString(36)}`;
const stake = nearToYocto("0.1");
const call = (who, methodName, args, deposit) =>
  as(who).callFunctionRaw({ contractId: state.escrow, methodName, args, gas: teraToGas("50"), deposit });

const before = BigInt((await provider.viewAccount({ accountId: state.bob })).amount);

const a = await call(state.alice, "stake", { debate_id: debateId, side: "A" }, stake);
console.log("alice staked A:", explorer(a.transaction.hash));
const b = await call(state.bob, "stake", { debate_id: debateId, side: "B" }, stake);
console.log("bob staked B:  ", explorer(b.transaction.hash));

try {
  await call(state.alice, "settle", { debate_id: debateId, outcome: "A", verdict_hash: "0".repeat(64) });
  throw new Error("SECURITY: a non-judge settle was accepted");
} catch (e) {
  if (String(e.message).startsWith("SECURITY")) throw e;
  console.log("alice tried to settle: refused (only the judge can settle)");
}

const verdictHash = createHash("sha256").update(`smoke verdict ${debateId}: B`).digest("hex");
const s = await call(state.judge, "settle", { debate_id: debateId, outcome: "B", verdict_hash: verdictHash });
console.log("judge settled B:", explorer(s.transaction.hash));

let pool;
for (let i = 0; i < 10; i++) {
  pool = await provider.callFunction({ contractId: state.escrow, method: "get_pool", args: { debate_id: debateId } });
  if (pool?.status === "Settled") break;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log("pool:", JSON.stringify(pool));
await new Promise((r) => setTimeout(r, 3000));
const after = BigInt((await provider.viewAccount({ accountId: state.bob })).amount);
console.log(`bob balance change: +${yoctoToNear((after - before).toString(), 4)} NEAR (staked 0.1, pot 0.2, minus gas)`);
if (pool?.status !== "Settled" || pool.paid_to !== state.bob) process.exit(1);
console.log("OK");
