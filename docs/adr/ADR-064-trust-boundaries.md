---
title: "ADR-064 — Four trust boundaries: a namespace instead of a line order, tests that were never counted, a failure posture somebody chose, and logs as a channel"
description: "M1.7, the last remediation run before M2. User-written preferences move under their own namespace and the pipeline merges only namespaces, so a preference can no longer name the actor or remove the credit hold. The Python runner must collect every test its files define. Controls declare that they fail closed, and the credit gate fails open only with a durable, reconcilable record. No logging call may take a prompt or a response — a rule anchored on the operand stack, not on names."
category: ADR
order: 64
---

# ADR-064 — Four trust boundaries

- **Status**: Accepted
- **Date**: 2026-09-15
- **Scope**: `Context`, `DynamicPipelineExecutor`, `PromptContextInterceptor`, both `ContextService`s,
  `IntentController`, `IdentityServiceImpl`, `JobListener`, the governance and reformulation interceptors,
  `JobMeteringService`, `UnmeteredTurn` (billing-api) and its outbox and billing ends; the media
  worker's test runner; `LoggedContentRules` [LOG-001] and eighteen logging sites
- **Implements**: M1.7 of [`UNIFIED_PACK_SURFACE.md`](../UNIFIED_PACK_SURFACE.md)
- **Closes**: audit #23, #24, #25, #26
- **Follows**: [ADR-063](ADR-063-the-media-turn.md)

## 1. #23 — caller-controlled keys in a trusted map

### 1.1 The chain, and the order nobody chose

```java
userMetadata.put("userId", context.userId());
userMetadata.put("conversationId", context.conversationId());
userMetadata.putAll(context.preferences());    // user-written
userMetadata.put("roles", …);                  // below the merge — safe by position alone
```

`PUT /api/v1/profile/preferences` merged any map into the user record, `ContextService` copied it into
`Context.preferences`, and the executor merged that raw. A stored `userId` replaced the actor the
credit hold was taken on; a stored `orazaka.metering.deferred` removed the hold. `roles` survived only
because its line sits below the merge.

Found while reading, and worth saying because it is the same accident twice: on paths where the
Spring security context holds the principal, `UserContextResolver` (Phase 1) writes `userId` back from
the principal before `EntitlementInterceptor` runs. The actor was being restored by a second line
order. `conversationId` and the metering marker were not.

### 1.2 Namespace, not reorder — the discipline `JobListener` already had

`JobListener` never merged a job's payload raw: it merges a map filtered to `orazaka.*`. The
preferences path never received that discipline. Both halves of the fix copy it:

- **The merge takes a namespaced map.** `DynamicPipelineExecutor` merges only keys under
  `Context.PLATFORM_NAMESPACE` (`orazaka.`) and `Context.USER_PREFERENCE_NAMESPACE`
  (`preference.`). The engine's own keys carry neither, so none can be written by what crosses. **The
  three `put`s were not moved.** Nothing depends on their order any more; a fourth engine key written
  above the merge is as safe as the three.
- **What a user wrote goes under their own namespace**, at every context builder: both
  `ContextService`s (the user record and the profile's raw preferences) and `IntentController`. The
  namespace is not new — `SecurityContextUtil` already put every preference under `preference.`;
  `Context.userPreferences` now owns it, and both use it. The session moved to
  `orazaka.pipeline.sessionId` and the typed profile to `orazaka.user.profile`: the platform's values,
  under the platform's namespace.

Readers moved with the keys: `LanguageAlignmentInterceptor` and `UserContextInterceptor` read
`preference.*`, `SystemContextInjector` reads the namespaced session. `IdentityServiceImpl` refuses
keys under either namespace and the engine's three bare keys with `400` — **depth**: it stops bad data
being stored for a future builder that forgets the namespace; it is not what makes the collision
impossible.

**Why both halves.** The plant in §1.4 shows it: with the builder raw and the executor namespaced,
`userId` is dropped but `orazaka.metering.deferred` crosses — it is in the platform's namespace — and
the hold disappears.

### 1.3 The sweep — every non-test `putAll`

*Is the source fully controlled by the callee?*

| Site | Source | Verdict |
|:---|:---|:---|
| `DynamicPipelineExecutor.process` → `userMetadata` | `Context.preferences` | **✗ was the defect** — now a namespaced merge |
| `ContextService` ×2 → `preferences.putAll(profile.rawPreferences())` | the user's profile | **✗ same defect** — namespaced; so was `new HashMap<>(user.preferences())` two lines above, the copy-constructor form of the same merge |
| `IdentityServiceImpl.mergeAndSavePreferences` → `merged` | the request body | ✓ the user writing their own record is the endpoint's purpose; reserved keys now refused (depth) |
| `UserContextResolver` → `newUserMetadata.putAll(securityData)` | the authenticated principal | ✓ identity fields from the principal; its preferences were already under `preference.` |
| `SystemContextInjector` → `newSystemMetadata.putAll(systemData)` | literals | ✓ |
| `RunSagaService.effectiveConfig` → `effective.putAll(installationConfig)` | the installation's configuration over the blueprint's defaults | ✓ the actor overriding defaults is the design; the map holds template values only, no trusted keys |
| `JobListener.withProducerPreferences` → `merged.putAll(namespaced)` | a job payload's `orazaka.*` keys | **⚠ the discipline itself — but its source is not fully a producer.** `POST /api/v1/jobs` takes `payload` as a raw map from the end user, so door 1 lets a user write `orazaka.*` keys. No live bypass found: no pack guard is armed on door 1, and the metering marker only matters when no job hold exists. Recorded for M3, which closes door 1 |
| **`JobListener.measureConsumption` → `consumption.putAll(reported)`** | an executor's typed report | **✗ same shape in the metering path.** No worker reaches it — workers publish `job.done` themselves — but ADR-038 opened the in-process `JobExecutor` port to jars "nobody here reviewed", and the whole report was merged over `gpuSeconds`, the listener's own measurement the `GPU_SECOND` rate and the margin read. Now merged through `CONSUMPTION_KEYS`, the vocabulary the metrics map already used; `gpuSeconds` is not in it. (#22, M2: `audioSeconds` will have to join it) |

Nine sites; four were this defect (the executor, both `ContextService`s, the consumption merge); one is the source weakness of the discipline itself, recorded.

### 1.4 No static anchor — a contract, seen failing

The defect is data flow: a value that came from a stored preference reaching a map that holds trusted
keys. No rule over this repository follows a value from `User.preferences()` to a `putAll`; one keyed
on the calls around a merge would read the wrong span, which is why ADR-062's first quantity rule was
deleted. So, contracts:

- `DynamicPipelineExecutorTest.preferencesCannotNameTheEnginesOwnKeys` — a `Context` whose
  preferences name `userId`, `conversationId`, `roles`, and an unnamespaced key.
- `UserPreferencesContractTest` — end to end through `ContextService`, the executor and
  `EntitlementInterceptor`: a user record and a profile carrying `userId` and the metering marker; the
  hold is taken, on the actor, for the conversation.
- `JobListenerTest.aReportedGpuSeconds_cannotReplaceTheListenersOwnMeasurement`.

**Plant — the executor merges raw again:**

```
DynamicPipelineExecutorTest$Process.preferencesCannotNameTheEnginesOwnKeys
the actor ==> expected: <actor> but was: <victim>
```

With **only the `roles` assertion kept**, the same raw merge is green — the order accident, measured.

**Plant — `ContextService` merges the user's preferences raw** (executor still namespaced):

```
UserPreferencesContractTest.aStoredPreferenceCannotRedirectOrRemoveTheHold:99
Wanted but not invoked: creditAuthorizationClient.hold(...)
Actually, there were zero interactions with this mock.
```

**Plant — the whole report merged again:**

```
JobListenerTest.aReportedGpuSeconds_cannotReplaceTheListenersOwnMeasurement:190
a key outside it does not ==> expected: <false> but was: <true>
```

All reverted; green.

### 1.5 A guard input that only the user could ever write

Both guards read a bare `prompt` key "because a Studio step carries the turn there". The job plane has
merged only `orazaka.*` payload keys since 2026-08-06; the guards arrived 2026-09-06. **No production
path ever delivered that key** — its only possible author was a user's stored preference, i.e. the
party the guard judges — and the tests asserting it passed on hand-built metadata. The namespaced merge
makes it unreachable, so it is removed and the tests now assert that a bare `prompt` is not a subject.

## 2. #24 — tests that never ran

### 2.1 Reachable, and what they turned out to assert

`unittest.main()` exits; five tests sat below it. Moved to the end of the file, **all five pass on
first execution** (61 → 66 in the build runner; 68 with the guard below). Passing is not the finding. Each was mutated against
the function it names (`_resolve_owned_asset`):

| Test | Mutation | Result |
|:---|:---|:---|
| `test_traversal_in_an_asset_id_escapes_nothing` | basename guard removed | **still green** — `startswith("../x")` can never match a directory entry; the guard it names is not what makes it pass |
| `test_another_actors_asset_is_not_found` | owner scoping removed — the **whole upload root** listed | **still green** — listing the root finds user directories, not files; the test cannot fail for the reason it names |
| *(none)* | `found.startswith(owner_root + sep)` containment removed | **every test green** — no test guards it |
| `test_an_asset_id_resolves_to_its_owner_file`, `test_compose_payload_…` | owner scoping removed | red — the two meaningful tests are the positive paths |
| **`test_an_absolute_path_is_left_alone`** | ownership enforced on absolute paths | **red — this test pins the hole open.** An absolute path is returned untouched, with no containment |

That last row is the red the run expected, in its worst form: not a test that fails, a test that
asserts the vulnerability. A compose step's `photos` are run inputs — user-typed strings — so an
absolute path to another actor's upload is composed into the caller's reel, decrypted by the worker's
own key. It needs that actor's id, the asset's id and the server's upload root. **Not repaired here:
surfaced as a decision** (§6).

### 2.2 The guard — collected equals defined, per runner and per repository

`TestTheRunnerCollectsEveryDefinedTest`, the **first class** in `test_main.py`:

- **per runner** — the tests the file defines, read from its syntax, equal the tests the loader
  collects from the module as it actually executed. A class after `unittest.main()`, a method name
  used twice, a pytest-style function unittest never collects: each makes the numbers differ.
- **per repository** — every `test_*.py` is named by a Python execution in the root `pom.xml`.

It is first because **its first version was last, and inert by the defect it guards**: planting
`unittest.main()` above `AssetIdResolutionTest` left the guard below it too, and the run said
`Ran 61 tests … OK`. Moved to the top, the same plant:

```
AssertionError: this file defines 68 tests and the runner collected 63
  never collected: ['AssetIdResolutionTest.test_an_absolute_path_is_left_alone', …]
```

A pytest-style function: `defines 69 tests and the runner collected 68 / never collected:
['test_a_function_unittest_never_collects']`. A name used twice: `defined twice:
['AssetIdResolutionTest.test_an_absolute_path_is_left_alone']`.

**The eighth mechanism, found by its first run.** The repository check went red on
`orazaka-packs/document-validation/worker/test_rules.py`: **27 tests in two files no build had ever
run**. `test_rules.py` (17) passes and is now a build execution — removing it again reddens the guard.
`test_authenticity.py` (10) **crashes on its first test**: `UnreadablePdf: la bibliothèque PDF n'est
pas disponible dans ce worker` — `pypdf` is declared nowhere and is absent from this environment. It is
excused by name, with the condition checked: the day `pypdf` is importable, the excuse is stale and the
guard fails until the suite runs.

## 3. #25 — the failure posture, chosen

### 3.1 The decision

**Open, and accounted**, written on `EntitlementInterceptor` itself. A billing outage must not become
a chat outage — the trade `JobMeteringService` had already made and written down for submissions. What
changed is not whether an outage serves turns free (the executor's `catch` already did) but that
somebody chose it, and that it leaves a record:

1. the gate catches the billing failure it has decided to survive;
2. it writes an `UnmeteredTurn` — actor, capability, correlation, the failure's **type** (never its
   message), time — through `UnmeteredTurnRepository` **before** the turn continues;
3. if that record cannot be made durable, the exception propagates and **the turn is refused**.
   Reconcilable free inference is the product; silent free inference is not.

The opposite of ADR-063's crisis guard, and both are chosen: that guard's failure costs a person, this
gate's costs margin.

### 3.2 Where the record goes

The port is implemented by the host that serves the work — at that moment billing is unreachable — as
an append to its own transactional outbox (`OutboxUnmeteredTurnRepositoryAdapter`, conversation and
job services). The relay publishes `evt.turn.unmetered` on `orazaka.events` when the broker takes it;
the billing service's `UnmeteredTurnListener` (idempotent, and giving its claim back if the insert
fails) writes `unmetered_turn`. Nothing debits from it: billing it after the fact or writing it off is
a decision about a customer during an outage the platform caused. `JobMeteringService`'s door-1
fail-open, which "recorded loudly" in a log line, now writes the same record in the submission's
transaction.

### 3.3 Controls declare their posture

The deeper cause was the executor: it swallowed every exception but a refusal, which is right for an
enrichment and made every **control** fail open by accident. `PromptContextInterceptor.failsClosed()`
now declares it; the executor rethrows a declaring interceptor's unhandled failure. `SafetyInterceptor`,
`ScopeGuardInterceptor` and `EntitlementInterceptor` declare `true`.

**Plants.** The gate's outage branch removed: `anUnreachableLedger_servesTheTurnAndRecordsItAsUnmetered
» IllegalState billing-service: connection refused`. The executor ignoring the declaration:
`aControlsFailureStopsTheTurn: Expected java.lang.IllegalStateException to be thrown, but nothing was
thrown.` Reverted.

### 3.4 Every control that can fail this way

| Control | Posture on its dependency failing | Chosen? |
|:---|:---|:---|
| Chat credit hold (`EntitlementInterceptor`) | open, **recorded** (§3.1) | ✓ this ADR |
| Door-1 job hold (`JobMeteringService`) | open, **recorded** in the submission's transaction | ✓ written before; accounted now |
| Entitlement snapshot (`HttpEntitlementProvider`) | open — an unresolved snapshot refuses nobody | ✓ written on the type |
| Settlements (`ChatSettlementListener`, run settle) | the hold stays open; the sweeper releases it — the hold row is the record | ✓ written on `CreditReservationService` |
| **Studio run hold** (`CreditReservationService.hold`) | **closed — the exception propagates and the run does not start** | **✗ emergent**: nothing says so. Recorded for M2.5, which hardens the run path |
| Crisis guard, scope guard | closed on an unreadable image (ADR-063); closed on any unhandled failure (now) | ✓ |
| Orchestration switch · `disable-ai` | refuse (ADR-062) | ✓ |
| `JobSettlementListener` handler exception | **the dedup claim is never given back** — the redelivery is refused and the settlement lost; the sweeper then releases the hold | **✗ emergent**; `MessageDedupService.release` exists and nothing calls it. Recorded |

Two opposite postures agree where both were chosen. Two rows were not.

## 4. #26 — logs are a channel

### 4.1 The answer

Prompts, response bodies and message texts are **never logged**. Eighteen sites changed to log shape
(provider, conversation, message count, sizes, model) instead: `AbstractEngine` ×3 (every prompt and
response at `INFO`), `AiClientImpl` ×4, `WhisperTranscriptionClient` (the transcript),
`DefaultToolRegistry` ×3 (web query, poster and its prompt), `RefinerInterceptor`, `HybridRagResolver`,
`SemanticRouterInterceptor`, `ChatController` ×2, `CodeController`, `MediaGenerationController`.
Nothing redacts; nothing needs to satisfy retention, because nothing content-bearing is written.

### 4.2 [LOG-001] — anchored on the operand stack

`LoggedContentRules` analyses each production method with ASM's `SourceInterpreter` and follows every
argument of an SLF4J call back through locals and copies. It is content when its static type is a
content type (`Prompt`, messages, chat requests and responses, `PromptContext`, `JobCommand`, tool
requests), when it was read through a content accessor (`prompt()`, `refinedPrompt()`, `getText()`,
transport DTOs' prompts), when it was derived from such text, or **when it is the same value the method
hands to a content constructor** — a `@RequestParam String` that becomes a `ChatRequest`. No name is
read. Wired in core's `GovernanceTest` and the eight service suites, over each runtime classpath;
GOV-006 fails it if it finds no logging call to judge.

Its **first run** found the seven core sites; the service suites found the rest, including four a
text search had missed — `ChatController`'s POST stream, `CodeController`, `HybridRagResolver`,
`SemanticRouterInterceptor` — because their prompt was an argument on the line below the call. Its first version also flagged `actorOf(context)`, `resolveTenantId(context)` and
a language code — metadata a helper read out of a content-bearing object. A rule that flags actor ids
is the rule people learn to ignore, so following a value through a call is now limited to **text**
content; a whole content object counts only when it is itself logged.

**Plants.** The engine's prompt log restored — `AbstractEngine.chat:133 info — argument 2 carries
content`; a controller logging its raw prompt parameter under another name —
`ChatController.streamChat:91 debug — argument 3 carries content`. Reverted.

**What it cannot see**, stated: text never typed as content in the method that logs it — a raw HTTP
body logged before it is parsed (the Whisper transcript, fixed by hand); a helper that receives a
`String` and logs it. And it is conservative in one direction: anything a method computes from text is
text, which is why the semantic router no longer logs its intent label.

### 4.3 Everything else that leaves the process

| Channel | Carries content? |
|:---|:---|
| Metric labels | **No** — the only tagged meters take enums and booleans (`cause`, `consumedCompute`, `terminal`) |
| Exception messages built in this repository | **No** — none concatenates a prompt, a response or an input value |
| HTTP error bodies | **No** from our own messages; they echo in-repo exception text |
| **The job plane's own copy of a governed step** | **Yes.** A SENSITIVE or REGULATED step runs as a job: its payload (the template with the user's words, the declared guard subject), its output (the model's answer) and, for a refused turn, the pack's crisis response — which says the person matched a crisis term — are kept in `orazaka_jobs` and in the job's encrypted `input.json`/`result.json`. The run's retention window deletes `studio_run`; **nothing deletes the job's copy**. Encrypted at rest (ADR-054), retained forever. **Live, 🔴 — surfaced as a decision (§6)** |

## 5. Last runs' controls

`[CFG-001]`, the GOV-006 meta-rule, `ImageGeneratorClientImplTest` and
`TestCompositionDivergenceContract` are unchanged and green in the full build (§7).

## 6. Decisions surfaced, not scheduled

Live and 🔴 or at the edge of it — for the owner to decide, not for an M1.8:

1. **The job plane outlives the data class** (§4.3). Options: the run's retention sweep also purges the
   jobs its steps produced (a cross-context call from studio to job service); or job-service carries the
   run's `data_class` and sweeps its own rows and files; or SENSITIVE steps stop persisting job payloads
   and outputs at all.
2. **Compose resolves absolute paths without ownership** (§2.1). Options: refuse absolute paths from
   payloads (the platform's own upstream-resolved paths would need another channel); or enforce the
   owner prefix on them too. Either flips `test_an_absolute_path_is_left_alone`, which is the point.

## 7. Found, recorded for M2's report

- Two worker security tests pass vacuously and the containment check is untested (§2.1).
- `document-validation`'s authenticity check depends on `pypdf`, declared nowhere: in any environment
  without it, the pack's authenticity analysis raises `UnreadablePdf` (§2.2).
- `JobSettlementListener` and the other consumers never give a dedup claim back (§3.4).
- The studio run hold fails closed without anyone having chosen it (§3.4).
- Door 1 lets an end user write `orazaka.*` payload keys (§1.3).
- Guards log the matched term — the pack's word, and evidence of what the user wrote.
- `MediaGenerationController` nests request records that duplicate the `dto` package's.
- `UserContextInterceptor` reads onboarding answers only from raw preferences, never from the typed
  profile; kept as it was, under the new namespace.
- `HybridRagResolver` reads a `tenantId` only a user preference could supply; the namespace makes it
  unreachable, and the resolver is a stub no seed enables.

## 8. Migrations

`infra/migrations/2026-09-15-unmetered-turn.sql` — applied to the local database (the table exists,
owned by `orazaka_billing`).
