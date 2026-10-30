---
title: "ADR-090 — The tools module as the provider gateway: credit, screening and legal data behind one port, chosen by the user, off by default"
description: "Products do not write their own integrations with credit, screening or legal-data providers. Orazaka's tools module carries one outbound port, ExternalCheckConnector, routed by a handler_key column in the database, with consent per purpose, the user's key over the platform's, a metered CALL per search and one audit line per call. No paid legal source is bought now: the official statutes are free and already in the law corpus. Every provider is an option, off until an admin enables it and a lawyer has cleared it."
category: ADR
order: 90
---

# ADR-090 — The tools module as the provider gateway

- **Status**: Proposed (2026-10-27), for the CTO's « validé ». The gateway itself is already built (see « What exists »); this ADR records the decision, the cost table and the rules for the next provider.
- **Issue**: [krizaka/orazaka#364](https://github.com/krizaka/orazaka/issues/364)
- **Builds on**: the design note [`external-checks.md`](https://github.com/krizaka/orazaka-ai-engine/blob/main/docs/design/external-checks.md) and its code (orazaka-ai-engine#73, #83, #84, #101), [ADR-087](ADR-087-grounded-research.md) (research sources as data, the `CALL` meter), [ADR-088](ADR-088-runs-as-background-tasks.md) (budgets), [ADR-089](ADR-089-rules-from-the-law.md) (the law corpus).
- **Guardrails from**: yomizaka#132 and #135 (consent, Loi 25, the reseller agreement, a lawyer before any live call).

## 1. Context

Yomizaka and Akinaza may need data that only a third party holds: a credit report, a court-records search, an identity check, or a legal source. Without a shared door each product would write its own integration, its own consent and its own billing. Oussama (2026-10-22) asked whether Orazaka's tools module can be that door, and asked for the lowest cost.

## 2. What exists (checked in the code, 2026-10-27)

- **The port**: `ExternalCheckConnector` (`orazaka-core`, `domain.ports.outbound`) with `verifyCourtRecords`, `verifyCredit` and `verifyIdentity`. A result is an outcome and a closed category, never a name, a date or a record.
- **Adapters**: `soquij`, `trustii`, `certn` (HTTP, provisional wire format, recorded answers only) and `mock` (the fixtures of CI and the demo). No live call has ever been made.
- **Routing is data**: provider rows are settings (`checks.provider.<name>.{handler-key,purposes,regions,priority,enabled,endpoint,price-micros}`); `CheckRouter` picks the enabled row for the purpose and region, lowest priority first, and the `handler-key` names the adapter. No `@Order`, no test on a name.
- **Consent per purpose** (Loi 25), checked at every call before the connector; a withdrawn consent or a new statement version stops the old one.
- **Key**: the user's own key over the platform's, from the sealed settings (ADR-054); no key is `REFUSED / NO_KEY`; an unconfigured row fails closed.
- **Metering**: one `CALL` held per executed search on the pricebook row `(EXTERNAL_CHECK, <provider>, CALL)`, settled on a match or no match, released on an error or timeout; a refusal takes none.
- **Audit**: one `external_check_audit` line per call, subject as a keyed HMAC, never a name.
- **Cost tracking**: the provider's own price (`price-micros`) is recorded on the audit line when the platform key paid.

## 3. Decision

1. **Yes, the tools module is the provider gateway.** A product asks for a purpose (`COURT_RECORDS`, `CREDIT`, `IDENTITY`) as an engine capability and never names a provider. Adding a provider is one adapter, one `handler-key` and one settings row.
2. **No paid legal-data source now.** The statutes the packs need (Code civil du Québec, and the federal and provincial texts that follow) are the official, dated, hashed law corpus (ADR-089), which costs nothing to read. Case law (SOQUIJ, CanLII) is not needed to judge a document against the articles; it is added only if a rule can be written no other way, as a new row and adapter.
3. **Screening is optional, per check, and off by default.** Tenant screening (credit with Trustii, court records with SOQUIJ in Québec and Certn elsewhere) is never part of a base check. The user chooses per check between « without a paid provider » (the default, deterministic packs and the official texts) and « with a credit check, X $ » (the price the admin set, shown before the user agrees).
4. **Choice and defaults follow the settings resolution user > workspace > global** that Yomizaka already has. The admin sets the global defaults: which providers are on, the price and the margin. A workspace may narrow them; a user may only choose among what remains. A user's own key still pays the provider directly; the platform keeps its `CALL` fee.
5. **Guardrails, all enforced in the service rather than the product**: consent for each purpose, with its own statement; no criminal-record check for housing unless a lawyer has cleared it and the workspace has turned it on; no live provider call before the reseller agreement, the provider account and the lawyer's review; every call audited; nothing but an outcome leaves the gateway.

## 4. Cost table

Only what a provider publishes is written as a price. Everything else is « to confirm at account opening » and stays out of any figure shown to a user.

| Source | Purpose | Cost to Orazaka per call | Source of the figure | Decision |
| --- | --- | --- | --- | --- |
| Official statutes (Données Québec, LégisQuébec) | Legal texts | $0; licence CC BY-NC-ND 4.0, read internally, linked and never republished | the dataset page | Use (ADR-089) |
| SOQUIJ Plumitifs web service | Québec court records | a charge for each search; amount and API terms not public | SOQUIJ's mini guide (the PDF was unreachable on 2026-10-23); **to confirm** | Adapter built, off; open the account only with a pilot customer |
| Trustii | Credit, identity | not public; the bureau behind it is unknown | trustii.io names no product; **to confirm** | Adapter built, off |
| Certn (CertnCentric) | Court records and identity outside Québec | not public; the old API ended 2026-08-05 | Certn's docs; **to confirm** | Adapter built, off |
| Equifax via CRS | Credit | not public | none read | Not built; compare with Trustii at account opening |
| CanLII API, SOQUIJ case law | Case law | access by request, no public price | none read | Not needed now |
| Orazaka's own `CALL` fee | Orchestration | the `EXTERNAL_CHECK` pricebook row (a platform price, not a provider cost) | krizaka-billing price book | Kept on every executed call |

The cheapest path is therefore the default one: no provider, the official texts, deterministic rules. A paid check is a cost the user sees and accepts.

## 5. Consequences

- A new provider never changes a product. It needs an adapter test that extends the connector contract (no name, date or address in a result or an audit line), a settings row and, before any live call, the three go-aheads of guardrail 5.
- The user-key store has no implementation yet (`SealedCheckKeyStoreAdapter.userKey` answers empty); it is the next slice when a customer wants its own account.
- The wire formats are provisional until an account exists; the first task at account opening is to map each real API and to replace the recorded answers by the provider's sandbox.
- The settled charge on a provider error or timeout (proposed: 0), the consent statements (counsel) and whether a user key still carries the platform fee (proposed: yes) stay open points for the CTO and counsel, as in the design note.
- Removing the gateway later costs nothing for the products: they depend on three purposes, not on a vendor.
