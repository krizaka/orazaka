---
description: PRODUCTION READINESS — PHASED REMEDIATION (wave 1 = the four security blockers)
---

# Workflow: Close the production-readiness findings

Findings, evidence and rationale: [`docs/PRODUCTION_READINESS_AUDIT.md`](../../docs/PRODUCTION_READINESS_AUDIT.md).
**That audit is normative for *what* is broken and *why it matters*. This workflow is normative for
*how* and *in what order*. Where they disagree, the audit wins and this file is corrected.**

## §0 Init

1. Load `AGENTS.md` — §2 (tiers), §3 (naming), §4 (backend), §5 (persistence), §9 (testing),
   §11 (security) all bind this work.
2. Load `.agent/rules/security_standards.md`, `testing_standards.md`, `naming_conventions.md`.
3. Read `docs/PRODUCTION_READINESS_AUDIT.md` §2 (blockers), §6 (index), §7 (plan), §8 (what was
   never verified).
4. Read for pattern-matching **before writing anything**:
   - `krizaka/krizaka-billing/krizaka-billing-service/…/infrastructure/config/SecurityConfig.java` —
     the correct shape (JWT resource server + `JwtAuthenticationConverter`)
   - `orazaka-apps/services/orazaka-conversation-service/…/adapter/rest/JobController.java` — how an
     authenticated, actor-scoped controller reads the principal in this codebase
   - `orazaka-libs/orazaka-contracts/orazaka-persistence-app-api/…/JobPersistenceProvider.java` — the owner
     lookup (`getJob(jobId)` → `JobDto.userId()`) that §1.1 needs
   **Mirror these. Do not invent a new structure.**

## §1 Scope of THIS run — wave 1 only, the four security blockers

**In scope**: audit findings **#1, #3, #4, #5** — the ones that make a launch unsafe. Nothing else.

**Out of scope, do NOT start**: Flyway (#2), backups/quorum queues (#6), edge timeouts (#7), rate
limiting (#8), the `orazaka-service-kit` extraction (#9–#11, #17), encryption at rest (#13). Those
are waves 2–4 (audit §7). If wave 1 is green and you have budget left, **stop and report**.

> Finding #2 (no migration path) is equally a launch blocker, but it touches every initdb file and
> every service's boot path. Mixing it with a security change makes both un-reviewable. It is wave 2
> and it starts the moment wave 1 is merged.

## §2 Non-negotiable constraints

| Rule | Applies here as |
|:---|:---|
| AGENTS.md §0 | Still 100% local. No CI, no cloud, no new network dependency. |
| AGENTS.md §3 [ERR-128] | The new media endpoint is a resource controller — `AssetController` under `/api/v1/assets`. **Not** `MediaProxyController`, not `DownloadController`, not anything named after a flow. |
| AGENTS.md §3 [ERR-129] | Its collaborator is `AssetService` in `application/service`. No `*Manager`, `*Handler`, `*Resolver` doing I/O. |
| AGENTS.md §4 [ERR-127] | Path containment is a method on the value object that owns the path, not a `PathUtil.isSafe(...)`. |
| AGENTS.md §4 | Blocking file I/O on virtual threads. Stream the file; never load a video into a `byte[]`. |
| AGENTS.md §11 | No secret literal in any committed file. |
| ERR-103 | One top-level type per `.java` file **+ one mirroring test file**. |
| **Behaviour preservation** | This wave changes *who may call*, never *what is computed*. If a test that asserts business behaviour has to change, you have gone too far — stop and report. |

## §3 File manifest — wave 1

```
# ── #1 media access ────────────────────────────────────────────────────────
CREATE  orazaka-apps/services/orazaka-conversation-service/.../adapter/rest/AssetController.java
CREATE  .../application/service/AssetService.java
CREATE  .../domain/model/asset/AssetRef.java              (owner + jobId + filename, self-validating)
MODIFY  .../infrastructure/config/SecurityConfig.java     (drop the /uploads/** permitAll)
MODIFY  .../infrastructure/config/WebMvcConfig.java       (drop addResourceHandlers + its CORS mapping)
MODIFY  .../infrastructure/support/MediaFileStore.java    (containment check; x2 — job-service too)
MODIFY  orazaka-apps/ui/orazaka-web-client/src/app/uploads/[...path]/route.ts
MODIFY  orazaka-apps/ui/orazaka-web-client/src/services/media.api.ts   (new URL shape)
CREATE  .../src/test/java/.../AssetControllerIT.java      (the IDOR test — see §5)

# ── #3 internal surface ────────────────────────────────────────────────────
MODIFY  krizaka/krizaka-billing/krizaka-billing-service/.../config/SecurityConfig.java
MODIFY  orazaka-apps/services/orazaka-studio/orazaka-studio-service/.../config/SecurityConfig.java
MODIFY  krizaka/krizaka-users/krizaka-users-service/.../config/SecurityConfig.java
MODIFY  krizaka/krizaka-billing/krizaka-billing-client/.../HttpCreditAuthorizationClient.java  (send the M2M token)
MODIFY  krizaka/krizaka-billing/krizaka-billing-client/.../HttpEntitlementProvider.java
MODIFY  orazaka-apps/services/orazaka-studio/orazaka-studio-client/.../<the HTTP adapter>
CREATE  <per service> src/test/java/.../InternalSurfaceAuthIT.java

# ── #4 job-service ─────────────────────────────────────────────────────────
MODIFY  orazaka-apps/services/orazaka-job-service/.../config/SecurityConfig.java

# ── #5 secrets ─────────────────────────────────────────────────────────────
MODIFY  infra/initdb/{10-identity,40-knowledge,50-automation,70-billing,80-studio}.sql
MODIFY  infra/docker-compose.yml                          (pass the role passwords in)
MODIFY  .env / exemple.env.txt                            (ORAZAKA_<CTX>_DB_PASSWORD, CHANGE_ME)
MODIFY  orazaka-apps/ui/orazaka-cli/src/commands/start.command.ts  (feed psql the variables)

# ── the fitness functions that stop all of this recurring ──────────────────
MODIFY  orazaka-libs/orazaka-build/orazaka-test-support/.../architecture/GovernanceRules.java
MODIFY  <8 services> src/test/java/.../<Service>GovernanceTest.java
```

## §4 The fixes, specified

### §4.1 — Finding #1: authenticated, owner-scoped asset access

**Delete the public surface first**, so the new one cannot be silently bypassed:
- `SecurityConfig.java:139` — remove `.requestMatchers("/uploads/**").permitAll()`.
- `WebMvcConfig.addResourceHandlers` — remove entirely, and the `/uploads/**` CORS mapping with it.
  Serving a tenant's disk through a static handler is the defect; hardening it is not the fix.

**Then add the controller.** `GET /api/v1/assets/{jobId}/{filename}`:

1. Read the actor from the JWT principal — never from a path segment, never from a header.
2. `jobPersistenceProvider.getJob(jobId)` → if absent, or if `job.userId()` ≠ actor,
   **return `404`, not `403`**. A `403` confirms the resource exists and turns the endpoint into an
   enumeration oracle.
3. Build the path from `(job.userId(), jobId, filename)` — the **stored** owner, not the request.
4. Assert containment before opening the stream: `resolved.normalize().startsWith(root.normalize())`.
   That assertion lives on `AssetRef`, not in a helper (ERR-127).
5. Stream with `ResourceRegion` / `InputStreamResource` so `Range` works — the run detail plays MP4s.
   Do **not** read the file into a `byte[]`.
6. `Cache-Control: private, no-store`. Authenticated media must never enter a shared cache.
7. Admins (`ROLE_ADMIN`) may read any asset — the jobs dashboard needs it — via an explicit
   `@PreAuthorize` branch, logged. Do not widen the ownership check to achieve it.

**BFF** (`uploads/[...path]/route.ts`): forward the **real session JWT** (`token.accessToken`, the
HS256 session token every backend already validates), not `Bearer ${userId}`. Rewrite the target to
the new `/api/v1/assets/...` shape. Delete the path-segment pass-through: the BFF no longer decides
who owns what — it cannot, and today it pretends to.

**`MediaFileStore.save`** (both copies): add the same containment assertion before `Files.write`. It
is not currently exploitable — the filenames are literals — but it is a *write* primitive and the
check is one line.

### §4.2 — Finding #3: authenticate the internal surface

**Read this before touching the configs.** The authorities converter in billing and studio is
configured `setAuthoritiesClaimName("roles")` with `setAuthorityPrefix("")`. Authorities are
therefore the **raw values of the `roles` claim**, with no `SCOPE_`/`ROLE_` prefix added. A naive
`.hasAuthority("SCOPE_internal")` will fail closed against a correct token and you will "fix" it by
weakening the matcher. Do not.

Decide once, write it in the ADR, apply everywhere: the M2M token carries `roles: ["SERVICE"]`, and
the rule is `.requestMatchers("/internal/v1/**").hasAuthority("SERVICE")`.

- Replace `permitAll()` with that matcher in billing, studio and identity.
- The callers — `krizaka-billing-client`, `orazaka-studio-client` — must mint and attach the M2M
  token. The issuing machinery exists (`M2mJwtProperties`, `ApiKeyExchangeFilter`); reuse it, do not
  write a second one.
- Keep the edge's non-routing of `/internal/**` as the **second** layer. Two layers, not one.
- Verify `SubscriptionChangeListener` and the outbox relays still reach what they need — they consume
  AMQP, not HTTP, so they should be unaffected. Confirm rather than assume.

### §4.3 — Finding #4: job-service

`.anyRequest().permitAll()` → `.anyRequest().authenticated()`, with
`/actuator/health`, `/actuator/info`, `/error` and `OPTIONS /**` explicitly permitted. Copy the
billing service's chain verbatim; it is already correct. If the service turns out to have no
authenticated caller at all, that is an argument for deleting its web server, not for opening it.

### §4.4 — Finding #5: role passwords out of git

Each initdb file: `CREATE ROLE orazaka_<ctx> LOGIN PASSWORD :'<ctx>_password';` — a psql variable,
never a literal. Feed the variables from the environment at apply time; `exemple.env.txt` carries
`CHANGE_ME`, `.env` carries the dev value. Rotate the dev passwords in the same commit: the old ones
stay in git history forever, so treat them as burned.

### §4.5 — The fitness functions

Fixing four configs is worth little if the fifth service reintroduces the pattern. Add both:

1. **`GovernanceRules.assertNoPermitAllOnInternalOrUploads(JavaClasses, String basePackage)`** —
   scans `SecurityConfig` source for `permitAll` applied to a matcher containing `/internal` or
   `/uploads`, and fails. Wire it into all eight `<Service>GovernanceTest`s.
2. **`InternalSurfaceAuthIT` per service** — a Testcontainers/`@SpringBootTest` case asserting that
   an unauthenticated `POST /internal/v1/**` returns `401`, and that a token without the `SERVICE`
   authority returns `403`.
3. **`AssetControllerIT`** — actor B requests actor A's asset ⇒ **`404`**; actor A requests their own
   ⇒ `200` with the right bytes; anonymous ⇒ `401`. This is the test whose absence let finding #1
   live, and it is the single most valuable file in this wave.

## §5 Acceptance gate — run these, in order

```bash
# 1. Everything compiles and the full suite passes — including the three new IT classes
./mvnw -q verify

# 2. Every governance suite, including the two new rules
./mvnw -q test -Dtest='*GovernanceTest'

# 3. The data seam rule still holds after the initdb edits
./mvnw -q -pl orazaka-libs/orazaka-ai-engine/orazaka-persistence-app -Dtest=SqlBoundaryTest test

# 4. The stack comes up with env-sourced role passwords
orazaka stop --purge && orazaka start && orazaka dev

# 5. #1 — the public path is gone, the authenticated one works
curl -i http://localhost:8088/uploads/<any-user>/<any-job>/output/image.png   # expect 401 or 404, NOT 200
curl -i -H "Authorization: Bearer $TOKEN_A" http://localhost:8088/api/v1/assets/<jobA>/image.png  # 200
curl -i -H "Authorization: Bearer $TOKEN_B" http://localhost:8088/api/v1/assets/<jobA>/image.png  # 404

# 6. #3 — the internal surface refuses an anonymous caller
curl -i -X POST http://localhost:8095/internal/v1/credits/hold -d '{}'        # expect 401
curl -i -X POST http://localhost:8096/internal/v1/studios/runs/x/steps/y/callback  # expect 401

# 7. #4 — job-service refuses an anonymous caller but still reports health
curl -i http://localhost:8090/actuator/health                                  # 200
curl -i http://localhost:8090/api/v1/anything                                  # 401

# 8. #5 — no password literal survives
grep -rn "PASSWORD '" infra/                                                   # expect no match

# 9. Nothing regressed: the full end-to-end loop still runs
orazaka test e2e
```

Wave 1 is done when **all nine** pass. Steps 5–7 failing to return `200` is the **success**
condition; if any of them still serves content, the fix is incomplete.

## §6 Do NOT

- **Do not** start Flyway, the service-kit extraction, or any other wave in this run.
- **Do not** "fix" a failing authority matcher by loosening it — read §4.2 again.
- **Do not** return `403` where the audit asks for `404`. Enumeration is the attack.
- **Do not** keep a `permitAll()` on `/uploads/**` "temporarily" behind a feature flag.
- **Do not** load media into memory to make `Range` easier.
- **Do not** change business behaviour. If a behavioural test needs editing, stop and report.
- **Do not** touch the user's uncommitted working-tree changes.
- **Do not** commit or push — the user reviews the diff and commits.
- **Do not** modify `docs/_generated/*` by hand.

## §7 Before declaring done

1. Run the `.agent/workflows/review_architect.md` gate.
2. `initdb`, `.env` and interfaces changed ⇒ run `.agent/workflows/sync_documentation.md`.
3. Write **`docs/adr/ADR-035-service-to-service-authentication.md`**: the `/internal/v1` decision, the
   `roles: ["SERVICE"]` claim convention, why network-topology isolation was insufficient, and why
   mTLS is deferred rather than rejected. A security posture that lives only in a `SecurityConfig`
   diff is a posture that erodes.
4. Update `docs/PRODUCTION_READINESS_AUDIT.md` §6: mark #1, #3, #4, #5 closed with the commit ref.
   Do not delete the rows — a closed finding is evidence.
5. Report: files created/modified, the nine gate results verbatim, and **any place where the audit's
   prescription turned out to be wrong**. A wrong prescription is an audit bug to fix in the
   document, not a detail to absorb silently.

## §8 Next waves (do not start without an explicit go)

Per audit §7. Each wave ends green and is a valid recovery checkpoint.

- **Wave 2 — operability (also blocks launch).** Flyway baseline per context with seeds out of `V*`
  and `clean-disabled: true`; `SqlBoundaryRules` extended to `db/migration/**`; managed Postgres with
  PITR **and a performed restore drill**; RabbitMQ quorum queues; edge read timeout + circuit
  breaker; `RateLimitFilter` on identity, billing and studio; `PathResolver`'s walk-up deleted in
  favour of a required absolute upload root.
- **Wave 3 — structure (before the next feature).** `orazaka-libs/orazaka-service-kit` (Tier-2);
  `JobCommand` into a Tier-1 `orazaka-jobs-api`; repository ports extracted out of
  `application/service` starting with `RunSagaService` and `CreditLedgerService`;
  `RunSagaService` split into five collaborators; rule
  `assertNoPersistenceApiInApplicationLayer` wired into all eight suites.
- **Wave 4 — hardening (before scale).** Encryption at rest and the `RunScope.toString()` secret
  assertion; exact-id asset resolution; the `.tsx` registry exemption decided and written down;
  load-test the studio fan-out against the real MLX budget and recalibrate the pricebook from
  measurement; read replicas for the analytics services.
