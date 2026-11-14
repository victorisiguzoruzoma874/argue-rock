import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@domain/db", () => ({ db: {} }));
vi.mock("@domain/appeals/core", () => ({ getCurrentVerdict: vi.fn(), loadCompetitionCore: vi.fn() }));

const { contractOutcomeFor, plannedSettlement, verdictHash } = await import("./service");

const sides = { A: { userId: "ua" }, B: { userId: "ub" } } as never;
const rows = [
  { side: "A", nearAccountId: "alice.testnet", txHash: "t1" },
  { side: "B", nearAccountId: "bob.testnet", txHash: "t2" },
];
const pool = { side_a: "alice.testnet", side_b: "bob.testnet" };

describe("contractOutcomeFor", () => {
  it("maps wins and draws", () => {
    expect(contractOutcomeFor({ outcome: "A", winnerUserId: "ua" }, { sides })).toBe("A");
    expect(contractOutcomeFor({ outcome: "B", winnerUserId: "ub" }, { sides })).toBe("B");
    expect(contractOutcomeFor({ outcome: "draw", winnerUserId: null }, { sides })).toBe("Draw");
  });
  it("pays the side that didn't forfeit", () => {
    expect(contractOutcomeFor({ outcome: "forfeit", winnerUserId: "ub" }, { sides })).toBe("B");
    expect(contractOutcomeFor({ outcome: "forfeit", winnerUserId: "stranger" }, { sides })).toBeNull();
  });
  it("never settles an inconclusive verdict", () => {
    expect(contractOutcomeFor({ outcome: "inconclusive", winnerUserId: null }, { sides })).toBeNull();
  });
});

describe("plannedSettlement", () => {
  it("pays the winner when both on-chain stakers are the recorded debaters", () => {
    expect(plannedSettlement("B", pool, rows).outcome).toBe("B");
  });
  it("refunds on a draw", () => {
    expect(plannedSettlement("Draw", pool, rows).outcome).toBe("Draw");
  });
  it("refunds when only one side staked", () => {
    expect(plannedSettlement("A", { side_a: "alice.testnet", side_b: null }, rows).outcome).toBe("Draw");
  });
  it("refunds when a stranger holds a side on-chain", () => {
    const squatted = { side_a: "mallory.testnet", side_b: "bob.testnet" };
    const plan = plannedSettlement("B", squatted, rows);
    expect(plan.outcome).toBe("Draw");
    expect(plan.reason).toMatch(/doesn't match/);
  });
  it("refunds when a debater never linked their stake", () => {
    expect(plannedSettlement("A", pool, rows.slice(0, 1)).outcome).toBe("Draw");
  });
});

describe("verdictHash", () => {
  const v = { id: "v1", version: 1, outcome: "B", winnerUserId: "ub", scores: { totals: { A: 60, B: 72 } } } as never;
  it("is a stable sha256 hex", () => {
    const h = verdictHash("c1", v);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(verdictHash("c1", v)).toBe(h);
  });
  it("changes when the outcome changes", () => {
    expect(verdictHash("c1", { ...(v as object), outcome: "A" } as never)).not.toBe(verdictHash("c1", v));
  });
});
