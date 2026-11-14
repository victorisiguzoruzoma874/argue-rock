#!/usr/bin/env node
// Starts the e2e dev server the same way playwright.config.ts does (fresh seeded e2e database, mock judge,
// real sign-in), for machines where the first Vite boot is slower than Playwright's webServer timeout.
// Then run: pnpm exec playwright test -c playwright.reuse.config.ts e2e/near-stakes.spec.ts --project=desktop
import { spawn, spawnSync } from "node:child_process";
import { E2E_DB_DIR, E2E_PORT } from "../../e2e/constants.ts";

const env = {
  ...process.env,
  DATABASE_URL: `pglite:./${E2E_DB_DIR}`,
  PORT: String(E2E_PORT),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e",
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT: "1",
  AUTH_SKIP_EMAIL_VERIFICATION: "1",
  AUTH_MAGIC_LINK: "0",
  JUDGE_PROVIDER: "mock",
};
const shell = process.platform === "win32";
const prep = spawnSync("node", ["e2e/prepare-db.mjs", E2E_DB_DIR], { stdio: "inherit", env, shell });
if (prep.status !== 0) process.exit(prep.status ?? 1);
spawn("npx", ["agent-native", "dev", "--port", String(E2E_PORT), "--strictPort"], { stdio: "inherit", env, shell });
