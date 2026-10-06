---
title: "ADR-051 — SENSITIVE is five controls the engine owes a pack that declares it"
description: "A pack raises regulatoryClass and receives a data class, a shorter retention, an append-only audit log and a scope guard — none of which name that pack in engine code. Plus a fifth control: a protected pack does not install onto a deployment that stores its documents in the clear."
category: ADR
order: 51
---

# ADR-051 — SENSITIVE is five controls, not a label

- **Status**: Accepted
- **Date**: 2026-09-06
- **Scope**: `products/orazaka` — `PackBundle`, `PackScopeGuard`, `DataClass`, `StepDispatch`,
  `ScopeGuardInterceptor`, `PipelineRegistry`, `RunAuditService`, `StudioRunService`,
  `RunSagaService`, `StudioAnalyticsService`, `RetentionSweeper`, `JobListener`,
  `infra/initdb/{60-governance,80-studio}.sql`
- **Applies**: [AGENTS.md §12](../../AGENTS.md) — *Declared, not inferred* — for the fourth time
- **Closes**: encryption at rest, option C — already in force via FileVault (§7); the fifth
  control that stops B being forgotten (§8)
- **Does not close**: encryption at rest, option B — the application-level envelope (§9)

## 1. What a pack declares, and what it gets

`regulatoryClass: SENSITIVE` in `pack.yaml` is now a request the engine answers with five controls.
The pack declares **one** further thing — the domain it refuses — and implements none of them. The
fifth is not the pack's at all: it is a claim the platform makes about itself, and it defaults to
the claim that refuses the pack (§8).

| # | Control | Where it lives | What the pack declares |
|:--|:---|:---|:---|
| 1 | Data class | `studio_run.data_class`, stamped at INSERT; excluded from analytics and from training corpora | nothing |
| 2 | Shortened retention | `RetentionSweeper`, 30 days against the platform's 180 | nothing; an installation may set `retentionDays` **downward** only |
| 3 | Append-only audit | `studio_run_audit` + `trg_studio_run_audit_immutable` | nothing |
| 4 | Scope guard | `ScopeGuardInterceptor`, Phase 1 | `scopeGuard.refusedTerms` + `scopeGuard.refusal` |
| 5 | Encrypted asset store | `PackInstallerService.validate` (§8) | nothing — this one is the **platform's** to declare, and it defaults to refusing |

The seven controls of `REGULATED` — versioned consent, a safety interceptor, and the rest — are not
in this ADR and are not implemented. `SENSITIVE` is the floor above `STANDARD`, not a partial
`REGULATED`.

## 2. The publish gate is code

A pack that declares a regulatory class above `STANDARD` and no `scopeGuard` **does not install**:

```java
if (regulatoryClass != RegulatoryClass.STANDARD && scopeGuard == null) {
  throw new IllegalArgumentException("pack " + key + " declares regulatoryClass "
      + regulatoryClass + " and no scopeGuard; …");
}
```

This is a constructor invariant on `PackBundle` (ERR-106), so it fires wherever a bundle is built —
the CLI's `pack install`, the catalogue loader, a test fixture. There is no checklist, no reviewer,
and no way to publish a `SENSITIVE` pack whose fourth control is absent.

The gate proved itself before the proof pack ran: the first install of `lease-drafting` was refused
because the CLI had not been rebuilt and was dropping `scopeGuard` from the payload it sent. The
pack declared the key; the gate saw it missing and stopped. That is the failure mode it is for.

## 3. Why the scope guard is a core interceptor, not a row

`ScopeGuardInterceptor` is a `CORE_INTERCEPTOR_KEY` in `PipelineRegistry` and runs **first** in
Phase 1. It is deliberately absent from `pipeline_interceptor_config`.

- **Non-bypassable.** `resolveCoreChain` never consults `enabled`; the dynamic chain does. A
  control of the regulatory class is not an administrator's preference, and a row in that table
  would publish an off switch that the executor ignores. An off switch that does not switch off is
  worse than no switch.
- **First, or it is not free.** After `RefinerInterceptor` and `RouterInterceptor` the turn the
  guard refuses has already been paid for; after `MemoryInterceptor` the question has been written
  into a history the pack said it would not hold. Measured on the proof run: the refused run's hold
  was `RELEASED` with `settled_credits` null — **zero credits** — while the in-scope run debited 3.

An earlier draft of this change put the interceptor in `interceptor_policy`, which is a different
table that drives nothing. It was enabled, at order 0, and the guard never ran once. The row is
removed and `60-governance.sql` now carries the reason it is absent.

## 4. A refusal is an answer, not a stack trace

The pack writes the sentence a refused user reads. Two places were discarding it:

- `JobListener.handleExecutionFailure` recorded `cause.getMessage()`, which for a wrapped
  `PipelineShortCircuitException` is `com.orazaka.…PipelineShortCircuitException: <the sentence>`.
  It now walks the cause chain, recognises a refusal as a distinct outcome, and stores the message
  verbatim.
- `RunSagaService` replaced whatever the step recorded with `step '<id>' failed`. It now reads the
  step's own `error_message` and falls back to the generic wording only when there is none — which
  recovers every other cause the executor had already taken the trouble to record, not just this
  one.

The user now reads *«Je rédige et relis des documents. Je ne donne pas de conseil juridique — pour
cela, adressez-vous à un professionnel du droit.»* instead of *«step 'draft' failed»*.

## 5. Matching folds accents, because the failure mode is asymmetric

`refusedTerms` matches on word boundaries — a pack refusing `avocat` must not refuse a question
about an `avocatier` — and folds case **and combining marks**. A guard that misses
`resiliation judiciaire` because the user dropped an accent fails **open**: it answers the very
question the pack declared it would refuse. Folding cannot widen a term past its word boundaries,
so the innocent turn pays nothing for it. This is the same asymmetry argument as
[ADR-050 §1](ADR-050-declared-not-inferred.md): between failing open and failing closed against an
absent declaration, the guard fails closed.

## 6. The criterion, and how it was met

> A pack declaring `regulatory_class: SENSITIVE` receives the four run-time controls with **no
> engine code naming that pack**.

Proved with a throwaway pack outside the repository, as phase G was proved.

```bash
# /Users/oussamaabid/orazaka-external-packs/lease-drafting — outside products/orazaka
orazaka pack install ~/orazaka-external-packs/lease-drafting
#   → Installed lease-drafting v1.0.0 — 1 Studio(s)
```

Its whole declaration of the fourth control:

```yaml
regulatoryClass: SENSITIVE
scopeGuard:
  refusedTerms: [conseil juridique, avocat, plaidoirie]
  refusal: >-
    Je rédige et relis des documents. Je ne donne pas de conseil juridique —
    pour cela, adressez-vous à un professionnel du droit.
```

Observed, on two live runs of that pack:

| Control | Evidence |
|:---|:---|
| 1 | `studio_run.data_class = SENSITIVE` on both runs |
| 1 | analytics counts **0** of them — `SELECT count(*) … WHERE data_class = 'STANDARD'` → 0, against 1 row present |
| 3 | `RUN_STARTED` + `RUN_SUCCEEDED` / terminal row per run; `UPDATE` → *"studio_run_audit is append-only (ADR-051) — UPDATE rejected"*, `DELETE` likewise |
| 4 | out-of-scope turn → `FAILED`, message = the pack's own sentence; in-scope turn → `SUCCEEDED` |
| 4 | refused run's hold `RELEASED`, 0 credits; in-scope run debited 3 |
| 2 | covered by test, not by a 30-day wait: a `SENSITIVE` run aged 45 days is purged while a `STANDARD` one of the same age survives; `retentionDays: 3650` buys nothing, `retentionDays: 7` takes effect |

And the negative half of the criterion:

```bash
grep -rniE '"lease-drafting"|"lease-letter"|conseil juridique|plaidoirie' \
  --include=*.java --include=*.py --include=*.sql orazaka-libs orazaka-apps infra
# (no matches)
```

The engine names neither the pack, its Studio, nor its domain.

## 7. Encryption at rest: what C closes, and what it does not

**Correction to this ADR's first draft.** It said identifying documents *"sit unencrypted under
`var/orazaka-uploads`"*. At the application level that is true and stays true. At rest on the
physical disk it was already false when it was written:

```
$ fdesetup status
FileVault is On.
$ diskutil apfs list | grep -A2 'disk3s5 (Data)'
    Name:        Data
    FileVault:   Yes (Unlocked)
```

`var/orazaka-uploads` lives on `/System/Volumes/Data` — `disk3s5` — which FileVault encrypts with
AES-XTS. **Option C was already in force before it was chosen.**

**A separate encrypted APFS volume was therefore not created, and should not be.** It would use the
same primitive on the same container, unlocked at the same moment, and buy one operational failure
mode we do not have today: a service that starts before the volume mounts writes to an empty
mountpoint on the boot volume — silently, elsewhere, and no longer encrypted by the volume that was
supposed to protect it. The only version of C that beats FileVault is a volume with a *distinct*
passphrase not unlocked at login, and the services run continuously, so it would be mounted
continuously. That is FileVault with extra steps and a new way to lose data.

### What C closes

One threat, completely: **a stolen or lost machine, powered off.** The disk is ciphertext to anyone
without the account password or recovery key.

### What C does not close — which is everything else

FileVault decrypts at login and stays decrypted for as long as the machine is awake, which for a
machine running the platform is always. From that moment the files are plaintext to:

| | |
|:---|:---|
| any process running as this user | including anything that gets code execution through a dependency, a browser, or a shell |
| **a backup** | Time Machine, `rsync`, a cloud sync folder — the bytes leave the encrypted volume as plaintext and land wherever the backup lives |
| **a snapshot or a disk image** | an APFS snapshot copied off the machine is readable |
| **a compromised neighbouring service** | every process on the host shares the filesystem; the job service, the media worker and the CLI all read this tree |
| a support session, a screen share, a misdirected `scp` | nothing about full-disk encryption applies once the volume is mounted |

Volume encryption protects the disk from someone who has the disk. It does not protect the data
from anyone who has the machine running — and the machine is always running.

## 8. The fifth control: a SENSITIVE pack does not install onto a plaintext store

Because C closes exactly one threat, it is a **layer, not an option**, and B must not be left to
someone's memory. The publish gate of §2 gains a second condition, and it is not the pack's to
satisfy — it is the platform's:

```java
if (bundle.regulatoryClass() != RegulatoryClass.STANDARD
    && !assetStore.mayHoldProtectedDocuments()) {
  problems.add("pack … declares regulatoryClass SENSITIVE and this deployment stores assets in "
      + "the clear: set orazaka.studio-service.assets.encrypted-at-rest=true …, or "
      + "…deployment=LOCAL if this is a developer machine whose disk is the data subject's own");
}
```

Two declarations, both defaulting to the answer that **refuses**:

| Key | Default | Meaning |
|:---|:---|:---|
| `orazaka.studio-service.assets.encrypted-at-rest` | `false` | the store encrypts what it holds — option B's envelope, not a volume the OS happens to have unlocked |
| `orazaka.studio-service.assets.deployment` | `HOSTED` | `LOCAL` means one machine where the disk, the operator and the data subject are the same person |

A process cannot observe whether the filesystem beneath it is encrypted, and asking it to guess is
the inference AGENTS.md §12 forbids. So the platform **declares** it, and a deployment that has
answered nothing is treated as a hosted deployment holding plaintext — which is what it is. Our own
`application.yml` now says `deployment: LOCAL` in one line, which is the asymmetry of
[ADR-050 §1](ADR-050-declared-not-inferred.md) again: the local operator is in the room and pays one
line; the future hosted operator is not, and gets the refusal rather than the silence.

**The effect:** a `SENSITIVE` pack installs on this machine today and is refused the moment the same
bundle is pointed at anything else, until B lands. The gate cannot be forgotten, because it is not
a thing anyone has to remember.

Note that this control is enforced in `PackInstallerService.validate` and **not** in `PackBundle`'s
constructor, where the `scopeGuard` gate lives. The difference is real: `scopeGuard` is a property
of the bundle and travels with it, while encryption is a property of the platform being installed
onto. `validate` is already documented as "whether the platform it is being installed onto can
actually run it", and this is exactly that question.

## 9. Option B, costed — and the cost is not stable

B is out of scope for this run. Its price, recorded so the next run does not re-derive it:

- **~2–3 days.**
- **A language-neutral envelope format** — AES-256-GCM with an explicit header — because the store
  is not read by one program. Three processes in two languages touch this tree: the conversation
  service (upload and serve), the job service (step inputs and outputs), and the Python media
  worker. A Java-serialised envelope would lock the worker out of its own inputs.
- **Three writers and three readers** to convert, plus the CLI's `recover` command which walks the
  same tree.
- **351 files to migrate**, 5.8 MB, as of 2026-09-06.

**That last number is the one that moves.** It was 351 files at the end of this run; every run of
every pack adds to it, and a migration over live data is priced by what it has to convert, not by
the code that converts it. The credit-scale migration of
[ADR-047](ADR-047-credit-scale-and-image-metering.md) made the same point from the other side: it
had to refuse to run while any hold was `ACTIVE`, and the window in which that is true narrows as
usage grows. B is cheapest today and has never been cheaper than it is now.

