#!/usr/bin/env node
// Stake on a debate from one of the demo testnet accounts made by deploy-testnet.mjs (no browser wallet needed).
// Prints the account and transaction hash to paste into "Staked from another wallet or the CLI? Link it here".
//
//   node scripts/near/stake-as.mjs <competitionId> <alice|bob|account.testnet> <A|B> [amountNEAR=0.1]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, nearToYocto, teraToGas } from "near-api-js";

const [competitionId, who, side, amount = "0.1"] = process.argv.slice(2);
if (!competitionId || !who || (side !== "A" && side !== "B")) {
  console.error("usage: node scripts/near/stake-as.mjs <competitionId> <alice|bob|account> <A|B> [amountNEAR]");
  process.exit(2);
}
const CREDS = process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials", "testnet");
const state = JSON.parse(readFileSync(join(CREDS, "argue-rock-deployment.json"), "utf8"));
const accountId = state[who] ?? who;
const key = JSON.parse(readFileSync(join(CREDS, `${accountId}.json`), "utf8")).private_key;
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com" });
const account = new Account(accountId, provider, key);

const res = await account.callFunctionRaw({
  contractId: process.env.NEAR_ESCROW_CONTRACT ?? state.escrow,
  methodName: "stake",
  args: { debate_id: competitionId, side },
  gas: teraToGas("50"),
  deposit: nearToYocto(amount),
});
console.log(JSON.stringify({ nearAccountId: accountId, txHash: res.transaction.hash, side, amount }, null, 2));
console.log(`https://testnet.nearblocks.io/txns/${res.transaction.hash}`);
