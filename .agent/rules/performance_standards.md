# Rule: Performance Standards

## §1 Caching & State
- Catalog updates must evict `CatalogModelManager` Caffeine cache.
- Config toggles must evict `GraphEngine` cache.
- Banned: caching user security context, permissions, or raw tokens.

## §2 Database
- Banned: N+1 queries, duplicate DB reads in one tx, read-before-write.
- Relationships: Load via `LEFT JOIN FETCH` or `@EntityGraph`.
- Transactions: `@Transactional(readOnly = true)` on reads. Minimize write tx blocks.
- Indexes: Required B-tree indexes on `user_id`, `session_id`, `created_at`.

## §3 Concurrency & Limits
- Virtual Threads: Required for blocking operations, network, and DB. Banned: `synchronized` over I/O.
- Streaming: Must use `Flux<ChatResponse>` or SSE. Banned: buffered payloads or simulated delays.
- History: 50-message FIFO sliding window.
- Caps: Base64 media inputs <= 10MB; GraphQL query depth <= 5.

## §4 Frontend
- Optimize: Use Next.js `<Image>`.
- Hydration: Render loading skeletons for async fetches.
- Inputs: 300ms debounce loop on search/filters.
