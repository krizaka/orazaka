# ADR-071 — Repair the instruments

- **Status**: Accepted
- **Date**: 2026-09-23
- **Scope**: `products/orazaka` — `orazaka-end2end/pom.xml`, three new `scripts/*.mjs`,
  `scripts/generate-docs.mjs`, the parent `pom.xml` (`build-info`), automation-service's
  `application.yml`.
- **Follows**: ADR-061…070. Findings repaired: ADR-069 §6 (the harness) and ADR-070 §9 (the
  registry).

---

## 1. What this run is measured by

It repairs nothing in the product. Its entire output is that **future greens mean something**, so the
measure is not defects fixed but *how many ways a meaningless green remains possible when it ends*
(§8).

Ten runs established one property: **a green must be able to be red.** Two instruments violated it,
and every remaining chantier would have been verified *with* them.

## 2. §1 — the assertion counter, and the number that was never an assertion count

`["TEXT","ASSET"].includes(…)` produces neither ✓ nor ✖: the line is simply absent from httpyac's
output (ADR-069 §0.3). So any assertion in the tier-1 suite could have stopped running with nothing
to say so.

The fix is the **third application of one property**, not a new idea:

| medium | guard |
|:---|:---|
| Java | `GOV-006` fails a rule that completes having examined zero subjects |
| Python | `test_main.py` fails when tests *defined* ≠ tests *collected*, and names the missing |
| here | a green run must have **reported** every assertion the sources **declare** |

`scripts/run-api-contracts.mjs` wraps httpyac, counts both sides, and fails on a difference. It
enforces the count only when httpyac itself succeeded: a failing run has already stopped at
`--bail`, and a derived second failure would bury the real one.

### 2.1 The headline number, and a correction to the question

**Zero assertions were silent.** The last green tier-1 pass declared **79** and reported **79** ✓,
zero ✖. What M4's tier-1 pass proved, it did prove.

**But "121 assertions" was never the assertion count.** httpyac reports `N requests processed` where
N is the number of `###` **regions**, and this suite uses `###` for banner rules and prose as well
as for request delimiters:

| | |
|:---|---:|
| `###` regions — what "121 requests processed" counts | 121 |
| regions that contain an actual request line | **66** |
| assertions declared | **79** |

So the number quoted as proof was inflated 1.8×, and — worse — **it cannot go down when a request is
deleted**, because the `###` stays. Both numbers are printed on every run now.

Seen red against the real suite, with a planted vanishing assertion:

```
[contracts] 66 requests in 121 regions
[contracts] assertions declared 80, reported 79
[contracts] FAILED — this suite declares 80 assertions and the run reported 79.
```

httpyac's own verdict on that run was **success**. Reverted; 79/79.

## 3. §2 — a stale stack answers on the right port with the wrong code

The lost twenty-one minutes were the visible half. The other half is that a green can come from
yesterday's build. Two independent mechanisms, because neither covers the other:

**Identity.** `spring-boot-maven-plugin:build-info` now stamps `build.time` into every service, and
`scripts/verify-stack-identity.mjs` compares what each of the eight services *reports* against what
this tree *packaged*, in the health gate — before the first request, because the Java ITs run in the
same phase and the first of them would otherwise already have asked. Seen red by repackaging a
module under a running service, which is the exact real-world shape:

```
[identity] refusing to test this stack — http://localhost:8090 is running a DIFFERENT BUILD:
  it reports 2026-09-23T12:27:40.166Z, this tree packaged 2026-09-23T12:32:14.915Z
```

**Its limit, stated rather than glossed:** it compares *builds*, so a stale stack from the **same**
build passes. That case is covered by the reset below, not by this check.

**Reset at the start.** Maven has no `finally` and nothing survives a Ctrl-C, so the only teardown
that always happens is the one at the *beginning*. `reset-stack-before-start` kills leftover service
JVMs and runs `docker compose down -v` before anything else.

### 3.1 The teardown had never worked at all — not on red runs, and not on green ones

While checking that teardown ran after a *recorded* failure, the containers were gone and **eight
service JVMs were still listening**. `post-integration-test` had demonstrably executed. The cause is
structural: each service is launched through `/bin/sh -c "… java -jar …"`, so `process-exec`'s
`stop-all` tracks and kills the **shell**, leaving the JVM orphaned on its port.

So the finding recorded in ADR-069 §6 — "no teardown on a red build" — was the smaller half of it.
Every service start is now `exec java -jar`, which makes the tracked pid the JVM itself. Proven
directly:

```
shell pid 87041; java pids: 87041          ← exec replaced the shell
after killing the tracked pid → java pids: ''
```

## 4. §3 — "hermetic" was a claim; it is now a property, and proving it cost three real defects

`docker compose up` over a surviving volume meant `infra/initdb` never replayed. `down -v` first
makes every run start from an empty volume — and the first run that genuinely did exposed what that
had been hiding.

1. **The stack did not come up from empty at all.** `infra/initdb/*.sql` creates every context role
   with `LOGIN` and **no password** — psql 15 has no `\getenv`, ERR-125 bans a shell script there,
   and a committed literal was audit #5. The seeds say the password is applied afterwards by
   `orazaka start`, which the harness does not run. On a surviving volume the roles already had one
   from some earlier `orazaka start`; from empty, `identity-service` dies with
   `FATAL: password authentication failed for user "orazaka_identity"`.

   **So no scripted path from empty existed for the harness**, which is what §3 predicted would be
   the finding. `scripts/apply-db-role-passwords.mjs` is the minimum fix — one `ALTER ROLE` per
   context, **not** a migration framework. The contexts are *derived* from the seeds
   (`CREATE ROLE orazaka_<ctx> LOGIN`), so a seventh is covered by the file that creates it; the
   CLI's copy carries a hardcoded five and will not be (§9).

2. **`automation-service` exposed no `info` endpoint**, so it could not say which build it was.

3. **My own script reported success while leaving the thing broken.** It printed
   `5 context roles can authenticate` and identity-service still died: the CLI passes the password
   through a shell that strips `JSON.stringify`'s quotation marks, and `execFileSync` has no shell,
   so the quotes became part of the password. *A meaningless green, produced by the run that exists
   to remove them* — caught only because a different instrument refused the stack.

**Nothing applies `infra/migrations/*.sql`, and from an empty volume nothing needs to**: migrations
exist to carry an *existing* developer database forward, and the seed is authoritative for an empty
one. Whether Flyway should own them is a separate decision with its own trigger, deliberately not
taken here.

### 4.1 Proven by running twice from empty

Two consecutive runs, each from `Volume orazaka_pgvector_data Removed → Created`, produced
**identical** verdicts — same tier-1 counts, same failing tests in the same executions:

```
run 5: 79/79 declared/reported · playwright(2 failures) · playground-media(4 failures)
run 6: 79/79 declared/reported · playwright(2 failures) · playground-media(4 failures)
IDENTICAL: True
```

`[identity] 8 services all report this build's timestamp` on both — the whole stack now reaches a
working state from nothing.

### 4.2 What the gate now fails on, which is the point

The remaining failures are **product**, not instrument: `retrieveJob` and
`jobLeavesPendingAndNotOnAnAuthFailure` get `404` retrieving a job the run demonstrably dispatched —
open finding **#37**, *worker-routed Studio steps have no job row*. The run records the `jobId` on
its step (`startRunAndFindItsJob` passes) and no row exists to fetch. Not repaired here.

## 5. §4 — the registry said `none` about seven rules that are enforced

Attribution built a `Map` keyed by bare method name, so of two overloads only the **last** survived
and every call site was attributed to it; the earlier one read `Enforced by **none**` forever.
AGENTS.md §10 makes that column a *finding*, so seven false positives teach the reader to ignore the
one column that says whether a control is wired.

The eleven previous instances of this project's defect produced a **green that meant nothing**. This
one produced a **red that meant nothing** — it fails socially rather than silently, in the index of
every other control.

Attribution is now derived from what suites **invoke**, qualified by the holder class, with static
imports handled, and overloads collapsed into one rule. Two further corrections were needed, and
both are old lessons in new clothes:

- **delegation**: `ExecutorCoherenceRules`' two rules are called in nine suites — through a
  `GovernanceRules` facade. Direct-call attribution reported them as orphans, the instrument still
  wrong in the other direction. Suites now propagate along delegation edges to a fixpoint, scoped to
  the caller's **method body**: scanning whole files made every rule in `GovernanceRules` a caller
  of everything the file mentions.
- **a declaration is not a call**: `public static void assertX(` matched as a call to `assertX`,
  which silently rehabilitated the only genuinely orphaned rule. Same correction [DOOR-001] needed
  when a comment counted as a dispatch, and the Python contract before it.

### 5.1 The M1.7 question, re-asked with a working instrument

**One rule genuinely reads `none`: `GovernanceRules.assertSupportPackageHygiene`** — the [ERR-130]
support-package rule. It appears exactly twice in the repository: its own declaration, and the
registry row reporting that nothing calls it. Written, compiled, enforcing nothing. Reported, not
wired, because wiring it is a repair this run did not come to make.

Seen correct with a planted rule reachable only through an overload behind a facade — the two things
that were broken:

```
| `assertPlantedOverloadRule` | `EdgeGovernanceTest` | PLANT — reachable only through an overload behind a facade |
```

Reverted; the count returns to one.

## 6. Everything here is static or local

No CI, no cloud (AGENTS.md §0). The three scripts are plain node, run by Maven; the identity check
and the counter need only the stack the harness already starts.

## 7. Open findings, relisted in full

**Closed by this run**: ADR-069 §6's 🔴 *no teardown on a red build* (and the larger defect behind
it), 🔴 *httpyac can drop an assertion without reporting anything*, 🟡 *not hermetic*, and ADR-070
§9's 🟡 *the registry says `none` about rules that are enforced*.

**Still open, none closed in passing**: `#19` (the M2M JWT — a deployment blocker), `#29` (`pypdf`
undeclared), `#33` (a protected job that never reaches terminal is never purged), `#34` (a timed-out
execution is not cancelled), `#36` (dead-letter queues nothing consumes), `#37` (worker-routed
Studio steps have no job row — **what the e2e gate now fails on**), `#38` (STANDARD jobs have no
window in the job plane), `#39` (`purgeJobsByUserId` leaves directories), `#40` (`studio_outbox`
never purged), `#41` (`dataClassOf` reads an unknown studio as STANDARD), `#42` (automation
connector jobs carry no data class), `#47` (two automation notification listeners cannot fail today,
so their dedup claim is safe by accident), plus ADR-069 §6's remaining: 🔴 no GraphQL server exists
while the CLI calls `/graphql`; 🟡 three services log a health failure and start anyway; 🟡 nothing
applies `infra/migrations/*.sql` by hand-free means; 🟡 `compose` has no captions/brand/b-roll/aspect;
🟡 `MediaApi.searchRag` has no caller; 🟡 an unused `eslint-disable` in the web BFF; 🟡
`HttpCapabilityRoutingAdapter` reads a 401 or 503 as "no route" and caches it.

**New, found by the repaired instruments**:

1. 🔴 **`assertSupportPackageHygiene` enforces nothing** (§5.1).
2. 🟡 **`-Dit.test=` makes the gate run its suites twice.** The two failsafe executions
   (`e2e-tier3-playwright`, `e2e-tier3-playground-media`) both match the filter, and the second pass
   is **not independent** of the first: `startRunAndFindItsJob` returns 202 in the first execution
   and 409 in the second. A red can therefore be caused purely by re-running. The default path, with
   no filter, does not overlap.
3. 🟡 **The CLI's `applyRolePasswords` carries a hardcoded five-context list** while the harness now
   derives the same set from the seeds. Two implementations of one step, one of which will go stale.
4. 🟡 **`skipCliE2E` is referenced once and declared nowhere**, so the property does not resolve and
   the tier-2 CLI suite runs by default. Fragile rather than wrong.

## 8. What ways of producing a meaningless green remain

Named, because "none that I know of" would be the easier answer and it is not the true one:

1. **The counter compares counts, not identities.** Two changes that cancel — one assertion
   vanishing while another is added — pass. Comparing the assertion *texts* would close it.
2. **The identity check cannot detect a stale stack from the same build** (§3). The reset-at-start
   covers it today; if that step were ever removed, nothing would notice.
3. **The Python media worker has no actuator**, so it is outside the identity check. A stale worker
   would still be talked to.
4. **Tier-1 proves the assertions ran, not that they assert anything.** `?? status >= 200` and
   `?? status < 500` both ran and reported on every pass; they accept a 404. The counter cannot see
   the difference between a contract and a formality.
5. **A control that exists and is never invoked is still green** — that is finding 1 above, and the
   registry now shows it rather than preventing it.

The first four are the next run, if there is one.
