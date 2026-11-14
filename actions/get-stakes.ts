import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUser } from "@domain/auth";
import { getStakes } from "@domain/near/service";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";
import { verdictInput } from "../server/lib/domain-action-schemas.js";

export default defineAction({
  description:
    "Read a debate's NEAR stakes (Argue Rock): the escrow contract, each side's recorded and on-chain NEAR account, the pool status, whether it was settled (with the transaction hash and verdict hash), and why a moderator can or can't settle it yet.",
  schema: verdictInput,
  outputSchema: z.looseObject({
    competitionId: z.string(),
    config: z.looseObject({ enabled: z.boolean(), network: z.string(), contractId: z.string().nullable() }),
    pool: z.unknown().nullable(),
    settleBlocker: z.string().nullable(),
  }),
  errors: domainErrors,
  http: { method: "GET" },
  run: async ({ competitionId }) =>
    toJson(
      await runDomainQuery(async () => {
        const viewer = await requireUser({ allowSuspended: true });
        return getStakes(competitionId, viewer);
      }, "That debate doesn't exist."),
    ),
});
