/**
 * The browser wallet path loads: a debater with no stake sees the connect buttons, and "Connect MyNearWallet"
 * hands off to the MyNearWallet testnet sign-in (we stop there: signing needs a real person's wallet).
 * Uses the seeded "completed" debate (tunde vs emeka), which near-stakes.spec.ts doesn't touch.
 */
import { expect, test } from "@playwright/test";

import { DEMO_PASSWORD } from "./constants";
import { callAction, findAllDeep, signIn } from "./helpers";

test("a debater can open the NEAR wallet hand-off", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop only");
  test.setTimeout(400_000);
  const emeka = await signIn(browser, { email: "emeka@argueit.test", password: DEMO_PASSWORD });
  // Let the first (slow, dev-server) page load finish before calling actions from it.
  await emeka.page.goto("/");
  await expect(emeka.page.getByText("ARGUE ROCK").first()).toBeVisible({ timeout: 240_000 });
  const profile = await callAction(emeka.page, "get-profile", { handle: "emeka_plays" }, "GET");
  const items = findAllDeep<{ competitionId: string; opponent?: { handle?: string } }>(
    profile,
    (v) => typeof v.competitionId === "string" && typeof v.opponent === "object",
  );
  const debate = items.find((i) => i.opponent?.handle === "tunde_tech");
  expect(debate, JSON.stringify(items).slice(0, 300)).toBeTruthy();

  emeka.page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[browser ${m.type()}] ${m.text().slice(0, 400)}`);
  });
  emeka.page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 400)}`));
  emeka.page.on("response", (r) => {
    if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url().slice(0, 200)}`);
  });
  emeka.page.on("framenavigated", (f) => {
    if (f === emeka.page.mainFrame()) console.log(`[nav] ${f.url().slice(0, 200)}`);
  });
  await emeka.page.goto(`/c/${debate!.competitionId}/verdict`);
  const panel = emeka.page.getByTestId("stake-panel");
  await expect(panel).toContainText("Stakes on NEAR", { timeout: 120_000 });
  const connect = panel.getByRole("button", { name: "Connect MyNearWallet" });
  await expect(connect).toBeVisible();
  await emeka.page.screenshot({ path: "test-results/near-connect.png" });

  const popupOrNav = Promise.race([
    emeka.page.waitForURL(/mynearwallet/, { timeout: 60_000 }).then(() => emeka.page.url()),
    emeka.page.context().waitForEvent("page", { timeout: 60_000 }).then((p) => p.url()),
  ]);
  await connect.click();
  const url = await popupOrNav;
  expect(url).toMatch(/mynearwallet/);
});
