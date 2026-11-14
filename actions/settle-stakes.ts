import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireRole } from "@domain/auth";
import { settleStakes } from "@domain/near/service";

import { authorizeModerator, domainErrors, runDomainQuery } from "../server/lib/domain-action.js";
import { verdictInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Moderators only. Settle a debate's NEAR stakes from its final verdict: the judge account tells the escrow contract the outcome (A, B or Draw) and the verdict's sha256 is written on-chain. The contract can only pay one of the two debaters or refund both. A human decides: an agent call always needs the moderator's approval.",
  schema: verdictInput,
  outputSchema: z.object({
    competitionId: z.string(),
    outcome: z.string(),
    reason: z.string(),
    verdictHash: z.string(),
    txHash: z.string(),
    explorerTxUrl: z.string(),
    paidTo: z.string().nullable(),
    paidAmountYocto: z.string().nullable(),
    poolStatus: z.string().nullable(),
  }),
  errors: domainErrors,
  http: { method: "POST" },
  needsApproval: true,
  authorize: authorizeModerator,
  run: async ({ competitionId }) =>
    runDomainQuery(async () => {
      const viewer = await requireRole("moderator");
      return settleStakes(competitionId, viewer);
    }),
});
