/**
 * Browser-only NEAR wallet access (Argue Rock stakes). The debater's own wallet signs the `stake` call; the app
 * never sees a debater's key. Loaded lazily so SSR and pages without stakes never pull in the wallet code.
 */
import type { WalletSelector } from "@near-wallet-selector/core";

let selectorPromise: Promise<WalletSelector> | null = null;

export type NearNetwork = "testnet" | "mainnet";

export function getSelector(network: NearNetwork): Promise<WalletSelector> {
  if (typeof window === "undefined") return Promise.reject(new Error("The NEAR wallet only runs in the browser."));
  selectorPromise ??= (async () => {
    const [{ setupWalletSelector }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/my-near-wallet"),
      import("@near-wallet-selector/meteor-wallet"),
    ]);
    return setupWalletSelector({ network, modules: [setupMyNearWallet(), setupMeteorWallet()] });
  })();
  return selectorPromise;
}

export async function signedInAccount(network: NearNetwork): Promise<string | null> {
  const selector = await getSelector(network);
  if (!selector.isSignedIn()) return null;
  const wallet = await selector.wallet();
  const [first] = await wallet.getAccounts();
  return first?.accountId ?? null;
}

export async function connect(network: NearNetwork, walletId: "my-near-wallet" | "meteor-wallet"): Promise<string | null> {
  const selector = await getSelector(network);
  const wallet = await selector.wallet(walletId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (wallet.signIn as any)({ successUrl: window.location.href, failureUrl: window.location.href });
  return accounts?.[0]?.accountId ?? (await signedInAccount(network));
}

export async function disconnect(network: NearNetwork): Promise<void> {
  const selector = await getSelector(network);
  if (!selector.isSignedIn()) return;
  await (await selector.wallet()).signOut();
}

/**
 * Sends `stake(debate_id, side)` with the deposit. Browser-redirect wallets (MyNearWallet) leave the page and come
 * back with `?transactionHashes=` in the URL, so this can resolve with no hash: read it with `takeReturnedTxHash`.
 */
export async function stake(
  network: NearNetwork,
  contractId: string,
  debateId: string,
  side: "A" | "B",
  depositYocto: string,
): Promise<string | null> {
  const [{ actions }, selector] = await Promise.all([import("near-api-js"), getSelector(network)]);
  const wallet = await selector.wallet();
  const action = actions.functionCall("stake", { debate_id: debateId, side }, BigInt("50000000000000"), BigInt(depositYocto));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outcome: any = await (wallet.signAndSendTransaction as any)({
    receiverId: contractId,
    actions: [action],
    callbackUrl: window.location.href,
  });
  return outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? null;
}

/** After a redirect wallet returns: the tx hash it appended, removed from the URL so a reload won't re-record. */
export function takeReturnedTxHash(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const hashes = url.searchParams.get("transactionHashes");
  if (!hashes) return null;
  url.searchParams.delete("transactionHashes");
  window.history.replaceState(window.history.state, "", url.toString());
  return hashes.split(",").pop() ?? null;
}

export function yoctoToNear(yocto: string | null | undefined, digits = 3): string {
  if (!yocto) return "0";
  const v = BigInt(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function nearToYocto(near: string): string {
  const [w, f = ""] = near.trim().split(".");
  return (BigInt(w || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
}
