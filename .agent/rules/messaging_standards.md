# Rule: Messaging Standards (RabbitMQ)

> RabbitMQ is the **decoupling buffer** between the synchronous path and heavy work. See `AGENTS.md` §6 and `docs/INTERFACES.md` §9.

## §1 Producers / consumers
- **Producers**: `router` (async jobs → `202 + jobId`), `business`/`core` (heavy commands), write-side via `EventPublisher` (**transactional outbox**).
- **Consumers (only)**: `worker` (`JobConsumer`), `router` (`JobEventRelay` → SSE relay), `business` (`WorkflowEventConsumer` → saga).
- **Banned**: calling a worker directly (producer/consumer coupling). Always go through the broker.

## §2 Transactional outbox
- Domain events are written to the `outbox` table **in the same transaction** as the aggregate, then relayed. No dual-write, no lost event.
- The AMQP adapter is package-private in `persistence-app`; the `EventPublisher` port is defined on the core side (outbound).

## §3 Conventions
- Exchanges (topic): `orazaka.jobs`, `orazaka.events`.
- Routing keys: `job.{capability}.{action}` · `evt.{aggregate}.{type}`.
- Job events: `job.{jobId}.progress|done|error`.
- **DLQ**: `<queue>.dlq`; exponential retry; consumer **idempotency** by `messageId`.

## §4 Sync vs async
- *Broker* = heavy / deferred / event-driven. *Synchronous* = low-latency interactive.
- **Banned**: routing an interactive chat stream through the broker. Token-by-token streaming stays **synchronous SSE** (virtual thread).
