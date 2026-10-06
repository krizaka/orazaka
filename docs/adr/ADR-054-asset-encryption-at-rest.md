---
title: "ADR-054 — Encryption at rest: an envelope per file, a key outside the repository, and a Range that still works"
description: "Finding #13 closed. A per-file data key wrapped by a master key that never lives in .env, block-addressable so an HTTP Range decrypts one block, migrated in a run that is resumable because it holds no state."
category: ADR
order: 54
---

# ADR-054 — Encryption at rest

- **Status**: Accepted
- **Date**: 2026-09-09
- **Scope**: new module `orazaka-libs/orazaka-assets`; `AssetService`, `MediaAnalysisController`,
  `JobReconciliationService`, `MediaFileStore` ×2, `JobListener`, `MediaJobExecutor` and its three
  strategies; `app/envelope.py`, `app/consumer.py`; `docs/ASSET_ENCRYPTION.md`
- **Closes**: `PRODUCTION_READINESS_AUDIT` finding #13; the last condition of
  [ADR-051 §8](ADR-051-sensitive-controls.md)'s fifth control
- **Supersedes**: [ADR-051 §9](ADR-051-sensitive-controls.md), which costed this and deferred it

## 1. What this closes

ADR-051 shipped five controls for a `SENSITIVE` pack and named the one it did not: the four
run-time controls govern *the run* — what is recorded, kept how long, read back by whom, answered
how — and **none of them encrypts the bytes**. The fifth control therefore refused a protected pack
on any deployment that was not a developer's own machine. That refusal is now liftable, because the
store encrypts.

ADR-051 §9 costed it at ~2–3 days and observed the count was not stable: 351 files then, **379 at
the start of this run**. It was cheapest then and it has never been cheaper since.

## 2. Envelope, not direct encryption

One data key per file, wrapped under a master key the format never sees. The header names which
master key wrapped it.

**Rotation is a line in a file.** `keygen … k2` adds a key and makes it active; new files use `k2`,
every existing file still names `k1` and still opens. Nothing in the store is rewritten. Under
direct encryption, rotating would have meant re-encrypting all 379 files — and the count only goes
up, so the cost of the thing an auditor asks about first would grow forever.

`wrapped` is **opaque to the format**: whatever the provider returned, stored and handed back
unexamined. A file-backed provider puts a nonce and a tag in there; a KMS puts its own blob.
Neither the writer, the reader nor the migrator can tell, which is the property §3 is about.

## 3. The master key does not live in `.env`

`MasterKeyProvider` has three methods — `activeKeyId`, `wrap`, `unwrap` — and **no getter**. There
is no `getMasterKey()` and there will not be one: it is the single secret whose compromise is
total, and a method returning it would be called. A test asserts the interface has exactly those
three methods, because the pressure to add a fourth arrives later and quietly.

**Local**: a keyring file outside the repository, mode `0600`, holding only keys. The provider
**refuses to start** if anyone but the owner can read it — a world-readable master key is not a
smaller version of a secure one, and a warning would be a warning nobody reads. `.gitignore` bans
`*.key` from the tree as a second guard.

**Cloud**: a KMS-backed implementation of the same interface, selected by
`@ConditionalOnMissingBean`. Nothing above the port changes.

> **The interface is identical on both sides on purpose.** If the local path unwrapped keys
> differently from the path that matters, every test would exercise code that production does not
> run. Here the only difference is which bean is present.

## 4. The Range trap, handled at the design and not at the end

AES-GCM's authentication tag covers a whole message, so a file sealed as one message **cannot be
decrypted from an arbitrary offset**. `AssetController` serves video with `Range`, and Spring's
`ResourceRegionHttpMessageConverter` serves a range by opening the resource and calling
`skip(start)`. Over a single-message file that means decrypting everything before the range: a seek
to the last second of a video costs the whole video.

**The payload is therefore a sequence of independently sealed 64 KiB blocks.** A seek lands on a
block boundary, decrypts one block, and discards the bytes before the offset;
`BlockDecryptingInputStream.skip()` is a channel `position()` rather than a read-and-discard. A
range over-reads at most one block at each end.

`EncryptedFileResource` reports the **plaintext** length from the header, so `Content-Length` and
range arithmetic are correct without decrypting anything.

Two things the block structure also buys, and the tests pin both: a block moved to another position
fails to authenticate, and so does a truncated file — the AAD of block *i* is the **whole header**
followed by *i*, so length, key id, wrapped key and block order are all covered.

The materialising cost lands where a tool can only open a file: ffmpeg and Pillow take paths, not
streams, so the media worker decrypts inputs into a scratch directory it owns and deletes. That is
a real, bounded window of plaintext, in a directory the worker creates and removes, and it is
stated rather than hidden.

## 5. The migration holds no state, which is what makes it resumable

**A file is converted if and only if it opens with `ORZAENC1`.** There is no ledger, because a
ledger is a second source of truth that can disagree with the data — and the question "which of the
379 are done" is one the store can answer about itself. Each file is written to a sibling temp and
`move`d into place, so a process killed mid-file leaves the original untouched, never a half-sealed
one. Killed halfway, the fix is to run it again.

One unreadable file does not strand the rest: it is named and the run continues, and the original
is untouched, so a re-run picks it up once whatever broke is fixed.

**Verifiable separately from "it ran".** `verify` opens every encrypted file and checks it yields
the length its header claims. Observed on the real store:

```
migrate: 379 converted, 0 already encrypted, 0 failed
verify:  379 verified,  0 still plaintext,   0 failed
migrate: 0 converted,   379 already encrypted, 0 failed     ← the second run
```

**The read path accepts both formats only while `accept-plaintext` is on**, and it defaults to
**off**. With it off, an unconverted file is *not readable* — 404, like every other unreadable case
— rather than served in the clear. A permanent tolerance is a permanent door: with it on
permanently, anyone who can write to the store can also make the store readable. Both states log a
warning naming what they are.

## 6. Two languages, pinned to each other

The store is written by three processes in two languages, and the way that breaks is silently: one
side changes the header and keeps opening the files it wrote itself. `EnvelopeCodec.java` and
`app/envelope.py` are pinned by a fixture — Java writes `target/interop/java-written.bin` under a
fixed key, Python opens it, seeks inside it, refuses a tampered copy, and writes its own for Java
to read back. Neither can drift without the other going red.

## 7. What is now true

- `orazaka.studio-service.assets.encrypted-at-rest` is **`true`** here, so a `SENSITIVE` pack
  installs on a hosted deployment that makes the same claim. It still **defaults to false**: a
  deployment that has answered nothing is treated as one storing documents in the clear, which is
  what it is (ADR-051 §8, unchanged).
- FileVault (ADR-051 §7, option C) still covers the stolen-machine threat. This covers the ones it
  never did: a backup that leaves the volume, a snapshot copied off, a compromised neighbouring
  process, anything running as this user. **They are layers.** Turning either off is a decision, not
  a tidy-up.
- Finding #13 of `PRODUCTION_READINESS_AUDIT` is closed, and its row keeps its line.

## 8. What this does not do

- **The database is not encrypted at rest by this change.** Chat content, run inputs and audit rows
  live in Postgres and are covered by the volume, not by an application envelope. That is a
  separate finding and a separate decision.
- **Filenames and directory structure are not hidden.** `…/{owner}/{jobId}/output/video.mp4` still
  says an owner ran a job that produced a video. Encrypting the tree shape is a different design and
  was not asked for here.
- **A scratch directory holds plaintext while ffmpeg reads it** (§4). Bounded and owned, but real.
