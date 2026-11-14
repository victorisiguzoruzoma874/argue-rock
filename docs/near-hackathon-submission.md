# Argue Rock: NEAR HACKATHON submission kit

- **Deadline:** 14 Nov 2026, 23:59 UTC (00:59 Lagos time on 15 Nov). Submissions can't be edited afterwards, only
  corrected through the organisers' request-changes page.
- **Submit at:** the Project submission form on <https://nearhackathon.com> (#apply).

## Checklist (human)

- [ ] Repository pushed and **public** (judges can't open private repos). URL: `TBD`
- [ ] Demo video recorded (≤ 2 min; see the script below)
- [ ] X post published, saying it was built at NEAR HACKATHON, tagging @NEARProtocol and #NEARHackathon, with the
      video attached. URL: `TBD`
- [ ] Mainnet NEAR account for the payout: `TBD.near`
- [ ] Every form field below checked by you before sending

## Form fields

| Field | Value |
| --- | --- |
| Project name | Argue Rock |
| Team lead | `TBD` |
| Email | `TBD` |
| Team size | Solo |
| Tracks | Social Money; AI Security & Defense |
| NEAR payout account (mainnet) | `TBD` |
| Repository URL | `TBD` |
| Demo post URL | `TBD` |

**Description (about 1,000 characters, limit 2,000):**

> Argue Rock lets people put NEAR behind their argument. Post a hot take, get challenged, and both debaters write
> an opening and a rebuttal. A blind AI judge scores the debate on a published rubric, reads it twice in swapped
> order, backs every score with a checked quote, and never forces a winner.
>
> Both debaters stake the same amount of NEAR in an escrow contract (Rust, near-sdk). When the verdict is final, a
> human moderator approves the settlement, and the contract pays the whole pot to the winner or refunds both on a
> draw. The AI decides who won, but NEAR limits what can happen to the money: the judge key can only pay one of the
> two stakers or refund, settles once, and writes the verdict's sha256 on-chain. If nobody settles within 7 days,
> anyone can trigger a refund. The server verifies every stake transaction on-chain and refunds instead of paying
> anyone who isn't the linked debater.
>
> Live on testnet: escrow.argue-rock-mwgb8n0f.testnet. Tests: 15 contract tests, 10 unit tests, and an e2e test of
> the whole flow against testnet.

## Demo video script (about 90 seconds)

Record with the dev server warmed up (README, section 5). Show one complete moment, from a real action to a
visible result.

1. **(0–10 s) The problem.** "Arguing online is free, so it's cheap. When friends do bet on an argument, someone
   has to decide who won and someone has to hold the money."
2. **(10–25 s) The debate.** Chidi's debate against Tunde ("Android vs iPhone"): the two arguments, then the AI
   verdict (66 vs 70, Tunde wins) and "How this was judged" (blind, judged twice, quotes checked).
3. **(25–50 s) Stake.** As Chidi: **Stakes on NEAR → Connect MyNearWallet → Stake 0.1 NEAR on side A**, approve
   in the wallet, and the panel shows the account with **verified**. Do the same for Tunde on side B. Click the
   tx link once to show nearblocks.
4. **(50–75 s) Settle.** As Ngozi (moderator) on the verdict page: the panel says "Side B won the verdict: the
   whole pot goes to their account". Click **Settle stakes from the verdict**, then **Approve and settle on NEAR**.
   It shows **Settled on NEAR: side B won** and the verdict hash. Open the transaction on nearblocks: 0.2 NEAR went
   to Tunde's account.
5. **(75–90 s) Why NEAR.** "The AI picks the winner. The contract decides what can happen to the money: it can
   only pay one of the two debaters or refund them, and the verdict's hash is on-chain. Repo and contract in the
   post. Tell me what you'd argue about."

## X post draft (you publish it)

> Arguing online is free, so it's cheap. I built Argue Rock at NEAR HACKATHON so you can put NEAR behind your
> argument.
>
> 🥊 Two people debate, and a blind AI judge scores it on a public rubric
> 🔒 Both stakes sit in a NEAR escrow contract, not with the app
> ✅ A moderator approves, and the contract pays the winner. It can't pay anyone else, and the verdict's hash goes
> on-chain
>
> Demo 👇 Repo: <repo link>
> Escrow on testnet: escrow.argue-rock-mwgb8n0f.testnet
>
> What would you put 1 NEAR on? Feedback on the payout rules is welcome.
>
> @NEARProtocol #NEARHackathon @NearBuilders

(About 600 characters with the links; X Premium is needed past 280. A thread works too: the first three lines plus
the video in post 1, the rest in post 2.)
