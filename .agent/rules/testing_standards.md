# Rule: Testing Standards (local)

> Local phase: no CI, no deployed environments. **Hermetic E2E** is the quality gate. See `AGENTS.md` §9.

## §1 Pyramid
- **unit**: pure logic, mappers, self-validating records. No external dependency. 1 test file per type (`[ERR-103]`).
- **integration**: adapters/repos via **Testcontainers**. Extend `AbstractContainerIntegrationTest` (PostgreSQL + Redis + RabbitMQ bootstrapped **once per JVM**, reused singleton). Dynamic ports via `@DynamicPropertySource` (ADR-033/034).
- **hermetic E2E**: `orazaka-end2end`, end-to-end journeys on throwaway infra (seed). Command: `orazaka test e2e`.

## §2 ArchUnit (mandatory gate)
- `GovernanceTest` validates the ring rules on every build.
- Pre-commit: `./mvnw test -pl orazaka-libs/orazaka-ai-engine/orazaka-core -Dtest=GovernanceTest`.
- Any hexagonal boundary violation (forbidden imports, `.md` in `core/resources/prompts`, etc.) must fail this test.

## §3 Discipline
- Every new port → a contract test. Every new adapter → a Testcontainers integration test.
- Banned: tests depending on the public network or a cloud service (incompatible with the local phase).
- AMQP consumer idempotency: covered by a test replaying the same `messageId`.
