/**
 * Argue Rock on NEAR testnet, end to end, against the real deployed escrow (NEAR_ESCROW_CONTRACT in .env):
 *
 * 1. The seeded "narrow loss" debate: chidi (side A) lost to tunde (side B).
 * 2. Both debaters stake 0.1 NEAR on their side from demo testnet accounts (scripts/near/stake-as.mjs stands in
 *    for the browser wallet), then link the stake to themselves through `record-stake`; the server verifies
 *    each transaction on-chain.
 * 3. Chidi can't link tunde's stake, and can't settle.
 * 4. The moderator settles from the verdict; the contract pays the pot to tunde's account and stores the verdict
 *    hash; the verdict page shows the settlement.
 *
 * Needs the testnet accounts from scripts/near/deploy-testnet.mjs (~/.near-credentials/testnet). Skipped otherwise.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { DEMO_PASSWORD, MODERATOR_EMAIL } from "./constants";
import { callAction, findAllDeep, signIn } from "./helpers";

const DEPLOYMENT = join(homedir(), ".near-credentials", "testnet", "argue-rock-deployment.json");

function stakeAs(competitionId: string, who: "alice" | "bob", side: "A" | "B") {
  const out = execFileSync(process.execPath, ["scripts/near/stake-as.mjs", competitionId, who, side, "0.1"], {
    encoding: "utf8",
  });
  return JSON.parse(out.slice(0, out.lastIndexOf("}") + 1)) as { nearAccountId: string; txHash: string };
}

test("debaters stake NEAR, a moderator settles from the verdict, the winner is paid", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only (each run spends testnet NEAR)");
  test.skip(!existsSync(DEPLOYMENT), "no testnet deployment on this machine");
  test.setTimeout(600_000);

  const chidi = await signIn(browser, { email: "chidi@argueit.test", password: DEMO_PASSWORD });
  const tunde = await signIn(browser, { email: "tunde@argueit.test", password: DEMO_PASSWORD });
  const mod = await signIn(browser, { email: MODERATOR_EMAIL, password: DEMO_PASSWORD });

  // 1. Find the narrow-loss debate from tunde's profile: won against chidi.
  const profile = await callAction(tunde.page, "get-profile", { handle: "tunde_tech" }, "GET");
  const items = findAllDeep<{ competitionId: string; result?: string; opponent?: { handle?: string } }>(
    profile,
    (v) => typeof v.competitionId === "string" && typeof v.opponent === "object",
  );
  const debate = items.find((i) => i.opponent?.handle === "chidi_fc" && i.result === "won");
  expect(debate, `narrow-loss debate not in tunde's history: ${JSON.stringify(items).slice(0, 400)}`).toBeTruthy();
  const competitionId = debate!.competitionId;

  // 2. Stake both sides on-chain, then each debater links their own stake.
  const a = stakeAs(competitionId, "alice", "A");
  const b = stakeAs(competitionId, "bob", "B");

  // 3a. Chidi (side A) can't claim the side-B stake.
  await expect(callAction(chidi.page, "record-stake", { competitionId, ...b })).rejects.toThrow(/side|stake/i);

  await callAction(chidi.page, "record-stake", { competitionId, ...a });
  const afterLink = await callAction<{
    sides: { A: { verified: boolean }; B: { verified: boolean } };
  }>(tunde.page, "record-stake", { competitionId, ...b });
  expect(afterLink.sides.A.verified).toBe(true);
  expect(afterLink.sides.B.verified).toBe(true);

  // 3b. A debater can't settle.
  await expect(callAction(chidi.page, "settle-stakes", { competitionId })).rejects.toThrow(/403|FORBIDDEN|moderator/i);

  // 4. The moderator sees the planned payout and settles.
  const before = await callAction<{ settleBlocker: string | null; plannedOutcome: { outcome: string } | null }>(
    mod.page,
    "get-stakes",
    { competitionId },
    "GET",
  );
  expect(before.settleBlocker).toBeNull();
  expect(before.plannedOutcome?.outcome).toBe("B");

  // settle-stakes needs approval: only the signed-in app's button can give it, so the moderator uses the UI.
  await mod.page.goto(`/c/${competitionId}/verdict`);
  const modPanel = mod.page.getByTestId("stake-panel");
  await expect(modPanel).toContainText("Stakes on NEAR", { timeout: 90_000 });
  await modPanel.getByRole("button", { name: "Settle stakes from the verdict" }).click();
  await expect(modPanel).toContainText("Side B won the verdict");
  await mod.page.screenshot({ path: "test-results/near-approve-settlement.png", fullPage: true });
  await modPanel.getByRole("button", { name: "Approve and settle on NEAR" }).click();
  await expect(modPanel).toContainText("Settled on NEAR: side B won", { timeout: 90_000 });

  const after = await callAction<{
    pool: { status: string; paid_to: string | null; verdict_hash: string | null } | null;
    settlement: { verdictHash: string; txHash: string } | null;
  }>(mod.page, "get-stakes", { competitionId }, "GET");
  expect(after.pool?.status).toBe("Settled");
  expect(after.pool?.paid_to).toBe(b.nearAccountId);
  expect(after.pool?.verdict_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(after.settlement?.verdictHash).toBe(after.pool?.verdict_hash);
  console.log(`settled on-chain: https://testnet.nearblocks.io/txns/${after.settlement?.txHash}`);

  // The verdict page shows it to everyone, including the loser, with the hash that went on-chain.
  await chidi.page.goto(`/c/${competitionId}/verdict`);
  const panel = chidi.page.getByTestId("stake-panel");
  await expect(panel).toContainText("Settled on NEAR: side B won", { timeout: 90_000 });
  await expect(panel).toContainText(after.pool!.verdict_hash!);
  await chidi.page.screenshot({ path: "test-results/near-settled-verdict.png", fullPage: true });
});
