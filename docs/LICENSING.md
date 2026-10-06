---
title: "Licensing — where the line falls in the tree"
description: "Everything in this repository is Apache-2.0. What is proprietary lives in another repository, and the boundary is the repository, not a flag."
category: Reference
order: 2
---

# Licensing

**Everything in this repository is Apache-2.0.** Engine, pack SPI, CLI, reference packs — all of
it. There is no proprietary code here, and none may be added.

## Where the line falls

| Layer | Home | Licence |
|:---|:---|:---|
| Engine — studio, job plane, billing, identity, edge, interceptors, persistence | **this repository** | Apache-2.0 |
| Pack SPI — `pack.schema.json`, `orazaka-jobs-api`, `docs/WORKER_PROTOCOL.md`, `PackInstallerService`, the `orazaka pack` CLI | **this repository** | Apache-2.0 |
| Reference packs — `orazaka-packs/**` | **this repository** | Apache-2.0 |
| Commercial packs | `orazaka-packs-cloud` (private) | proprietary |
| Hosted registry, managed workers, control plane, SLA | private | proprietary |

**The boundary is the repository, not a flag.** A `distribution: CLOUD` pack sitting in a public
repository is readable by everyone, which defeats the point; the manifest's `distribution` field
drives *catalogue visibility per deployment*, never secrecy (ADR-037 §4.1).

The two worlds differ by **one line of configuration** and nothing else:

```bash
# OSS deployment — the default
ORAZAKA_PACKS_SOURCES=orazaka-packs

# Cloud deployment — same artifact, one more source
ORAZAKA_PACKS_SOURCES=orazaka-packs,/srv/packs,registry:https://registry.orazaka.dev
```

If a cloud pack ever requires a change inside this repository, the split has failed and that is a
bug in the SPI, not a packaging decision. Phase G found four such changes and fixed them; they are
listed in [ADR-049](adr/ADR-049-open-core-split.md).

## Two things a reader mistakes

**`orazaka-packs/pack.schema.json` is SPI, not a pack.** It is the manifest contract the platform
enforces, and it happens to live beside the reference packs it describes. It is Apache-2.0 either
way, so nothing turns on the placement — but it is the platform's file, and the CLI resolves it
from its own installation rather than from whatever tree a bundle sits in.

**A reference pack is not a sample.** `orazaka-packs/echo-toolkit` is a Tier-W pack with a worker
that runs; the three others are Tier-D packs the product actually ships. They are reference in the
sense that they are the worked example of each tier, not in the sense of being throwaway.

## Third-party pack authors

A pack you write is yours. Nothing in Apache-2.0 obliges you to publish it, and the platform never
reads your bundle from this repository — see [CONTRIBUTING-PACKS.md](../CONTRIBUTING-PACKS.md).
