---
title: Tools & MCP
description: What tools are in Orazaka — function calling, MCP servers, tool caching and the write sandbox — extracted from orazaka-tools and the tool interceptor.
category: Core
order: 6
generated: true
---

# Tools & MCP

> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. Run `orazaka docs build` to refresh.

In Orazaka a **tool** is a function a model may call during a turn (Spring AI function calling).
`orazaka-tools` (repository `orazaka-ai-engine`) holds the tool registry, the bridge to external MCP servers, the
tool result cache and the sandbox that isolates tools which write. Tools are attached to a turn by the
`ToolInterceptor` of the pipeline (see the [interceptor registry](INTERCEPTORS.md)) — a model only sees the
tools the turn needs.

## Registered tools

| Tool | Description | Input | Fields |
|:---|:---|:---|:---|
| `analyzePoster` | Analyzes a movie poster provided as a base64 encoded string using vision model. | `AnalyzePosterRequest` | `posterBase64`, `prompt` |
| `analyzeAudioExtract` | Analyzes a film audio extract to check for specific compliance or content criteria. | `AnalyzeAudioExtractRequest` | `clipPath`, `checkType` |
| `searchWeb` | Queries the corporate RAG database for real-time web search results. | `SearchWebRequest` | `query` |

`searchWeb` searches the sources the knowledge service holds for the signed-in user. `analyzePoster` and
`analyzeAudioExtract` are reference tools: they demonstrate the contract and return a fixed analysis.

## When a tool is attached

- Never on a streaming turn, nor for a vision model (model name containing `vision`, `llava`, `bakllava`).
- `analyzePoster` only when the turn mentions `poster`, `image`, `visual`, `picture`.
- `analyzeAudioExtract` only when the turn mentions `audio`, `clip`, `voice`, `music`, `sound`.
- Every other registered tool is offered on every eligible turn.

## Configuration in the database

Tools are configured per deployment, in data: no redeploy to cache a tool or to add an MCP server. A tool
whose `platform_tool_configs` row enables caching is wrapped in `CachingToolCallback`: the same input returns
the stored result for `cache_ttl_seconds`, kept in memory (Caffeine) and in `orazaka_tools_cache` (PostgreSQL).
Static defaults live under `orazaka.tools` in `application.yml`.

### `platform_tool_configs`

| Column | Type |
|:---|:---|
| `id` | `SERIAL PRIMARY KEY` |
| `tool_id` | `VARCHAR(255) NOT NULL UNIQUE` |
| `cache_enabled` | `BOOLEAN DEFAULT TRUE` |
| `cache_ttl_seconds` | `INT DEFAULT 3600` |
| `rag_enabled` | `BOOLEAN DEFAULT TRUE` |
| `chunker_type` | `VARCHAR(100) DEFAULT 'MARKDOWN_CHUNKERS'` |
| `source_table` | `VARCHAR(255) DEFAULT 'orazaka_tools_rag_source'` |
| `created_at` | `TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP` |

### `platform_mcp_servers`

| Column | Type |
|:---|:---|
| `id` | `SERIAL PRIMARY KEY` |
| `label` | `VARCHAR(255) NOT NULL` |
| `transport_type` | `VARCHAR(50) NOT NULL` |
| `url` | `VARCHAR(1000)` |
| `command` | `VARCHAR(1000)` |
| `args` | `VARCHAR(2000)` |
| `auth_token` | `VARCHAR(1000)` |
| `enabled` | `BOOLEAN DEFAULT TRUE` |
| `created_at` | `TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP` |

### `user_mcp_servers`

| Column | Type |
|:---|:---|
| `id` | `SERIAL PRIMARY KEY` |
| `user_id` | `VARCHAR(255) NOT NULL` |
| `label` | `VARCHAR(255) NOT NULL` |
| `url` | `VARCHAR(1000) NOT NULL` |
| `auth_token` | `VARCHAR(1000)` |
| `enabled` | `BOOLEAN DEFAULT TRUE` |
| `created_at` | `TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP` |

### `orazaka_tools_cache`

| Column | Type |
|:---|:---|
| `tool_id` | `VARCHAR(255) NOT NULL` |
| `cache_key` | `TEXT NOT NULL` |
| `cache_value` | `TEXT NOT NULL` |
| `created_at` | `TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP` |
| `expires_at` | `TIMESTAMP WITH TIME ZONE NOT NULL` |

Seeded tool configuration: `searchWeb`.

## MCP servers

Orazaka is an MCP **client**: before a turn, `DefaultMcpOrchestrator` queries every enabled `REMOTE` platform
server and the user's own servers in parallel (one virtual thread each) and adds what they return to the
context.
Platform servers are declared by an administrator; each user may add private ones.

| Method | Path | Access | Summary |
|:---|:---|:---|:---|
| GET | `/api/v1/mcp/servers/platform` | ADMIN | — |
| POST | `/api/v1/mcp/servers/platform` | ADMIN | — |
| DELETE | `/api/v1/mcp/servers/platform/{id}` | ADMIN | — |
| GET | `/api/v1/mcp/servers/user` | authenticated | — |
| POST | `/api/v1/mcp/servers/user` | authenticated | — |
| DELETE | `/api/v1/mcp/servers/user/{id}` | authenticated | — |
| GET | `/api/v1/mcp/tools` | authenticated | Retrieves all registered tools and their schemas. |
| POST | `/api/v1/mcp/tools/{name}/execute` | authenticated | Executes a tool by name with the provided arguments. |

From the terminal ([CLI reference](CLI.md)):

```bash
orazaka mcp list                  # List your registered private MCP servers
orazaka mcp register              # Register a new private MCP server
orazaka mcp delete <id>           # Delete a private MCP server by ID
```

## The write sandbox

Marker annotation for MCP tools that perform write operations. Methods annotated with `@McpWriteTool` are intercepted by the `SandboxAspect`, which diverts all write operations into an in-memory Jimfs FileSystem isolated by `jobId`. The sandbox must be explicitly committed (flushing bytes to real storage) or rolled back (evicting context).

| Property | Meaning |
|:---|:---|
| `orazaka.tools.sandbox.max-bytes-per-job` | Maximum bytes a single jobId sandbox can allocate (default: 256 MB). |
| `orazaka.tools.sandbox.eviction-ttl-seconds` | TTL in seconds before orphaned sandboxes are pruned (default: 300). |
