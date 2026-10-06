---
description: CODE-DRIVEN DOCUMENTATION SYNC
---

# Workflow: Documentation Sync

Documentation is split in two. **Generated docs come from the code and are never
hand-edited**; **curated docs** are design intent and guides, hand-authored.

## §1 Generated — `docs/_generated/` (AGENTS.md §10)

Produced by `scripts/generate-docs.mjs` (run via `orazaka docs build`) and gated
by the Maven build (`docs-check`, test phase) — the build fails if they are stale.
Never edit these by hand; change the **code**, then run `orazaka docs build`.

| File | Source of truth (code) |
|:---|:---|
| `architecture.json` | module poms, port dirs, `infra/initdb/*.sql`, messaging topology config |
| `ARCHITECTURE.md` | modules / dependency edges / pipeline / messaging |
| `INTERFACES.md` | inbound/outbound port interfaces |
| `USE_CASES.md` | `orazaka-business` UseCase implementations |
| `INTERCEPTORS.md` | `orazaka-interceptors` + the `infra/initdb` pipeline order |
| `API_REFERENCE.md` | router `@RestController` `@*Mapping`s |
| `CLI.md` | `orazaka-cli` command definitions |
| `MODELS.md` | `infra/initdb` model catalog seed |
| `ADRS.md` | `ADR-NNN` citations + `docs/adr/*` files |

## §2 Curated — hand-authored (keep current by hand)

- `AGENTS.md` (root) — governance contract.
- `docs/VISION_ARCHITECTURE.md` — target architecture vision.
- `docs/INTERFACES.md` — interface/wiring design contracts (design intent).
- `docs/DEVEX_LIFECYCLE.md` — dev workflow, environments, lifecycle.
- `docs/adr/*.md` — ADR source records.
- Guides: `101`, `GLOSSARY`, `AUTH`, `CORE`, `AUTOMATION`,
  `BUSINESS_IMPLEMENTATION`, `UI_REFERENCE`, `MASTER_FEATURES`, `END2END_TEST`.

## §3 Procedure

1. Make the code change.
2. `orazaka docs build` — refresh `docs/_generated/` (or the build will fail).
3. Update any affected **curated** doc by hand (new env var → `GLOSSARY`; new
   decision → a `docs/adr/` file referenced from `AGENTS.md`).
4. `orazaka docs sync` — copy `docs/` (+ generated) into the Krizaka site content
   tree and `architecture.json` into the site's data dir.

## §4 Quality Gates

- `orazaka docs build --check` (Maven `docs-check`) must be green.
- Missing Javadoc / TSDoc on public contracts is a review violation.
