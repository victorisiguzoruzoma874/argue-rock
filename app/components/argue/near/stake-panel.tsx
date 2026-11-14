// Argue Rock: NEAR stakes on a debate. Debaters stake from their own wallet; a moderator approves the
// settlement once the verdict is final; the escrow contract pays the winner or refunds both.
import { Coins, ExternalLink, Landmark, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/argue/ui/badge";
import { Button } from "@/components/argue/ui/button";
import { useToast } from "@/components/argue/ui/toast";
import {
  connect,
  disconnect,
  nearToYocto,
  signedInAccount,
  stake,
  takeReturnedTxHash,
  yoctoToNear,
  type NearNetwork,
} from "@/lib/near-wallet";
import { getStakes, recordStake, settleStakes } from "@/lib/server-actions";

type Side = "A" | "B";
interface SideView {
  side: Side;
  displayName: string;
  recordedAccount: string | null;
  recordedTx: string | null;
  onChainAccount: string | null;
  verified: boolean;
}
interface StakesView {
  config: { enabled: boolean; network: NearNetwork; contractId: string | null; explorerUrl: string };
  competitionId: string;
  status: string;
  viewer: { side: Side | null; isStaff: boolean };
  pool: {
    stake: string;
    side_a: string | null;
    side_b: string | null;
    status: "Open" | "Settled" | "Refunded";
    outcome: string | null;
    verdict_hash: string | null;
    paid_to: string | null;
    paid_amount: string;
  } | null;
  sides: { A: SideView; B: SideView };
  verdict: { id: string; outcome: string } | null;
  settlement: { txHash: string; outcome: string; verdictHash: string; createdAt: string } | null;
  settleBlocker: string | null;
  plannedOutcome: { outcome: string; reason: string } | null;
  chainError: string | null;
}

const PENDING_KEY = "argue-rock:pending-stake";
const DEFAULT_STAKE = "0.1";

function short(account: string | null): string {
  if (!account) return "";
  return account.length > 28 ? `${account.slice(0, 12)}…${account.slice(-12)}` : account;
}

export function StakePanel({ competitionId }: { competitionId: string }) {
  const toast = useToast();
  const [view, setView] = useState<StakesView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [amount, setAmount] = useState(DEFAULT_STAKE);
  const [busy, setBusy] = useState<string | null>(null);
  const [manualTx, setManualTx] = useState("");
  const [manualAccount, setManualAccount] = useState("");
  const [confirmSettle, setConfirmSettle] = useState(false);

  const load = useCallback(async () => {
    const res = await getStakes<StakesView>({ competitionId });
    if (res.ok) {
      setView(res.data);
      setLoadError(null);
    } else setLoadError(res.error);
    return res.ok ? res.data : null;
  }, [competitionId]);

  const record = useCallback(
    async (txHash: string, nearAccountId: string) => {
      setBusy("record");
      const res = await recordStake<StakesView>({ competitionId, txHash, nearAccountId });
      setBusy(null);
      if (res.ok) {
        setView(res.data);
        toast.success("Stake recorded and verified on NEAR.");
      } else toast.error(res.error);
    },
    [competitionId, toast],
  );

  useEffect(() => {
    void (async () => {
      const v = await load();
      if (!v?.config.enabled) return;
      const acct = await signedInAccount(v.config.network).catch(() => null);
      setAccount(acct);
      // Back from a redirect wallet: record the stake it just signed.
      const returned = takeReturnedTxHash();
      let pending: { competitionId: string } | null = null;
      try {
        pending = JSON.parse(window.localStorage.getItem(PENDING_KEY) ?? "null");
      } catch {
        pending = null;
      }
      if (returned && acct && pending?.competitionId === competitionId) {
        window.localStorage.removeItem(PENDING_KEY);
        await record(returned, acct);
      }
    })();
  }, [competitionId, load, record]);

  if (loadError) return null;
  if (!view) {
    return <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 text-sm text-ink-3">Loading NEAR stakes…</section>;
  }
  if (!view.config.enabled) return null;

  const { pool, sides, viewer, config } = view;
  const network = config.network;
  const mySide = viewer.side;
  const myView = mySide ? sides[mySide] : null;
  const otherSide: Side | null = mySide === "A" ? "B" : mySide === "B" ? "A" : null;
  const matchAmount = pool ? yoctoToNear(pool.stake, 4) : null;
  const canStake = !!mySide && !myView?.recordedAccount && (!pool || (pool.status === "Open" && !(mySide === "A" ? pool.side_a : pool.side_b)));
  const tx = (hash: string) => `${config.explorerUrl}/txns/${hash}`;

  async function onConnect(walletId: "my-near-wallet" | "meteor-wallet") {
    setBusy("connect");
    try {
      setAccount(await connect(network, walletId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The wallet didn't connect.");
    } finally {
      setBusy(null);
    }
  }

  async function onStake() {
    if (!mySide || !account || !config.contractId) return;
    const near = matchAmount ?? amount;
    setBusy("stake");
    try {
      window.localStorage.setItem(PENDING_KEY, JSON.stringify({ competitionId }));
      const hash = await stake(network, config.contractId, competitionId, mySide, nearToYocto(near));
      if (hash) {
        window.localStorage.removeItem(PENDING_KEY);
        await record(hash, account);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The stake didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  async function onSettle() {
    setBusy("settle");
    const res = await settleStakes<{ reason: string; explorerTxUrl: string }>({ competitionId });
    setBusy(null);
    setConfirmSettle(false);
    if (res.ok) {
      toast.success(res.data.reason);
      await load();
    } else toast.error(res.error);
  }

  return (
    <section
      aria-labelledby="stakes-title"
      data-testid="stake-panel"
      className="rounded-[var(--radius-lg)] border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stakes-title" className="flex items-center gap-2 text-3xl text-ink">
          <Coins aria-hidden className="size-6" /> Stakes on NEAR
        </h2>
        <Badge tone={network === "testnet" ? "warning" : "success"}>NEAR {network}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        Both debaters can put the same amount of NEAR behind their side. The escrow contract holds it. When the verdict is
        final and a moderator approves, the winner gets the whole pot, a draw refunds both, and if nobody settles within 7
        days anyone can trigger a refund. The contract can only ever pay one of the two debaters.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["A", "B"] as const).map((s) => {
          const sv = sides[s];
          return (
            <div key={s} className="rounded-[var(--radius)] border border-line p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Side {s} · {s === "A" ? "FOR" : "AGAINST"}
              </p>
              <p className="font-semibold text-ink">{sv.displayName}</p>
              {sv.onChainAccount || sv.recordedAccount ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-ink-2">{short(sv.onChainAccount ?? sv.recordedAccount)}</span>
                  {sv.verified ? (
                    <Badge tone="success">
                      <ShieldCheck aria-hidden className="size-3.5" /> verified
                    </Badge>
                  ) : (
                    <Badge tone="warning">not linked to this debater</Badge>
                  )}
                  {sv.recordedTx ? (
                    <a className="inline-flex items-center gap-1 text-ink-3 underline" href={tx(sv.recordedTx)} target="_blank" rel="noreferrer">
                      tx <ExternalLink aria-hidden className="size-3" />
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-sm text-ink-3">No stake yet</p>
              )}
            </div>
          );
        })}
      </div>

      {pool ? (
        <p className="mt-3 text-sm text-ink-2">
          Stake per side: <strong>{yoctoToNear(pool.stake, 4)} NEAR</strong> · Pool:{" "}
          <strong>{pool.status === "Open" ? "open" : pool.status.toLowerCase()}</strong>
          {pool.paid_to ? (
            <>
              {" "}· Paid <strong>{yoctoToNear(pool.paid_amount, 4)} NEAR</strong> to <span className="font-mono">{short(pool.paid_to)}</span>
            </>
          ) : pool.status !== "Open" ? (
            <> · Refunded {yoctoToNear(pool.paid_amount, 4)} NEAR</>
          ) : null}
        </p>
      ) : null}

      {view.settlement ? (
        <div className="mt-3 rounded-[var(--radius)] bg-surface-2 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <Landmark aria-hidden className="size-4" /> Settled on NEAR: {view.settlement.outcome === "Draw" ? "refund" : `side ${view.settlement.outcome} won`}
          </p>
          <p className="mt-1 break-all text-ink-3">
            Verdict hash on-chain: <span className="font-mono">{view.settlement.verdictHash}</span>
          </p>
          <a className="mt-1 inline-flex items-center gap-1 underline" href={tx(view.settlement.txHash)} target="_blank" rel="noreferrer">
            View the settlement transaction <ExternalLink aria-hidden className="size-3" />
          </a>
        </div>
      ) : null}

      {view.chainError ? <p className="mt-3 text-sm text-danger">Couldn&rsquo;t reach NEAR: {view.chainError}</p> : null}

      {/* Debater: connect + stake */}
      {mySide && canStake ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {!account ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void onConnect("my-near-wallet")} loading={busy === "connect"}>
                <Wallet aria-hidden className="size-4" /> Connect MyNearWallet
              </Button>
              <Button variant="secondary" onClick={() => void onConnect("meteor-wallet")} disabled={busy !== null}>
                Meteor Wallet
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-sm text-ink-2">
                Wallet: <span className="font-mono">{short(account)}</span>{" "}
                <button className="underline" onClick={() => void disconnect(network).then(() => setAccount(null))}>
                  disconnect
                </button>
              </div>
              {matchAmount ? null : (
                <label className="flex flex-col text-sm text-ink-2">
                  Stake (NEAR)
                  <input
                    className="mt-1 h-11 w-28 rounded-[var(--radius)] border border-line-strong bg-surface px-3 text-ink"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              )}
              <Button variant={mySide === "A" ? "for" : "against"} onClick={() => void onStake()} loading={busy === "stake"}>
                Stake {matchAmount ?? amount} NEAR on side {mySide}
              </Button>
            </div>
          )}
          {otherSide && !pool ? (
            <p className="text-xs text-ink-3">You set the amount; the other side has to match it exactly.</p>
          ) : null}
          <details className="text-sm text-ink-3">
            <summary className="cursor-pointer">Staked from another wallet or the CLI? Link it here</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input
                aria-label="NEAR account"
                placeholder="your-account.testnet"
                className="h-10 rounded-[var(--radius)] border border-line-strong bg-surface px-3 text-ink"
                value={manualAccount}
                onChange={(e) => setManualAccount(e.target.value.trim())}
              />
              <input
                aria-label="Transaction hash"
                placeholder="transaction hash"
                className="h-10 min-w-64 rounded-[var(--radius)] border border-line-strong bg-surface px-3 font-mono text-ink"
                value={manualTx}
                onChange={(e) => setManualTx(e.target.value.trim())}
              />
              <Button size="sm" variant="secondary" loading={busy === "record"} disabled={!manualTx || !manualAccount} onClick={() => void record(manualTx, manualAccount)}>
                Verify and link
              </Button>
            </div>
          </details>
        </div>
      ) : null}

      {/* Moderator: approve settlement */}
      {viewer.isStaff && pool && pool.status === "Open" ? (
        <div className="mt-4 border-t border-line pt-4">
          {view.settleBlocker ? (
            <p className="text-sm text-ink-3">Settlement: {view.settleBlocker}</p>
          ) : confirmSettle ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink">
                <strong>Approve this settlement?</strong> {view.plannedOutcome?.reason} The verdict&rsquo;s hash is written on-chain
                with it. This can&rsquo;t be undone.
              </p>
              <div className="flex gap-2">
                <Button variant="judge" onClick={() => void onSettle()} loading={busy === "settle"}>
                  Approve and settle on NEAR
                </Button>
                <Button variant="ghost" onClick={() => setConfirmSettle(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="judge" onClick={() => setConfirmSettle(true)}>
              <Landmark aria-hidden className="size-4" /> Settle stakes from the verdict
            </Button>
          )}
        </div>
      ) : null}

      <p className="mt-4 text-xs text-ink-3">
        Escrow contract:{" "}
        <a className="font-mono underline" href={`${config.explorerUrl}/address/${config.contractId}`} target="_blank" rel="noreferrer">
          {config.contractId}
        </a>
      </p>
    </section>
  );
}
