import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { requireUser } from "@domain/auth";
import { recordStake } from "@domain/near/service";

import { domainErrors, runDomainQuery, toJson } from "../server/lib/domain-action.js";

export default defineAction({
  description:
    "After a debater's own NEAR wallet signed a `stake` on the escrow, link that stake to them. The server checks the transaction on-chain (signer, contract, debate, side) before saving it. Only the debater's browser calls this; the agent never stakes.",
  schema: z.object({
    competitionId: z.uuid().describe("The debate (competition) id."),
    txHash: z.string().min(32).max(64).describe("The NEAR transaction hash the wallet returned."),
    nearAccountId: z.string().min(2).max(64).describe("The NEAR account that signed it."),
  }),
  outputSchema: z.looseObject({ competitionId: z.string() }),
  errors: domainErrors,
  http: { method: "POST" },
  run: async (input) =>
    toJson(
      await runDomainQuery(async () => {
        const viewer = await requireUser();
        return recordStake(input, viewer);
      }),
    ),
});
