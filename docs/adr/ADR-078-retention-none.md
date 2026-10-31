---
title: "ADR-078 — Retention none: a turn that is processed and forgotten, a plan that says so"
description: "Does Orazaka store a turn's inputs? Yes, by default: conversation memory writes the prompt and the completion to Postgres. A plan entitlement, retention.none, puts a turn in no-storage mode — memory neither read nor written, no content in logs — and a former product's plan has it."
category: ADR
order: 78
---

# ADR-078 — Retention none

- **Status**: Accepted
- **Date**: 2026-10-22
- **Scope**: `Context.RETENTION_KEY`/`retentionNone()`, `MemoryInterceptor`, `EngineStreamBridge`
  (orazaka-ai-engine); `ContextService`, `VoiceTurnService` (conversation service); a retired plan
  (`70-billing.sql`, a retired export)
- **Consumer**: a former product (a former product's issue): its landing promises that nothing said in a moment is kept
- **Amends**: [ADR-076](ADR-076-the-voice-turn.md) §2 (a typed turn needs no audio capability)

## 1. The question, and the answer from the code

*Does Orazaka keep what a turn says?* Audited on 2026-10-22 against the voice turn
(`POST /api/v1/voice/turns`, text or audio) and the chat path.

| Sink | Holds content? | Evidence |
|:---|:---|:---|
| **Conversation memory** `orazaka_chat_messages.content` | **Yes, by default**: the prompt and the whole completion, per `conversation_id`, forever | `MemoryInterceptor.postProcess` (`MemoryInterceptor.java:55-61`) → `ChatMemoryPersistenceProviderImpl.saveAll` (`:35`) → table at `20-conversation.sql:23`. The interceptor is enabled in the default pipeline (`30-jobs-config.sql:624`) and `EngineStreamBridge` calls `postProcess` on stream completion (`:131`). Measured on dev: 1 186 rows |
| Studio run records `studio_run.inputs/outputs`, `studio_run_event.detail`, `studio_run_step.output` | Yes, for a **Studio run** (`80-studio.sql:280`, `:620`); a voice turn is not a run and writes none | REGULATED packs purge at terminal state (ADR-065) |
| Job plane `orazaka_jobs.payload/result`, `outbox_events.payload` | Yes, for a **job** (`30-jobs-config.sql:16-17`, `:46`); a voice turn publishes nothing on `orazaka.jobs` (ADR-076 §1) | purged at terminal state for protected classes (ADR-065 §1) |
| Billing: `usage_event`, `credit_hold`, `credit_ledger_entry`, `unmetered_turn` | **No content**: ids, capability, model, quantities, credits (`70-billing.sql:226`) | the hold carries the conversation id only (`VoiceTurnService.hold`) |
| Voice clips | In memory, signed, five minutes, gone on restart (`VoiceClipStore.java:47`, ADR-076 §2) | not on disk |
| Logs | INFO by default (`orazaka-dev.app.yaml:124`); the guards log the rule, never the match (ADR-065). **One DEBUG statement logged the whole prompt** (`EngineStreamBridge`, `OLLAMA_DEBUG`) | removed here; a test keeps the bridge's logs content-free |
| Request logging, Spring AI prompt/completion observation | Not enabled anywhere (no `log-prompt`, no payload logging filter) | grep over the workspace |
| Backups | DigitalOcean managed PostgreSQL backs up the cluster (7 days): whatever a table held is in them | so the only guarantee is never writing |

So the claim « nothing is kept » was **not** true of a turn taken with a `conversationId`.

## 2. The decision: `retention: none`, from the plan

- **The mode is data.** The plan entitlement `retention.none = true` (a row in
  `billing_plan_entitlement`, ADR-031: a plan is a row, never a deploy).
- **The host declares it, the engine obeys.** `ContextService` reads the actor's plan and puts
  `orazaka.retention = none` in the platform namespace of the turn's `Context`
  (`Context.retentionNone()`). A user preference lives under `preference.*` and can never set it
  (ADR-064). An unresolved plan (billing unreachable) keeps the default: it says nothing about the actor.
- **In the mode**: `MemoryInterceptor` neither reads the stored history nor writes the prompt and the
  completion; the engine keeps what billing needs (counters, capability, model, credits) and nothing
  else. A caller that wants context sends it with each turn (`context`, ≤ 2 000 tokens), as a former product does.
- **Logs.** No log statement of the bridge mentions a prompt or a completion, in any mode
  (`EngineStreamBridgeTest.shouldNeverLogWhatThePersonSaidEvenAtDebug`). Exceptions of a model client
  can still quote a fragment; the voice turn logs the class only.
- **Not covered**: rows written *before* the plan had the flag stay in the cluster and its backups
  until deleted; a Studio run is a different mechanism (retention by class, ADR-065).

## 3. The former product's plan

a retired export (not public, tier 10): `capability.chat`, `studio.guided-journaling`, **`retention.none`**,
`capability.audio = false`. The former product's service account is subscribed to it.

## 4. A typed turn needs no audio capability (amends ADR-076 §2)

A typed turn on a plan without `capability.audio` used to answer **403** « does not include speech »:
the engine spoke every answer. It is now answered as text — `sentence` events without `audio`, no voice
needed (no 422), nothing synthesised or billed for speech. A **recording** still needs the capability
(transcription), and the crisis and scope replies stay the pack's fixed text, shown without a voice.
Whether an environment speaks is therefore the plan's row: turn `capability.audio` on when a voice engine
serves it.

## 5. The pack speaks as the neighbour

`orazaka-packs/wellbeing` 1.6.0: the pack's system prompt (ADR-076 §3) is « le voisin » — an AI
neighbour, light other angles, « Je ne sais pas, mais tu trouveras » and a factual anecdote or a joke, no
advice, no medical or therapeutic vocabulary, a warm close after the turn limit. The crisis terms, the
fixed reply and the lines are unchanged and still answer before the model.


## 6. What the live check found (2026-10-22, dev)

- A pack whose only change is its **system prompt** was never re-applied by `PackBootstrap` (the same
  blind spot as the consent statement, orazaka#301): `isApplied` now compares the pack row's `safety` too
  (orazaka-studio#52).
- A refusal before the stream (451 consent, 402 credits, 503 engine off) is JSON; for a caller that
  accepts `text/event-stream` (the voice turn) it had no content type of its own and failed with a 500
  (orazaka-conversation-service#49).
- A consent bump (`bien-etre` 2.1) makes the **installation** of a service account answer 451 until it
  is re-posted with the new `consentVersion`; a former product's service account was re-consented to 2.1.
- Proof of the mode, on a former product's moment taken live: `orazaka_chat_messages`, `orazaka_jobs`,
  `outbox_events` unchanged; billing wrote its hold and `usage_event` (ids, capability, quantities).
