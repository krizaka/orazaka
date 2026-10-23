---
title: "ADR-087 — Grounded research: the engine looks things up, reads the source and cites it"
description: "Live research is an engine capability, not a product feature: search, fetch and official sources as administrator-managed data, mandatory citations checked by a verifier, SSRF and prompt-injection guards, a cache, per-call metering, and golden cases where the model alone invents and grounded research must not."
category: ADR
order: 87
---

# ADR-087 — Grounded research: the engine looks things up, reads the source and cites it

- **Status**: Proposed (2026-10-23). It waits for the coordinator's « validé »; nothing is implemented before that.
- **Date**: 2026-10-23
- **Issue**: [krizaka/orazaka#383](https://github.com/krizaka/orazaka/issues/383) (priority: ultra)
- **Builds on**: [ADR-083](ADR-083-client-connectivity-and-capacity.md) (client connectivity, #239 Studios as an MCP server),
  ADR-064 (trust boundaries: no user content in logs), ADR-054 (encryption at rest), orazaka-studio#59 (step output contract),
  [krizaka/orazaka#364](https://github.com/krizaka/orazaka/issues/364) (the tools module as a provider gateway),
  [krizaka/orazaka-packs#107](https://github.com/krizaka/orazaka-packs/issues/107) and
  [#24](https://github.com/krizaka/orazaka-packs/issues/24) (MCP servers and tool effects in pack v2)
- **Scope**: `orazaka-ai-engine` (`orazaka-interceptors`, `orazaka-tools`), `orazaka-job-service` (capability row, engine
  tables), `krizaka-billing` (pricebook rows), `orazaka-studio` (citation contract), `orazaka-packs` (golden cases),
  `orazaka-web-client` (console), the workspace (`infra`, dev migration)
- **Design**: [docs/design/grounded-research.md](../design/grounded-research.md)

## Context

Orazaka answers from what the model remembers. We asked it for the brief of a legal review, and it named two
repositories that do not exist, government URLs that do not exist, and a 14-day cancellation rule that it attributed to
Québec's consumer protection law, which is not where that rule comes from. The raw output is on
[krizaka/krizaka-com#365](https://github.com/krizaka/krizaka-com/issues/365). A model's memory has no source, so nothing
in the answer can be checked, and the products (Yomizaka's lease checks, Akinaza's tax preparation) cannot ship legal or
fiscal statements that way.

We will not feed facts by hand, and we will not build a retrieval stack inside every product's BFF. The engine must look
things up, read the source, and cite it, for every product, configured by the administrator.

### What exists today (read in the code, 2026-10-23, `main`)

| Piece | Where | What it really does |
|:---|:---|:---|
| Interceptor pipeline | `orazaka-interceptors`; order and on/off in `pipeline_interceptor_config` (`30-jobs-config.sql:280`) | DB-driven chain of `PromptContextInterceptor`s before and after the model. This is the extension point. |
| `McpInterceptor` | `interceptor/enrichment/McpInterceptor.java` | Calls `McpOrchestrator.resolveExternalContext()` and prepends the result as a **`SystemMessage("MCP Context: …")`**. |
| `DefaultMcpOrchestrator` | `orazaka-tools/…/adapter/mcp/DefaultMcpOrchestrator.java` | A plain HTTP `GET` on each `REMOTE` platform server and each user server (`platform_mcp_servers`, `user_mcp_servers`), body concatenated. It does not speak the MCP protocol (no `initialize`, no `tools/list`, no `tools/call`), and errors become an empty string. |
| `McpService` | `orazaka-tools/…/service/McpService.java` | `getMcpTools()` returns `List.of()` and `getMcpContext()` returns `""`: a stub. |
| `ToolInterceptor` | `interceptor/tooling/ToolInterceptor.java` | Attaches tools to a non-streaming request. The two "specialised" tools are chosen by keywords (`"image"`, `"audio"`, `"voice"`…). |
| `DefaultToolRegistry` | `orazaka-tools/…/adapter/mcp/DefaultToolRegistry.java` | Three tools. **`searchWeb` is not a web search**: it queries the knowledge service's corpus (`knowledgeService.searchSources`). `analyzePoster` and `analyzeAudioExtract` return canned strings. |
| Tool cache | `orazaka_tools_cache`, `platform_tool_configs` (`cache_ttl_seconds`), `CachingToolCallback` | A key-value cache per tool with a TTL. |
| `RagInterceptor`, `KNOWLEDGE` step | `orazaka-interceptors`, `StepKind.KNOWLEDGE` | Retrieval over the actor's own sources (knowledge service). It does not read the web. |
| `ClosedLoopValidationInterceptor` | `interceptor/validation/` | Validates an answer after the model and asks again, up to `maxRetries`. This is the pattern for the verifier. |
| Output contract | `orazaka-studio` `OutputContract` (#59) | A step declares a JSON Schema subset (`type`, `required`, `properties`, `items`, `minItems`, `minLength`, `enum`…); a step output outside it fails as `EXECUTOR_FAULT`. |
| Pricebook | `krizaka-billing` `credit_pricebook` | `(capability, model_name) → unit, credits_per_unit`; the units include `CALL`. |
| Settings | `orazaka_runtime_config` (engine), `studio_runtime_config` (Studio) | Key, value and type rows, read at run time. |
| Mutable secret store | `user_mcp_servers.auth_token VARCHAR(1000)` | **Plain text.** |

So the engine has the right extension points (pipeline, tools, cache, contract, pricebook, settings), but no live
research. Four of the pieces above are misleading: `searchWeb` is a corpus query, the MCP client is a `GET`, its result is
injected as a system instruction, and MCP tokens are stored in clear. This ADR builds on the extension points and corrects
those four. It adds no second mechanism beside them.

### What we read outside the code (sources opened 2026-10-23)

- **SearXNG** is a self-hostable metasearch engine. It is licensed AGPL-3.0
  ([README](https://github.com/searxng/searxng)), and it answers `format=json` once that format is enabled under
  `search:` in `settings.yml`; « Requesting an unset format will return a 403 Forbidden error »
  ([Search API](https://docs.searxng.org/dev/search_api.html)).
- **Brave Search API**: Search plan **$5 per 1,000 requests**, $5 of free credits each month, 50 queries per second.
  Storing results requires « a plan that includes storage rights », and the page does not say which plans include them
  ([brave.com/search/api](https://brave.com/search/api/)).
- **The MCP fetch server** (reference implementation) fetches a URL and returns Markdown, with `max_length` (default 5000),
  `start_index` and `raw`. It honours robots.txt for model-initiated requests. It blocks non-public addresses by default,
  and its README says the check « does not guard against DNS rebinding between the check and the connection »
  ([modelcontextprotocol/servers fetch](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)).
- **RFC 9309** (Robots Exclusion Protocol, Standards Track): crawlers « MAY cache » robots.txt, and « SHOULD NOT use the
  cached version for more than 24 hours » ([RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) §2.4).
- **Justice Laws** publishes an XML index of federal acts (`ActsRegsList`, with `Title`, `CurrentToDate` and `LinkToXML`
  per act and language) ([Legis.xml](https://laws-lois.justice.gc.ca/eng/XML/Legis.xml)).
- **CanLII API**: a key « on request » through the feedback form; read-only; **metadata, not full text**; responses capped
  at 10 MB ([API documentation](https://github.com/canlii/API_documentation/blob/master/EN.md)).
- **GitHub REST**: an installation token starts at 5,000 requests per hour, and unauthenticated requests get 60 per hour
  ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
- **LégisQuébec** (measured from this Mac, 2026-10-23): `GET /fr/version/lc/CCQ-1991?code=se:1904` answers **403
  (CloudFront « Request blocked »)** to the honest user agent `OrazakaResearch/0.1 (+https://www.orazaka.com)`, and **200**
  to a browser user agent. We will not disguise the engine as a browser: the permitted way to read LégisQuébec
  automatically is **TO VALIDATE** with its publisher.
- **Registraire des entreprises**: the site answered 403 to the fetch tool, and its open-data dataset page could not be
  read. Its terms for automated access are **TO VALIDATE**.

## Decision

### 1. Grounded research is an engine capability, reached two ways, built from the existing pieces

- **One flag on a chat or text request**: `grounding: { enabled: true }`. It switches on two interceptors in the existing
  pipeline. **`GroundingInterceptor`** (enrichment) plans the queries, searches, fetches and puts the extracts in the
  prompt **as data**. **`CitationVerifierInterceptor`** (validation, after the model, on the pattern of
  `ClosedLoopValidationInterceptor`) checks every claim. Both are rows of `pipeline_interceptor_config`: the
  administrator orders them and turns them off.
- **One capability for Studios**: `orazaka.core.research.grounded` in `orazaka_capabilities`. It is a `CAPABILITY` step,
  on the job plane like `orazaka.core.chat.completion` (same text lane). Its output contract is the citation shape of §3.
  **There is no new step kind**: a blueprint asks for a grounded answer the way it asks for any capability.
- A product does nothing beyond the flag or the step. Nothing is built in a product's BFF.
- **Search, fetch, official sources, GitHub and MCP are tools of `orazaka-tools`**, each behind a port: `SearchProvider`,
  `PageFetcher`, `OfficialSource`, `CodeHost`. They are registered in `DefaultToolRegistry`, so the model can call them in
  an agent loop as well as through the interceptor. There is no second tool registry and no second MCP client.

### 2. Sources are data the administrator manages

- **A `research_source` row** declares each source: its kind (`SEARCH`, `FETCH`, `OFFICIAL`, `CODE_HOST`, `MCP`), its
  provider (a vendor is a value, never a type), its scope (global, pack, Studio or actor), allow and deny patterns on
  host and path, its freshness, its rate, and whether it needs consent. Details are in the
  [design](../design/grounded-research.md#data-model).
- **Search defaults to a self-hosted SearXNG on dev only**, for sovereignty (AGPL-3.0, we run it unmodified as a separate service;
  our code only calls its HTTP API). **Brave Search API is the paid alternative** behind the same port, at $5 per 1,000
  requests with $5 of monthly credit, read above. The administrator chooses per source. **In production, search is off
  by default** until SearXNG's hosting and upstream limits are validated (CTO review of this ADR). Hosting SearXNG costs one small
  container, an amount **TO VALIDATE** on the dev platform. Whether SearXNG's upstream engines rate-limit or block a single
  instance is **TO VALIDATE** with a load test: it is the reason the paid option exists.
- **Fetch and extract**: readability-style extraction to text with the main content kept, over HTTPS (HTTP only if the
  source allows it). Limits are settings: 10 s, 2 MB, 3 redirects, `text/html`, `application/xhtml+xml`, `text/plain`,
  `application/xml` and `application/pdf` (text layer).
- **Official sources are adapters, not crawls**:
  - Justice Laws reads the XML index and acts;
  - CanLII uses its API, with a key requested from CanLII, for metadata and links (the full text is read from the
    page it points to, within the fetch rules);
  - LégisQuébec and the Registraire des entreprises are declared but **disabled** until their access conditions are
    validated. Meanwhile, a claim that needs them comes back `TO VALIDATE` with the official URL to open.
- **GitHub**: the API, through the organisation's GitHub App installation token, read-only (repositories, files,
  issues). It is the source of truth for « does this repository exist ».
- **MCP servers**: through the existing `platform_mcp_servers` / `user_mcp_servers` rows. `DefaultMcpOrchestrator`
  becomes a real MCP client (Streamable HTTP: `initialize`, `tools/list`, `tools/call`), and its tools join the registry.
  The pack v2 `mcpServers:` field (orazaka-packs#107, with `toolEffects` from #24) declares them, and **grounded research
  only calls `READ_ONLY` tools**.

### 3. Citations are mandatory, and a verifier checks them

- **Every factual claim of a grounded answer carries its citation**:
  - the URL it was read from;
  - the **quoted passage** (verbatim, ≤ 300 characters);
  - when it was fetched;
  - the hash of the fetched content.
  A claim without a citation is **removed** (mode `STRICT`) or **kept and marked `TO_VALIDATE`** (mode `MARK`, the
  default). It is never asserted. The mode is a setting, per source scope.
- **The verifier is deterministic, not another model**. For each citation, it reads the cached document by its hash (the
  same bytes the answer was built from), normalises the text and checks that the passage appears. The normalisation is Unicode NFC, then case folding, then
  French typography: « » and “ ” become plain quotes, ’ becomes ', the narrow and ordinary no-break spaces (U+202F,
  U+00A0) become a space (so « : » before ; : ! ? matches), the ligatures œ and æ become oe and ae, and runs of whitespace
  collapse. Golden tests cover French and English. It
  checks that the URL resolved (2xx, final URL after redirects recorded). It also scans the answer text for URLs,
  repository names (`owner/repo`) and statute references that are **not** among the citations: each one is checked
  (resolved, or looked up on GitHub) or becomes `TO_VALIDATE`. A failed check downgrades the claim; it never rewrites it.
- **The shape is a step output contract** (orazaka-studio#59), so a run whose output breaks it fails like any other
  contract breach. It is written within the keywords `OutputContract` enforces; the schema is in the design.

### 4. Security

- **SSRF**: only `https` (and `http` where the source allows it). The host is resolved once and the connection goes to
  **that** address (pinned), which closes the DNS-rebinding window that the MCP fetch server's README describes.
  Loopback, private, link-local, CGNAT, multicast and cloud-metadata ranges are refused, IPv4 and IPv6. Every redirect hop
  is checked again, with at most 3 hops. Time and size caps apply as above, and no cookies are sent.
- **Prompt injection**: fetched text is **data, never instructions**. It goes into the prompt as a delimited, quoted
  user-role block with its URL (never a `SystemMessage`, which is what `McpInterceptor` does today), and the system prompt
  says plainly that the block's content cannot change instructions. Tool calls proposed while reading fetched content are
  limited to `READ_ONLY` tools. Extracted text is stripped of scripts, hidden elements and zero-width characters.
- **Allowlists per scope, robots and rate limits**:
  - a source only fetches hosts and paths its patterns allow;
  - robots.txt is honoured, cached at most 24 h (RFC 9309), and an administrator **cannot** turn that off;
  - a token bucket applies per source and per host;
  - the user agent is honest (`OrazakaResearch/<version> (+https://www.orazaka.com)`).
- **Audit**: every search and fetch writes a `research_fetch` row (who, which source, host, path hash, status, bytes,
  duration, run or chat id). Queries and page contents never go in logs (ADR-064). Retention follows the run's data class.
- **Loi 25**: no personal information goes to an external search without consent and a purpose. A query carries the
  data class of its context: a Studio run's `DataClass`, or the chat's. A query from a `SENSITIVE` or `REGULATED`
  context goes only to sources flagged `allowsPersonalData` that the actor has consented to. The consent is a recorded
  row with its purpose, as the Studio's install consent is. Otherwise the search is refused with a reason the product
  can show. The self-hosted search never forwards the actor's identity; what SearXNG sends upstream is the query alone,
  and that is still an external disclosure, so the same rule applies to it.
- **Secrets**: MCP and provider credentials move out of `user_mcp_servers.auth_token` into encrypted storage (the existing
  encryption at rest, ADR-054), referenced by id.

### 5. Cost and caching

- **Cache**: a fetched document is stored once, keyed by **URL + content hash**: `research_document` holds the extracted
  text, ETag and Last-Modified. Each source has a freshness setting (official texts: 7 days; the web: 1 day), and a
  refetch inside it is a cache hit. Search results are cached by `(provider, normalised query)` for the source's
  freshness, and only when the provider's terms allow storing them (Brave: storage rights depend on the plan, so the
  default is no storage).
- **Metering**: a new billable capability `RESEARCH` in the pricebook, unit `CALL`, with `model_name` set to the provider
  key (`searxng`, `brave`, `fetch`, `canlii`…). A fetch, a search and an official lookup each cost credits the
  administrator sets. The model tokens of the grounded answer are billed as today (`CHAT`, `KILOTOKEN`). A cache hit costs
  0. The hold covers the worst case: `research.max-searches` plus `research.max-fetches` per answer. These caps and the
  hold are **the per-run budget of ADR-088** (krizaka/orazaka#389), not a second mechanism: grounded research
  declares its worst case into that budget, and the run's budget is what stops it.

### 6. Evaluation

- **Golden cases** in `orazaka-packs` (the harness of orazaka-packs#114): questions where the model alone invents.
  The first one is the legal-review brief of krizaka/krizaka-com#365. A grounded run must contain:
  - **no repository that does not exist**, checked against the GitHub API;
  - **no URL that does not resolve**;
  - **no misattributed rule**: every statement about a statute carries a citation whose quote is found in the cited text,
    or is marked `TO_VALIDATE`.
- The offline lane checks the contract and the verifier on recorded documents. The live lane runs on the protected
  runner, against live sources.
- **A regression on the model alone is recorded too**: the same case without grounding must still show the invention.
  This proves the case actually tests something.

## Alternatives weighed

| Option | Why not (or not alone) |
|:---|:---|
| RAG in each product's BFF | Duplicated per product, unaudited, unmetered, and each product would solve SSRF and injection again. Refused by the issue and by this ADR. |
| A model with built-in web search (vendor tool) | Not sovereign. Citations and quotes cannot be verified on our side, the data goes to the vendor, and cost and behaviour are outside the admin's control. It may become one more `SearchProvider` value later, never the mechanism. |
| A second LLM as the verifier ("judge") | Not deterministic: it can invent agreement. A quote match on the stored bytes either holds or does not. A judge can be added after the deterministic check for paraphrase, never instead of it. |
| A crawler that mirrors official texts | Heavier, and it raises reuse terms we have not validated. Adapters with a cache read only what an answer needs. |
| Only paid search (Brave) | $5 per 1,000 requests is cheap, but it is a dependency on one vendor and it sends every query abroad. It stays an option behind the port. |
| Only SearXNG | Free and sovereign, but whether upstream engines block one instance is unknown (TO VALIDATE). The paid option is the fallback. |
| A new step kind `RESEARCH` | The capability registry already routes, bills and contracts a step. A kind would add a branch to the DSL for nothing. |

## Consequences

- Products get grounded answers with one flag or one step. The administrator controls sources, cost, consent and modes
  from the console.
- Four defects of the current code are fixed on the way:
  - `searchWeb` is renamed to what it is (`searchKnowledge`);
  - MCP content is no longer a system instruction;
  - the MCP client speaks MCP;
  - MCP tokens are encrypted at rest.
  The first two change behaviour, and their tests change with them.
- New tables and settings live with the engine's other tables (`30-jobs-config.sql`, then a dev-deploy migration). A
  self-hosted SearXNG joins the infrastructure as a service (compose and dev deploy). Its AGPL obligations apply to the
  service we run unmodified, not to our code; that reading is **TO VALIDATE** with counsel before production.
- A grounded answer is slower (search + fetch + verify) and costs a few calls. The caps and the cache bound both, and the
  latency budget is measured in slice 5 before any default is changed.
- What stays `TO VALIDATE` until it is checked:
  - LégisQuébec and Registraire access;
  - the SearXNG hosting cost and its upstream limits;
  - Brave storage rights;
  - the AGPL reading.
  Until each is validated, its part of the design is disabled.

## Slices

The slices are detailed with their acceptance criteria in the [design](../design/grounded-research.md#rollout). Each is
test-first, and each ships its README and generated docs.

0. **Honesty fixes** (ai-engine): rename `searchWeb` to `searchKnowledge`; MCP content as data; encrypt MCP tokens at rest.
1. **Fetch, safely** (ai-engine + job-service tables): `PageFetcher` with the SSRF guard, extraction, `research_document`,
   `research_fetch` audit, robots, settings.
2. **Citations and the verifier** (ai-engine + studio contract).
3. **Search** (ai-engine + infra): `SearchProvider` with a SearXNG adapter, a Brave adapter, the cache, Loi 25 screening.
4. **Official sources and GitHub** (ai-engine): Justice Laws, CanLII, GitHub. LégisQuébec and Registraire stay disabled.
5. **The capability and the flag** (job-service, billing, ai-engine): `orazaka.core.research.grounded`, `grounding`
   flag, `RESEARCH` pricebook, holds.
6. **The console** (web-client): sources, settings, audit.
7. **Evaluation and the first Studio** (packs): the golden cases, then a grounded legal-brief Studio.
8. **MCP client** (ai-engine, with packs#107): real MCP over Streamable HTTP, `READ_ONLY` tools only.
