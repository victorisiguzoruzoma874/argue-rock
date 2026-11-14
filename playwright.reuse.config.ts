// Same as playwright.config.ts, but uses a server you already started with `node scripts/near/e2e-server.mjs`.
import base from "./playwright.config";

export default { ...base, webServer: undefined };
