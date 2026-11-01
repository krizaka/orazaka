---
title: "ADR-076 — The voice turn: heard, answered through the pipeline, spoken sentence by sentence"
description: "Orazaka holds a conversation by voice. POST /api/v1/voice/turns takes audio or text and answers over SSE — transcript, deltas, each sentence with its audio, a guard's fixed reply, done. The turn is a chat turn with an ear and a mouth: it lives in the conversation service, reaches the model through the interceptor pipeline, and calls Whisper and Piper synchronously on LocalAI — no job, no broker. Under an installation the pack is the law of the turn. One hold, one settlement. First spoken sentence: median 1.55 s on an M1 Max with a 7B model. Also: the wellbeing pack's Québec lines and session-summary, a JSON output held to its contract."
category: ADR
order: 76
---

# ADR-076 — The voice turn

- **Status**: Accepted
- **Date**: 2026-10-12
- **Scope**: `VoiceController`, `VoiceTurnService`, `SentenceBuffer`, `VoiceClip`, `VoiceClipStore`,
  `VoiceTurnUsageRegistry` (conversation service); `TurnDeclarations`, `TurnDeclarationClient`,
  `TurnDeclarationService`, `InstallationDeclarationController`, `PackSafety.systemPrompt`,
  `BlueprintOutput.schema`, `OutputContract` (studio); `SpeechVoiceManager`, `SpeechVoice`
  (contracts, persistence-app); `AudioRequest.RESPONSE_FORMAT`, `LocalProcessorUtil` (core);
  `orazaka_models.locale/locale_default`; `orazaka-packs/wellbeing`; the e2e `VoiceTurnIT`
- **Consumer**: a former product (a retired export §3.4) — and any Orazaka client: the capability is generic
- **Bound by**: [ADR-055](ADR-055-regulated-controls-and-the-wellbeing-pack.md) (REGULATED, the
  wellbeing pack), [ADR-068](ADR-068-one-door.md) / [ADR-070](ADR-070-the-run-surface-is-sealed.md)
  (one door), [ADR-044](ADR-044-deferred-metering.md) / [ADR-045](ADR-045-metering-marker-guard.md) (metering), [ADR-035](ADR-035-service-to-service-authentication.md) (service tokens)

## 1. The seam: a chat turn with an ear and a mouth

A voice turn is three inferences in a row — transcription, the answer, speech — and a person is
waiting on all three. Three places could have held it:

| | Where | Cost | Verdict |
|:---|:---|:---|:---|
| **taken** | **the conversation service**, beside chat streaming; Whisper and Piper called **synchronously** on LocalAI, the answer through `AiClient.stream` | none new: chat already lives here, synchronous and off the broker (AGENTS.md §6) | the one that keeps every control |
| not taken | a Studio run (transcribe → chat → speak as steps) | the outbox relay's poll (≤ 500 ms) **per step**, the job plane's round trip, and no token stream back to the caller — a run returns outputs, not deltas | a voice that answers in four seconds is not a conversation |
| not taken | the media worker, with a synchronous HTTP call or a dedicated queue | the worker serves video and composition only; STT and TTS are LocalAI's; "no one calls a worker directly" (AGENTS.md §6) | a new door for a capability that already has one |

**One door holds** (ADR-068, ADR-070). The answer is `AiClient.stream`, so it crosses the
interceptor pipeline exactly as a typed chat turn does: the orchestration switch, `disable-ai`, the
crisis guard, the scope guard and the entitlement gate run on it. `orazaka.core.chat.completion` is
synchronous by contract and never a [DOOR-001] subject; the voice turn reaches no dispatcher and
publishes nothing on `orazaka.jobs`. Transcription and synthesis are inference calls on the native
runtime that serves them — the same shape as the chat model on Ollama — not jobs. The media worker
is **not changed**: it does not serve speech, and giving it a synchronous path would have been the
second door.

`OperationGraphFilter` gates `/api/v1/voice/turns` on `orazaka.core.chat.completion`, like
`/api/v1/chat`: no engine, no turn.

## 2. The contract

`POST /api/v1/voice/turns` — `multipart/form-data`:

| Part | |
|:---|:---|
| `audio` *or* `text` | exactly one. Audio: WAV, Ogg/Opus, WebM or MP3, ~30 s at most (3 MiB) |
| `conversationId`, `locale` | required; `locale` a BCP 47 tag (`fr-CA`, `fr-FR`, `en`) |
| `voice` | a catalogued voice; absent → the locale's default (§5) |
| `installationId` | the installation whose pack governs the turn (§3) |
| `context` | the caller's context — at most 2 000 tokens, counted as 8 000 characters |

Answered over **SSE** (never WebSocket — the organisation's doctrine; a turn is one request with many
answers):

| Event | Data |
|:---|:---|
| `transcript` | `{ text, seconds }` — audio turns only |
| `delta` | `{ text }` — the answer as the model writes it, for captions that keep up |
| `sentence` | `{ index, text, audio: { url, durationMs, contentType, voice, locale } }` |
| `safety.crisis` | `{ response, resource: { region, label, contact, availability, sourceUrl, verifiedOn }, text, audio }` |
| `scope.refused` | `{ refusal, audio }` |
| `done` | `{ usage: { sttSeconds, chatTokens, ttsSeconds, ttsCharacters }, timings: { sttMs, firstDeltaMs, firstSentenceMs, totalMs } }` |
| `error` | `{ code, message }` — after the stream opened; never what the person said |

Everything that can refuse a turn is decided **before** the stream opens, so a refusal is a status
and never half a stream: `404` unknown installation, `451` consent to an older statement (the
pack's version and statement, verbatim), `403` a recording without `capability.audio` in the plan (a typed turn without it is answered as text, [ADR-078](ADR-078-retention-none.md) §4), `422` no voice for
the locale, `402` no credits, `400` a malformed turn.

**`audio.url`** is `GET /api/v1/voice/clips/{id}?expires=…&signature=…`: valid **300 s**, signed
with HMAC-SHA256 under a key drawn at start-up and never written. No bearer token, because an
`<audio>` element cannot send one. Clips live **in memory** and are gone after five minutes or a
restart: a sentence of a REGULATED conversation is health data, and a file in the uploads directory
would give it a life nothing purges by data class.

**No `words`.** Piper, as LocalAI serves it, returns no word timings. An alignment computed here —
characters spread over the duration — would be a lip-sync track that lies, so the field is absent
and documented absent. A client drives its captions from `text` and its mouth from the signal
(a former product's `LipSyncTrack { source: ENERGY }`).

## 3. Under an installation, the pack is the law of the turn

A Studio step carries its pack's declarations because the dispatcher stamps them
(`StepDeclarationService`). A conversational turn has no step, so the conversation service asks the
studio service for them, per turn, never cached:
`GET /internal/v1/installations/{id}/turn-declarations?actorId=` (SERVICE authority only, ADR-035;
owner-scoped by the same row predicate as the public installation endpoints) returns
`TurnDeclarations`: the scope guard, the crisis terms, the reviewed reply and the **verified line of
the installation's region**, and the pack's **system prompt**.

- **Consent is re-checked at the turn.** An installation whose recorded consent version is not the
  pack's current one gets `451` and no turn: a turn is the moment the processing happens, which is
  when the lawful basis must hold (ADR-055 §3). The run path does not re-check this today — noted,
  not changed here.
- **The prompt is first.** `PackSafety.systemPrompt` (new, in the pack's JSONB `safety`, no schema
  change) is the first system message; the caller's `context` is the second; never the reverse. The
  wellbeing pack's says what the assistant is — *« Je suis une IA. Je ne suis ni thérapeute ni un
  service d'urgence. »* — one question at a time, no diagnosis, no medication, no number given.
- **The guards judge what was said.** `orazaka.guard.subject` is set to the transcript (or the
  text): the pack's prompt says *« aucun diagnostic »* and would otherwise make the pack refuse
  itself (ADR-055 §7), and the caller's context is not the person's words.
- **A guard's reply is the pack's text, spoken.** The crisis guard's `PipelineShortCircuitException`
  carries the reviewed text with the region's line appended; the turn emits `safety.crisis` with the
  text and the structured resource, synthesises **that text**, generates nothing. The scope guard's
  refusal is spoken the same way. The `SafetyInterceptor` is unchanged and still non-bypassable:
  it is in the pipeline the turn crosses, `isAiDependent() == false`, `failsClosed() == true`.
- **Fail closed.** The studio client is wired by default in the conversation service
  (`STUDIO_CLIENT_ENABLED`, default `true`); its no-op refuses a turn under an installation rather
  than answering "no declarations", and an unreachable studio service refuses the turn.

A turn **without** an installation is a STANDARD turn: no pack, no guard declarations — exactly a
typed chat turn spoken aloud.

## 4. Sentences, and the latency a person hears

`SentenceBuffer` cuts the token stream on strong punctuation (`. ! ? …`, a line break) followed by a
space — never on a decimal (`9.5`), an abbreviation (`M.`, `etc.`) or a fragment under twelve
characters, and through French closing guillemets. One exception, measured: **the first piece only
may end at a breath** (`, ; :`) once it is 48 characters long — the wait a person hears is the time
to the first audio, and a long first sentence was most of it.

A `Speaker` thread synthesises sentence *n* while the model writes sentence *n+1*, one at a time
(Piper serves one synthesis at a time; two in flight would queue in the engine). Speech is asked as
**WAV** (`AudioRequest.RESPONSE_FORMAT`): the duration is then read from the header — a measurement,
not a guess — and PCM is what an energy lip-sync reads. LocalAI's MP3 path costs the same.

### Measured — M1 Max, 64 GB, `qwen2.5:7b` (Q4_K_M) on Ollama, `whisper-base`, `piper-fr-siwis-medium` on LocalAI 4.3.1

Twelve warm audio turns, a 6.5 s French utterance (the e2e fixture), through the edge:

| | min | median | p90 | max |
|:---|---:|---:|---:|---:|
| transcription (`sttMs`) | 252 | 258 | 261 | 267 |
| first token (`firstDeltaMs`) | 319 | 326 | 331 | 336 |
| **first spoken sentence (`firstSentenceMs`)** | **623** | **1 555** | **1 664** | **2 087** |
| whole turn (`totalMs`) | 1 817 | 2 366 | 2 617 | 3 048 |

Before the first-breath cut, ten turns gave median 1 686 ms and **max 2 502 ms** — on the budget.
Text turns skip transcription (~0.3 s less). A **cold** turn (model not loaded) took 5.4 s to the
first sentence; Ollama keeps a model five minutes. The target of a retired export §3.7 —
*< 2.5 s on the Mac* — holds warm.

## 5. Voices: a locale is declared, never read off a name

`orazaka_models` gains `locale` and `locale_default` (one default per category and locale, a unique
partial index). `SpeechVoiceManager` (Tier-1, persistence-app-api) returns a named voice with its
locale, or a locale's default — else the default of **another locale of the same language**, saying
which: a `fr-CA` turn is spoken by the `fr-FR` default and every `sentence.audio.locale` says
`fr-FR`. There is no Piper voice for Québec French; a Québécois voice is a licensed actor's, later.

Two fr-FR voices are added, because the catalogue had one (`piper-fr-medium`, UPMC "jessica" — the
LocalAI Piper backend ignores the speaker id, so its male speaker "pierre" is unreachable):

| Voice | | Licence | Default |
|:---|:---|:---|:---|
| `piper-fr-siwis-medium` | female, 22.05 kHz | CC-BY 4.0 (SIWIS) | **fr-FR** |
| `piper-fr-tom-medium` | male, 44.1 kHz | **AGPL-3.0** (weights) — used unmodified, never redistributed by Orazaka; a lawyer should confirm before a commercial deployment. CC0 alternative: `fr_FR-gilles-low` (16 kHz, noticeably lower quality) | — |

Both are priced as every Piper voice (AUDIO, KILOCHAR, pricebook v2 only — they arrived after v1 was
retired). `qwen2.5:7b` is catalogued as a chat model, never a default.

**The transcription model that runs is the one the catalogue names.** `LocalProcessorUtil` rewrote
every `whisper*` name to `whisper-1`, which LocalAI served with `ggml-tiny` — so the catalogue's
default, `whisper-base`, was priced and reported while a tiny model ran and heard *« présence d'ir »*
for *« présence IA »*. The rewrite is gone; `infra/localai/` holds a file per catalogued name.

## 6. One metering entry per turn

`prepare` takes **one hold** (CHAT, pricebook estimate) before anything is spent; the chat leg
carries `orazaka.metering.deferred`, so `EntitlementInterceptor` still checks the plan and takes no
second hold (ADR-044). At the end, **one** `settleAggregate` prices each leg against its own row:
`AUDIO/whisper-base` on the transcribed seconds (AUDIO_MINUTE), `CHAT` on the tokens the stream
reported (`ChatCompletedEvent`, matched by the turn id the turn declares on its context —
`orazaka.pipeline.voiceTurn`), `AUDIO/<voice>` on the characters synthesised (KILOCHAR). An
unmeasured leg is absent, never zero. One hold, one settlement, one ledger entry, one
`usage_event` per leg.

**A guard's answer is not billed**: the hold is released. A refusal is free (ADR-051 §3), and nobody
is charged for being given a crisis line. A failure after the stream opened releases too. Silence
(an empty transcript) settles the transcription and generates nothing.

## 7. The wellbeing pack, for a former product

- **CA-QC**, read at the source on 2026-10-11: *1 866 APPELLE (277-3553), texto 535353* — « en tout
  temps, de partout au Québec » ([quebec.ca](https://www.quebec.ca/sante/conseils-et-prevention/sante-mentale/obtenir-aide-en-sante-mentale/ressources-aide-et-soutien-en-sante-mentale),
  updated 2026-07-06); *9-8-8* — from Québec a call or text "will be redirected to Quebec services"
  ([suicide.ca](https://suicide.ca/en/lets-talk-about-suicide/news-and-suicide/canada-implements-988-as-new-federal-suicide-prevention-phone-line));
  *Info-Social 811* — « 24 heures par jour, 365 jours par année », free and confidential
  ([quebec.ca](https://www.quebec.ca/sante/trouver-une-ressource/info-social-811)). One resource per
  region holds one `sourceUrl`: the record names the quebec.ca page that lists the first and the
  last; the manifest's comment carries all three sources.
- **`session-summary`**: input — the thread, the turns, the self-declared mood before/after, the
  locale; output — `{ themes[≤3], whatHelped, smallStep, bringToTherapist[], locale }`. Described,
  never explained; no clinical interpretation, no inference of mood (the scores are the person's and
  the Studio does not comment on them). Its turns pass the pack's guards like every step's.

### A JSON output is held to its contract

A blueprint output of type `JSON` may now declare a `schema`. The saga checks it before calling the
run a success; a model that answered prose, or an object the contract refuses, fails the run as
`EXECUTOR_FAULT` and **releases** the hold — nobody pays for a summary they cannot use. The checker
(`OutputContract`) is a deliberately small subset of JSON Schema — `type`, `required`,
`properties`, `additionalProperties`, `items`, `min/maxItems`, `min/maxLength`, `minimum/maximum`,
`enum` — and a schema naming any other keyword is **refused at load**: a `pattern` nobody checks is
a promise nobody keeps. Violations name paths and rules, never values. A Markdown fence around the
whole answer is packaging and is removed; text around the object is not, and fails.

## 8. Proof

- **e2e** (`VoiceTurnIT`, `@Tag("voice")`, `-De2e.voice`): a text turn (deltas, sentences, a signed
  clip that plays without a token and 404s with a forged signature, measured WAV); an audio turn
  (fixture, transcript, minutes measured, **first sentence < 2.5 s**); a crisis turn (no delta, no
  generated sentence, the reviewed text, CA-QC's line with its source and date, spoken); a
  `session-summary` run (SUCCEEDED, JSON within its contract). 4/4 green against the running stack.
- **Unit**: `SentenceBufferTest`, `VoiceClipTest`, `VoiceTurnTest`, `VoiceClipStoreTest`,
  `VoiceTurnUsageRegistryTest`, `VoiceTurnServiceTest` (event order; the pack's prompt first and the
  context second; the guard subject; the deferred marker; one `settleAggregate` with minutes and
  characters; crisis and scope spoken and released; refusals before the stream), `OutputContractTest`,
  `TurnDeclarationServiceIT` (real `80-studio.sql`: owner scope, revoked, stale consent → 451),
  `SpeechVoiceManagerImplTest`, `HttpTurnDeclarationClientTest`.
- Every `*GovernanceTest` green in each repository changed.

## 9. What is missing

- **Duplex.** One turn at a time, push-to-talk: no listening while speaking, no barge-in (the person
  interrupting the voice). The stream would need cancelling the model and the speaker mid-turn.
- **VAD.** The client decides when an utterance ends; nothing here detects speech or silence.
- **Phoneme alignment.** No word or phoneme timings (§2). Piper can emit phoneme durations when run
  directly; LocalAI does not expose them. A server-side aligner (or Piper outside LocalAI) is the
  V2 of a former product's `LipSyncTrack { source: PHONEME }`.
- **Streaming synthesis.** Each sentence is synthesised whole; audio could start mid-sentence.
- **A Québec voice.** `fr-CA` is spoken in `fr-FR` and says so.
- **Cancellation on disconnect.** A caller that goes away does not stop the turn; it finishes and
  settles what it spent.

## 10. Found, not fixed

- **The active chat model is Ollama's first-listed model** unless `ORAZAKA_OLLAMA_MODEL` is set
  (`OllamaModelCatalogProvider`), not the catalogue's default — pulling any model the catalogue does
  not list breaks chat with *"No endpoint resolved for model"*. `qwen2.5:7b` is catalogued so pulling
  it is safe; the catalogue's `is_default` should be what is read.
- **`orazaka start` launched LocalAI without its backends** (`--backends-path` defaults to
  `./backends` of the start directory in LocalAI 4.x): every speech and transcription call failed.
  Fixed in `orazaka-cli`.
- **The e2e harness pointed at `localhost:5432`** while the compose file publishes
  `POSTGRES_PORT`: on a host whose 5432 is another product's Postgres, the gate's conversation
  service and its JDBC clients read the wrong database. The harness now follows `POSTGRES_PORT`.
- **The e2e harness starts with `docker compose down -v`** on the same volume as `orazaka start`:
  running the gate on a working machine destroys its local data (demo accounts included). The voice
  scenarios were therefore run against the live stack, after a backup.
- **The run path does not re-check consent** after a pack's consent version changes (§3).
