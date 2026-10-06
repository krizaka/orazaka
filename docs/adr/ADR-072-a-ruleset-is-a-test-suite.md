# ADR-072 — A ruleset is a test suite pointed at the user's document

- **Status**: Accepted
- **Date**: 2026-09-24
- **Scope**: `orazaka-packs/document-validation` (rulesets, worker, suite),
  `orazaka-packs/wellbeing` (one prompt), `orazaka-apps/ui/orazaka-cli` (worker discovery),
  `orazaka-libs/orazaka-test-support` (the grants guard), `infra/initdb` + one migration.
- **Source**: `docs/evaluations/first-real-use.md` — 18 findings, 12 content-caused.

---

## 1. The property, and why it had never been applied

`FR-LEASE-001` checked that the word *bailleur* appears, for a requirement that is **the identity of
the parties**. Every lease contains that word. It is an assertion that runs, over a real subject, and
**cannot fail** — rung 4 of the ladder these runs spent twelve phases climbing, except this one is in
the product, and its output told a user a BLOCKING legal requirement was satisfied.

Every property this repository demands of a governance rule — a population it must prove non-empty, a
plant that must redden it, a derivation rather than a transcription — applies to a ruleset, and none
had ever been applied, **because rulesets were treated as content rather than as assertions.**

So: **every deterministic rule ships two fixtures it must distinguish** — a fragment that must PASS
and one that must FAIL — and the pack's suite refuses the ruleset when a rule cannot tell its own
pair apart. A rule that always passes fails its negative fixture; a rule that always fails fails its
positive one.

**Fixtures are written from the requirement, never from the pattern.** One written by reading the
regex proves the regex matches itself, which is the same defect one level out.

`JUDGMENT` rules are exempt and say so: their verdict comes from a model, and a model call at
validation time would make the check as unreliable as the thing checked.

### 1.1 The headline: 8 of 20 could not distinguish their own pair

Measured across all three shipped rulesets, before any repair:

| ruleset | deterministic rules | could not discriminate |
|:---|---:|---:|
| `fr-residential-lease/2026-07-01` | 9 | **4** — `001`, `002`, `003`, `009` |
| `fr-residential-lease/2024-07-01` | 8 | **3** — `001`, `002`, `003` |
| `be-residential-lease/2025-01-01` | 3 | **1** — `BE-WAL-001` |
| **total** | **20** | **8** |

Two of the eight were known from the evaluation. **Six were not**, and two of those matter on their
own:

- **`FR-LEASE-002` is both a false PASS and a false FAIL.** Its pattern is the word *locataire*. A
  lease writing *"Le preneur, Mme Claire Petit"* — the ordinary legal synonym — returned FAIL, while
  one naming nobody returned PASS.
- **`FR-LEASE-009` never fired at all.** *"Le logement est classé G au diagnostic de performance
  énergétique"* did not match: the pattern wanted the letter *after* the DPE phrase. **A class-G
  property, which it is illegal to rent, passed the rule that exists to refuse it.** The evaluation
  recorded this rule as correct — it was correct by accident, because that document contained no
  violation. A fixture pair found in one second what a real run could not.

### 1.2 Superseded versions are exempt, and the reason is the pack's own guarantee

The check judges the newest version of each ruleset only. A run is replayed against the rules in
force on its `asOf` date — *"a document judged against the rules of 2025 reaches the same verdicts
next year"* — so correcting a rule in a superseded version would change a verdict already delivered
to someone. That is rewriting history, not fixing a rule. The three frozen `FR-2024` failures are
recorded here rather than repaired.

### 1.3 Enforced twice, and the second one is the one that matters

It runs in the pack's own suite, which the Maven build executes. **That is enforcement for packs in
this repository and discipline for anyone else**, which is not what the property needs: a ruleset
author may be outside this repository and cannot be asked to remember (AGENTS.md §12).

**So it also refuses at install.** `RulesetFixtureValidator` runs inside `PackBundleResolver.read`,
before anything the manifest claims is believed — a bundle that does not resolve does not install,
and the same resolver serves the REST install path, so a third-party bundle is judged identically.

The placement avoided a contract change that first looked unavoidable. `PackBundle` is a Tier-1
record, and carrying `rulesets` into it would ripple through every construction site; the resolver
already holds the directory and already refuses malformed bundles, so the check belongs where
"directory becomes installable" is decided. Zero contract change.

**The engine evaluates a pack's rules without interpreting them.** The pack declares the pattern,
the quantity and the two fixtures; the platform runs the comparison it declared. The check types are
a closed declarative set — `REQUIRED_PATTERN`, `FORBIDDEN_PATTERN`, `NUMERIC_RATIO_MAX` and the
`NUMERIC_MIN` added here — so the mechanism is ours and the subject never is.

Seen refusing, with both defects planted as cases rather than described: a rule matching every
document (`FR-LEASE-001`'s shape) and a rule matching none (`003`'s), plus a deterministic rule
shipping no pair at all. `JUDGMENT` rules and superseded versions are exempt for the reasons above,
and each exemption is a case too.

## 2. `001`, `002`, `003` — one defect, named

**A lexical check where the law states a semantic fact.** Not two broken rules: a way of writing
rules.

- `001`/`002` required a word; art. 3, 1° requires the parties to be **identified**. Now: the party
  term must appear near an identity token (a civility, a name, *demeurant*, *domicilié*, a company
  number), in either order.
- `003` required the phrase *durée du bail*; art. 10 requires a term of **at least three years**.
  That one shape failed twice in a single pass on a real lease — a false FAIL because the document
  said *"pour une durée de deux ans"*, and **the real violation missed**, because two years *is* the
  breach and a presence check cannot see a number. Now a new `NUMERIC_MIN` check reads the term in
  digits or in words and compares it to the floor:

  ```
  FAIL — "La durée énoncée est inférieure au minimum légal … Constaté : 2 an(s)."
  span  — {"quote": "durée de deux an"}
  ```

`BE-WAL-001` carried the identical defect and is corrected the same way; `FR-LEASE-009`'s pattern was
rewritten to match either order. Both were outside §4's instruction but a control left red is not a
control, and the count above is what records the state found.

### 2.1 Lexical versus semantic, counted

Of the nine deterministic rules in the current FR ruleset:

- **2 are genuinely lexical** — `004` (the rent must be stated as a figure) and `008` (the DPE must be
  annexed). The law asks for a mention; presence *is* the requirement.
- **7 are semantic.** Three were implemented lexically and are fixed here (`001`, `002`, `003`); one
  was already numeric (`005`); and **three remain lexical approximations** — `006`, `007` and `009`
  detect a clause's *effect* by matching one phrasing of it.

**So it is a ruleset, not two rules.** Three requirements were still matched by a single turn of
phrase, which is `003`'s shape surviving — they discriminated their fixtures, so they were controls,
but they were not robust.

### 2.3 The three remaining ones, made robust — and what that cost to prove

A pair proves a rule *can* fail. It does not prove the rule catches the requirement when a lease
words it differently. So a rule may now declare a **list** on either side, and every fragment is
checked: *broadening a pattern and proving the broadening are the same edit.*

`006`, `007` and `009` each declare four prohibited phrasings and two or three lawful ones.
Measured before any pattern change, **7 of the 11 prohibited phrasings were missed** — which is what
"lexical approximation" was worth in numbers:

| rule | missed before | now |
|:---|---:|---:|
| `006` solidarity outliving the notice | 3 of 4 | 0 |
| `007` a ban on receiving or housing someone | 3 of 4 | 0 |
| `009` the class-G label | 1 of 4 | 0 |

The patterns now carry the connectors a lease actually uses — *postérieurement à*, *survit à*, the
negative *ne met pas fin*, *prohibée*, *s'engage à ne pas héberger*, *étiquette énergie*.

**The PASS fixtures are the half that matters when widening.** They carry the near-misses on
purpose: solidarity that is lawful *during* the lease, a sublet restriction that is not a visitor
ban, a DPE of class F, and a `GES : classe D` mention that must not read as class G. A prohibition
that fires on a lawful clause is a false FAIL, and widening a pattern is precisely when that gets
introduced — all seven still PASS.

### 2.2 A FAIL without an `evidenceSpan` should not be emittable

A finding a user forwards to their counterparty must survive being checked. A `FAIL` says *this
document breaches this rule*, and the only thing that makes that checkable is the text it points at.

The three verdicts divide cleanly:

- **`FAIL` must carry a span.** It asserts something about the document, so it can quote it. Where a
  rule cannot produce one, the honest verdict is `INSUFFICIENT_EVIDENCE`, which already exists.
- **`PASS` on a `FORBIDDEN_PATTERN` cannot carry one** — nothing was found, and that is the finding.
- **`INSUFFICIENT_EVIDENCE` cannot carry one** by definition.

Today `FR-LEASE-003`'s old `FAIL` had `evidenceSpan: null` and said *"Aucune durée n'est énoncée"*
about a document whose Article 2 was headed **Durée**. The span's absence was the tell, and nothing
read it. **Not built here** — making it structural means `_finding` refusing a span-less `FAIL`, and
every `REQUIRED_PATTERN` rule currently emits exactly that on failure, so it is a ruleset-wide
change. Recorded with its trigger: **with the install-time check of §1.3**, since both touch the same
contract.

## 3. Decisions recorded, deliberately not built

### 3.1 Every guard is input-side, and the wellbeing pack is where that costs

All six gates passed — consent, statement version, age, sourced region, the four crisis resources
verified at source, the scope guard refusing in the pack's own words and **not** refusing its own
template. And `guided-journaling` returned *"Je suis désolé d'apprendre que vous avez…"*: second
person, the assistant reassuring and advising, the exact register ADR-055 excludes so the product
makes no medical claim.

The reason is structural. **The scope guard reads the subject, the crisis guard reads the subject,
and nothing reads the output** — while this pack's regulatory exposure is in the register of what it
produces.

**The prompt is fixed** (blueprint `1.1.0`): it now forbids address rather than requesting a voice —
no *vous*, no imperative, no advice, no reassurance, the assistant absent from the text.

**No output guard is built, and the reason is the point.** The cheap version is a lexical check for
second-person pronouns and imperatives — precisely §2's defect, rebuilt one layer out, on a pack
where a false positive silences someone mid-entry. The expensive version is a second model pass,
whose checker has the same failure mode as the thing checked. **Trigger: before the wellbeing pack is
offered to anyone outside this project.**

### 3.2 A refused run has already billed the step that ran before the refusal

The scope guard fires on `judge`, so `screen` succeeded and was charged. Work was done, so billing it
is defensible — but being charged to be told *"Je ne donne pas de conseil juridique"* is an
experience worth choosing rather than inheriting.

**Decision: on a `GUARD_REFUSAL`, the run's hold is released in full and nothing is settled.** The
reasons, in order of weight:

1. **The platform, not the user, decided the turn would not complete.** A refusal is the product
   working; charging for it makes the control feel like a penalty.
2. **The amount is trivial and the message is not.** `screen` is deterministic regex work with no
   inference behind it — the marginal cost is nothing, and the line item is the first thing a user
   sees after being refused.
3. **It is already distinguishable.** `failure_cause = GUARD_REFUSAL` is on the run and on the audit
   row (ADR-053), so settlement can branch on a typed cause rather than on prose.

The asymmetry decides it: refunding a refusal costs a few credits of deterministic work; charging for
one teaches users that the guard is something to route around. **Not implemented here** — it is a
change to `RunSettlementService`, and this run's scope is the rulesets.

## 4. The three code blockers, and one correction to the evaluation

**Closed.** *Nothing started a pack's worker.* `orazaka dev` launched eight JVM services and two UIs
and no Python at all. `worker.yaml` declared what a worker drains and **not how to run it**, and the
two workers in this repository start differently — one as a module, one as a script beside a venv a
directory up. Both now declare a `run:` block and `orazaka dev` discovers every `worker.yaml` and
spawns it, so a pack shipped from outside this repository starts without editing the launcher.

**Closed.** *Four of six packs unusable on a fresh volume.* The grants guard existed and was green
because I had scoped it to `TOOLKIT` packs — see §5. Widened, it reddened on seven studios; reading
that list showed two of the four packs were behaving **correctly** (`document-validation` and
`realestate-studio` declare 4 900 cents, so their grant arrives with a purchase and a plan row would
make a sold pack free). The guard is now keyed on each pack's own `pricing.priceCents`: a **free**
pack no plan grants is unreachable by anyone and fails the build. `echo-toolkit` and `bien-etre` are
granted on all three plans — which does not make `bien-etre` installable, since REGULATED keeps the
consent gate, the age attestation and the sourced-region check in front of every installation.

**Open, and now with a measurement that kills one of its two designs.** *No job row exists for any
step* (`#37`). Diagnosed precisely: `JobListener.adoptIfUnknown`
creates the row, and it only sees the two job-service lanes. A step routed to `job.validation.*` or
`job.compose.*` lands on a worker's own queue that the job service never consumes, so nothing writes
it. The two viable designs both have costs worth deciding rather than picking: the job service binds
an observer queue to `job.#` (a topology change, with double-consume to reason about), or the studio
service registers the row over `/internal/v1` (a new inbound surface, which [DOOR-001] exists to
watch). **Consequence, and the reason it matters: `data_class` on jobs remains unverified** — a
control built in M1.8 that has still never been observed, because there is nothing to observe it on.

### 4.1 The observer queue was built, measured, and withdrawn

The two designs were "the job service binds an observer queue to `job.#`" and "the studio service
registers the row over `/internal/v1`". The second adds an inbound surface on the service that owns
the run, which [DOOR-001] exists to watch, so the first looked clearly right: the owner of
`orazaka_jobs` learns about every dispatch by listening to the exchange that carries every dispatch,
no context writes another's schema, and `adoptIfUnknown` is already idempotent so a lane also
carrying the command cannot double-write.

**It was built and it works, and then it was measured.** Across four runs — twelve steps — the rows
appeared, each carrying `data_class = SENSITIVE`, and **7 of 9 surviving rows were stuck at
`PENDING`** against 2 `COMPLETED`.

The race is the whole story: the executing consumer finishes and calls `updateJobStatus`, which is a
no-op because the registry's copy has not landed yet; the registry then writes a fresh `PENDING` row
that nothing will ever move. For a worker-executed step there is no recovery either —
`JobReconciliationService` recovers stuck jobs from an on-disk `result.json`, and a pack worker's
result travels over AMQP.

So the design replaces *"no row exists"* with *"a row exists and misreports its state"*, and those
rows are SENSITIVE and therefore never collected (`#33`). **For the dashboard support actually
reads, a row that lies is worse than a row that is missing.** Reverted.

**What the experiment did settle**, and it is worth keeping: `data_class = SENSITIVE` appeared
correctly on every job row it produced. The M1.8 control had never been observed because there was
nothing to observe it on; it has now been seen working on the persistence path, on real rows, from a
real SENSITIVE run — with the honest caveat that the consumer which created those rows is withdrawn,
so production still has none.

**The fix direction this measurement points at** is not a topology change. Whatever reports a job
terminal must be able to **create** the row it updates, which means the done event carrying the
job's identity — feature key, actor, data class — rather than only its id. That is a declaration
change in the shape of AGENTS.md §12, and it is the thing to build. Not built here.

**Corrected.** *The declared `timeout: PT2M` is not enforced* — but my evaluation overstated it.
`RunSweeper` **does** exist and does fail timed-out steps every 60 s; it judges by **lane**
(`INTERACTIVE` 300 s, `BATCH` **1800 s**), not by the blueprint's declaration. The twenty minutes I
observed were inside the real 30-minute budget, not un-swept. The true finding is narrower and still
real: **a per-step `timeout` declared in every blueprint is read by nothing**, so a pack author writes
`PT2M` and gets thirty minutes — a declared control that does nothing, this time in a pack manifest.

## 5. What §0 asked, answered

The guard was added and it was green **legitimately**, over a population of one pack, because I
scoped the asked-for property — *no PUBLISHED studio of an installed pack without a grant in at least
one plan* — down to `kind: TOOLKIT`. The reasoning was that a VERTICAL's grant arrives with its
purchase, so a plan row would be a false positive for a pack that is sold. **True about the mechanism
and false about the outcome**: nothing walks the purchase path on a fresh install, so "the grant comes
from the purchase" described a door nobody opens. Not a control declaring itself active while inert —
a control whose population I chose too narrowly, and the sentence that encoded it reads like a
precision (`ADR-070 §4.1`: *"VERTICALs are deliberately out of scope"*) while being an exemption.

## 6. Open findings, relisted in full

**Closed by this run**: the pack worker nothing started; four of six packs unusable out of the box;
`FR-LEASE-001`/`002`/`003` and `BE-WAL-001`/`FR-LEASE-009`; the journaling prompt's register.

**Still open**: `#19` (M2M JWT), `#29` (`pypdf`), `#33`, `#34`, `#36`, **`#37`** (§4 — and it blocks
verifying `data_class` on jobs), `#38`–`#42`, `#47`; ADR-069 §6's remaining (🔴 no GraphQL server
while the CLI calls `/graphql`; three false health alarms; nothing applies `infra/migrations/*.sql`;
`compose`'s five dead inputs; `MediaApi.searchRag` uncalled; the BFF `eslint-disable`;
`HttpCapabilityRoutingAdapter` reading 401/503 as "no route"); ADR-071 §8's five meaningless-green
paths; ADR-070 §9's `assertSupportPackageHygiene`, `-Dit.test=` doubling the suites, the CLI's
hardcoded context list, `skipCliE2E` undeclared.

**From `first-real-use.md`, still open**: neither validation Studio accepts an uploaded asset (B1);
the typed failure cause is not exposed to the client (B6); the blueprint `timeout` is read by nothing
(§4 above); five Studios show their raw key as their label (A6); the reel discards `clip` (A7) and
`platform` changes only the caption (A8); `{{steps.roomDescriptions}}` references a step and not a
field (A9); the wellbeing remedy points at a plan upgrade that would not help (A10); the worker
fixtures cannot exercise the ruleset (A11); the FR crisis resource is sourced from a regional page
(A12); `evidenceSpan.quote` carrying English prose (A3) and word-level spans (A4).

**New**: the pack's own suite collects **module-level `test_*` functions only** — a `unittest.TestCase`
added to `test_rules.py` is silently ignored, which is M1.7's defined-equals-collected defect inside
the pack that ships the rules.

## 7. Two corrections to this run's own record

**1. The build is not "offline-incapable" — that claim was too strong.** This run's commit and report
said `npm-build-web` fails on a network fetch of Google Fonts and called the build offline-incapable.
What was shown is narrower: `next/font/google` fetches at build time, and on that day the fetch
failed twice (once with this run's changes stashed, which is why it read as structural). Turbopack
surfaces a failed font fetch as `Module not found: Can't resolve
'@vercel/turbopack-next/internal/font/google/font'` — an import-map error that names no network, which
is what made the misreading easy. Re-run later, the same command returns **exit 0 with zero font
errors**. The network dependency is real and documented in the `next/font/google` API; the permanent
failure was not.

**2. A regression of mine was hidden behind that failure, and the shape is worth keeping.** The
reactor stops at the first failing step. `npm-build-web` runs in the parent's `compile` phase and
`validate-cli` runs after it, so while the font fetch was failing **nothing downstream of it ran** —
including the CLI suite, where adding a `workers` tier to `resolveEnabledServices` broke two
assertions that pin the exact service set. The first full build after the fonts came back found them
immediately (`2 failed, 209 passed`). *A red step upstream does not merely delay the steps behind it;
it makes their verdicts unavailable while looking like one failure.* Both assertions now pin the new
tier.
