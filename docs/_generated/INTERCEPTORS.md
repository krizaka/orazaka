---
title: Interceptor Registry
description: Cross-cutting pipeline interceptors and their DB-driven order.
category: Core
order: 5
generated: true
---

# Interceptor Registry

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

| Order | Interceptor | Concern | Enabled |
|:--|:---|:---|:--|
| core 1 | `SafetyInterceptor` | validation | 🔒 non-bypassable |
| core 2 | `ScopeGuardInterceptor` | governance | 🔒 non-bypassable |
| core 3 | `UserContextResolver` | context | 🔒 non-bypassable |
| core 4 | `SystemContextInjector` | context | 🔒 non-bypassable |
| core 5 | `RagInterceptor` | enrichment | 🔒 non-bypassable |
| 4 | `EntitlementInterceptor` | governance | ✅ |
| 5 | `McpInterceptor` | enrichment | ✅ |
| 6 | `BrandContextInterceptor` | enrichment | ✅ |
| 7 | `MemoryInterceptor` | enrichment | ✅ |
| 8 | `RefinerInterceptor` | reformulation | ✅ |
| 9 | `RouterInterceptor` | reformulation | ✅ |
| 9 | `ToolInterceptor` | tooling | ✅ |
| 11 | `UserContextInterceptor` | context | ✅ |
| — | `ClosedLoopValidationInterceptor` | validation | — |
| — | `CostShieldInterceptor` | validation | — |
| — | `DynamicMemoryCondenser` | enrichment | — |
| — | `HybridRagResolver` | enrichment | — |
| — | `LanguageAlignmentInterceptor` | translation | — |
| — | `SemanticRouterInterceptor` | reformulation | — |
