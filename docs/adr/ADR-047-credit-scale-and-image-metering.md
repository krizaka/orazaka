---
title: "ADR-047 — A credit ten times finer, and the last unmetered capability"
description: "Why the floor was charging twice the rate, how an append-only ledger survives a unit change without a single row being rewritten, why the euro price of work is unmoved while the bill falls 44%, and why the blueprint estimates were never 20-60x wrong."
category: ADR
order: 47
---

# ADR-047 — A credit ten times finer, and the last unmetered capability

- **Status**: Accepted
- **Date**: 2026-09-03
- **Scope**: `products/orazaka` — `infra/migrations/2026-09-03-billing-credit-scale-10x.sql` (new),
  `infra/initdb/70-billing.sql`, `infra/initdb/90-dev-fixtures.sql`, `BillingConfigurationService`,
  the five shipped blueprints, `ImageUsage` + `ImageResponse` + `ImageGeneratorClientImpl` +
  `ImageGenerationStrategy`, `orazaka-cli` image launcher
- **Decides**: the pricing question [ADR-046](ADR-046-asset-lists-and-failed-run-settlement.md) §3
  instructed and did not answer

## 1. The credit becomes ten times finer

ADR-046 §3 measured that **37 of 37 token-metered steps fell under the 1-credit floor**, which
charged **1.95× the rate** and made **54 % of every credit billed padding rather than work**. The
per-kilotoken rate decided nothing.

**Decision: 1 old credit = 10 new credits.** The rate stays 1 credit/kilotoken *in old-credit
terms* — 10 new credits per kilotoken — and the floor becomes a tenth of what it was.

Why 10 and not 5 or 100. ADR-046 §3(D) put the inflection at **4.2×**: the smallest step observed
was 237 tokens, so the rate only bites on *every* observed step past 4.2× finer. Ten clears that
with margin and keeps amounts readable — a Reel lands near 150 rather than at 15, where every run
looks identical, or at 1 500, where nothing does.

## 2. The migration, and what an append-only ledger permits

`credit_ledger_entry` is append-only by a `BEFORE UPDATE OR DELETE … FOR EACH ROW` trigger
(ADR-033 §1). Historical amounts therefore **cannot** be rescaled — and must not be. They are
correct as written. What they lack is the unit they were written in.

**Rows are labelled, never rewritten.**

```sql
ALTER TABLE credit_ledger_entry ADD COLUMN unit_version INT NOT NULL DEFAULT 1; -- history is v1
ALTER TABLE credit_ledger_entry ALTER COLUMN unit_version SET DEFAULT 2;        -- new rows are v2
```

`ALTER TABLE` is DDL, not an `UPDATE`, so the trigger never fires; and on PostgreSQL 11+ a constant
default is stored in the catalogue rather than written into rows, so not one row is touched.
**Verified against the live table before the file was written**, inside a transaction that was
rolled back.

The epoch is a property of *when* a row was written, which the database knows better than any
caller — so the default sets it and no producer can forget to. That is deliberate: four defects in
this repository so far were a producer forgetting to stamp something.

**The wallet is rescaled, and the rescale is itself a ledger entry.** `credit_wallet` is mutable
state, not a record of what happened, so ×10 is legitimate there. Recording it keeps the chain
continuous across the boundary — measured on the live database:

| | |
|:---|--:|
| last v1 row (`GRANTED`) `balance_after` | 99 968 |
| v2 conversion entry `amount` | 899 712 |
| v2 conversion entry `balance_after` | **999 680** |

99 968 × 10 = 999 680, and 999 680 − 99 968 = 899 712. A replay verifies *across* the rescale
instead of stopping at it. Ten historical rows kept their v1 amounts untouched.

**v1 of the pricebook is retired, not deleted** — a settled hold names the version it was priced
at, and an audit that cannot resolve that version cannot verify the debit it produced. The seed
carries the retired v1 rows too, so a fresh database is indistinguishable from a migrated one; two
shapes of the same system diverging quietly is how most of this repository's recent defects began.

**Precondition: no `ACTIVE` hold.** A hold pins its pricebook version, so one taken at v1 would
settle v1 credits against a v2 wallet. The migration *refuses* rather than converting them —
rescaling a reservation silently changes what a user was promised.

## 3. The money: the rate does not move, the bill does

`billing.credit.unit-price-cents` could not survive: one credit is now a tenth of a cent, which no
integer number of cents expresses. Leaving the key named `-cents` while the credit got ten times
finer would have read as a **tenfold price rise nobody decided**. It is restated:
`billing.credit.unit-price-millicents = 100`.

| | v1 | v2 |
|:---|---|---|
| 1 kilotoken | 1 credit × 1000 mc | 10 credits × 100 mc |
| = | **1000 mc = 1.00 ¢** | **1000 mc = 1.00 ¢** |

**The rate is unmoved to the millicent.** The *bill* is not, and that was the point:

| the 37 observed steps, 18 961 tokens | credits | millicents | cents |
|:---|--:|--:|--:|
| before | 37 | 37 000 | **37.00** |
| after | 208 | 20 800 | **20.80** |
| | | | **−43.8 %** |

The pure rate on that work is 18.96 ¢; the residual 1.84 ¢ is the new floor plus per-step rounding.
**The 43.8 % is the floor's padding disappearing** — exactly what ADR-046 §3 measured as 54 % of
each credit, seen from the other side. Nothing was discounted; a charge that was never work stopped
being made.

> Honest caveat: `unitPriceCents()` had **no callers**. Nothing prices in euros yet, so this is
> arithmetic on a documented anchor rather than a change with runtime effect today. It matters when
> something starts reading it, and it would have been wrong by 10× if left alone.

## 4. The estimates were never 20–60× wrong

ADR-046 §3 reported the blueprint estimates as 20–60× the observed cost. **That comparison was
unfair and I made it.** It measured each estimate against a run of *two* items — the smallest legal
input for most of these blueprints, and *below* the legal minimum for `realestate-reels`
(`minItems: 3`). An estimate is a hold: it must cover the worst legal input, not the smallest.

Modelled at each blueprint's **maximum** fan-out, at v2 rates, against the old estimate expressed
in v2 credits:

| Studio | max fan-out | modelled | old estimate | ratio | **new estimate** |
|:---|:---|--:|--:|--:|--:|
| trade-showcase | 6 photos | 164 | 1 000 | 6.1× | **210** |
| realestate-reels | 8 photos | 5 064 | 4 800 | **0.9×** | **6 400** |
| outbound-prospection | 50 prospects | 200 | 1 200 | 6.0× | **250** |
| lead-research | 50 prospects | 304 | 600 | 2.0× | **380** |
| followup-sequences | 50 prospects | 408 | 800 | 2.0× | **510** |

`realestate-reels` was **under**-estimated: its `b-roll` step is five seconds of diffusion video at
900 credits/second — 4 500 of the 5 064 — and it fires whenever the user supplies no clip. The old
480 was sized for exactly that, and my 32× figure came from a run where `b-roll` failed with an
HTTP 400 and contributed nothing. The estimates were sized for the worst case; I compared them to
the best.

New estimates are the modelled maximum plus ~25 %, rounded to something a person can read.

## 5. Image generation: the last unmetered capability

`ImageResponse` carried bytes, a URL and a format — nothing `IMAGE_STEP` (`images × steps ×
megapixels`) could be derived from — so every `showcase` step of every Studio run settled at zero.
Same shape as the chat fix, a different port: a typed `ImageUsage(images, steps, width, height)`
beside `ChatResponse`'s `TokenUsage`, with the same `reported()` discipline — **unreported is not
zero**, and an unmeasured generation releases its hold rather than being billed at a guess.

**Where each number comes from, and which one is a promise.** `images`, `width` and `height` are
decided by the adapter and sent to the provider: facts about the request. **`steps` is not in the
request.** `sd-server` takes it as a launch flag, so the meter reports the count the deployment was
configured with — `IMAGE_GEN_STEPS`, now read by *both* the CLI that launches the server (it
previously passed no `--steps` at all) and the adapter that meters it.

**One env var, two readers, and if they diverge the bill is wrong with nothing to say so.** That is
this capability's weakest link and it is recorded here rather than smoothed over. The default was
not assumed: `sd-server --help` reports `--steps … (default: 20)`, so 20 is what the binary in this
deployment actually runs, and passing it explicitly means a future upstream change of that default
cannot silently invalidate the meter. The alternative —
sending steps per request — is not reachable through Spring AI's `OpenAiImageOptions`, and
inventing a step count to satisfy the unit would be worse than either.

Measured: a 512×512 generation at 20 steps is 5.24 megapixel-steps × 19.073 = **100 credits**, which
is now the largest single line in a `trade-showcase` run.


## 6. Measured: the same five runs, before and after

Read from `credit_hold` and `credit_ledger_entry` on the live database. v1 credits are 1 ¢ each,
v2 credits 0.1 ¢ — so a bill that halves in cents is a bill that fell, and one that stands still is
one the rescale did not touch.

| Studio | reserved v1 → v2 | debited v1 → v2 | in cents | move |
|:---|---:|---:|---:|---:|
| trade-showcase | 100 → 210 | 3 → **121** | 3.00 → 12.10 ¢ | **+303 %** |
| lead-research | 60 → 380 | 3 → **14** | 3.00 → 1.40 ¢ | −53 % |
| outbound-prospection | 120 → 250 | 2 → **6** | 2.00 → 0.60 ¢ | −70 % |
| followup-sequences | 80 → 510 | 3 → **10** | 3.00 → 1.00 ¢ | −67 % |
| realestate-reels | 480 → 6 400 | 15 → **140** | 15.00 → 14.00 ¢ | −7 % |
| **total** | | 26 → **291** | 26.00 → **29.10 ¢** | +12 % |

**Two changes pulling opposite ways, and the total hides both.** Read the rows, not the sum:

- **Text and vision fell 53–70 %** — that is the floor's padding disappearing, exactly the −43.8 %
  of §3 seen per run. Nothing was discounted; a charge that was never work stopped being made.
- **trade-showcase tripled** because §5 closed image generation: 100 of its 121 credits are the
  `showcase` step, which was billed **zero** before. Its text half went 3.00 → 2.10 ¢, in line with
  the others. This is not the rescale — it is a capability that was free becoming priced.
- **realestate-reels barely moved** because 120 of its 140 credits are the composition, already
  priced by its rate rather than its floor before the change. A capability whose unit was coarse
  enough had nothing to gain from a finer one, which is the cleanest confirmation that §1 targeted
  the right thing.

Per-step, at v2 rates:

| run | step | measured | credits |
|:---|:---|:---|--:|
| trade-showcase | `showcase` | 1 × 20 steps @ 512×512 = 5.24 Mpx-steps | **100** |
| trade-showcase | `describe` ×2, `caption` | 703 / 731 / 430 tokens | 8 / 8 / 5 |
| lead-research | `research` ×2, `score` | 336 / 336 / 522 tokens | 4 / 4 / 6 |
| outbound-prospection | `angle` ×2 | 238 / 243 tokens | 3 / 3 |
| followup-sequences | `touchpoints` ×2, `polish` | 260 / 251 / 335 tokens | 3 / 3 / 4 |
| realestate-reels | `describe` ×2, `script` | 712 / 679 / 474 tokens | 8 / 7 / 5 |
| realestate-reels | `assemble` | 6 output-seconds | **120** |

Every run took **one hold and settled once**, so ADR-044 and ADR-045 still hold under the new unit.

> The token counts differ between the before and after runs — these are live models, not replays —
> so each row compares two samples of the same workload rather than the same inference twice. The
> effect being measured is a factor of two to three; the sampling noise is a few per cent.

**Estimates against reality, after recalibration:** 210/121, 380/14, 250/6, 510/10, 6400/140. The
prospection three are still 25–85× their *measured* two-item run and within ~1.3× of their modelled
50-prospect one — which is what §4 argued a hold is for. `realestate-reels` reserves 6 400 against
140 because its `b-roll` step, which contributed nothing here (HTTP 400 from the video backend),
costs 4 500 when it succeeds.
