#!/usr/bin/env node
// Deploys the Argue Rock stake escrow to NEAR testnet.
//
//   node scripts/near/deploy-testnet.mjs            # create accounts (faucet) + deploy + init
//   node scripts/near/deploy-testnet.mjs --redeploy # redeploy code to the existing escrow account
//
// It creates one funded top-level account from the testnet faucet, then sub-accounts under it:
//   escrow.<root>  holds the contract and the stakes
//   judge.<root>   the only account allowed to call `settle` (its key goes in the app's .env)
//   alice.<root>, bob.<root>  demo debaters for scripts/near/smoke-testnet.mjs
//
// Keys are written to ~/.near-credentials/testnet/<account>.json (the near-cli layout), never into the repo.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, nearToYocto, teraToGas } from "near-api-js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const WASM = join(repo, "contracts", "stake-escrow", "target", "wasm32-unknown-unknown", "release", "argue_rock_stake_escrow.wasm");
const CREDS = process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials", "testnet");
const STATE = join(CREDS, "argue-rock-deployment.json");
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const REFUND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const provider = new JsonRpcProvider({ url: RPC });

function saveKey(accountId, keyPair) {
  mkdirSync(CREDS, { recursive: true });
  writeFileSync(
    join(CREDS, `${accountId}.json`),
    JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }, null, 2),
  );
}
function loadKey(accountId) {
  return JSON.parse(readFileSync(join(CREDS, `${accountId}.json`), "utf8")).private_key;
}

async function faucetCreate(accountId, keyPair) {
  const body = JSON.stringify({ newAccountId: accountId, newAccountPublicKey: keyPair.getPublicKey().toString() });
  const endpoints = ["https://helper.nearprotocol.com/account", "https://helper.testnet.near.org/account"];
  let last;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (res.ok) return;
      last = `${url}: ${res.status} ${await res.text()}`;
    } catch (e) {
      last = `${url}: ${e.message}`;
    }
  }
  throw new Error(`faucet failed: ${last}`);
}

async function waitForAccount(accountId) {
  for (let i = 0; i < 30; i++) {
    try {
      await provider.viewAccount({ accountId });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`${accountId} never appeared on chain`);
}

async function main() {
  const wasm = readFileSync(WASM);
  if (process.argv.includes("--redeploy")) {
    const state = JSON.parse(readFileSync(STATE, "utf8"));
    const escrow = new Account(state.escrow, provider, loadKey(state.escrow));
    await escrow.deployContract(wasm);
    console.log("redeployed", state.escrow);
    return;
  }
  if (existsSync(STATE)) {
    console.log("already deployed:", readFileSync(STATE, "utf8"));
    console.log("delete", STATE, "to deploy a fresh set of accounts");
    return;
  }

  const root = `argue-rock-${Date.now().toString(36)}.testnet`;
  const rootKey = KeyPair.fromRandom("ed25519");
  saveKey(root, rootKey);
  console.log("creating", root, "from the testnet faucet ...");
  await faucetCreate(root, rootKey);
  await waitForAccount(root);
  const rootAccount = new Account(root, provider, rootKey.toString());

  const subs = { escrow: "4", judge: "1", alice: "1.5", bob: "1.5" };
  const ids = {};
  for (const [name, amount] of Object.entries(subs)) {
    const id = `${name}.${root}`;
    const kp = KeyPair.fromRandom("ed25519");
    saveKey(id, kp);
    await rootAccount.createAccount({ newAccountId: id, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(amount) });
    ids[name] = id;
    console.log("created", id, "with", amount, "NEAR");
  }

  const escrow = new Account(ids.escrow, provider, loadKey(ids.escrow));
  await escrow.deployContract(wasm);
  await escrow.callFunction({
    contractId: ids.escrow,
    methodName: "new",
    args: { judge: ids.judge, refund_after_ms: REFUND_AFTER_MS },
    gas: teraToGas("30"),
  });
  const config = await provider.callFunction({ contractId: ids.escrow, method: "get_config", args: {} });
  console.log("get_config:", JSON.stringify(config));

  const state = { network: "testnet", root, ...ids, deployedAt: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log("\nDeployed. Add to .env:\n");
  console.log(`NEAR_NETWORK=testnet`);
  console.log(`NEAR_ESCROW_CONTRACT=${ids.escrow}`);
  console.log(`NEAR_JUDGE_ACCOUNT=${ids.judge}`);
  console.log(`NEAR_JUDGE_PRIVATE_KEY=<from ${join(CREDS, ids.judge + ".json")}>`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
