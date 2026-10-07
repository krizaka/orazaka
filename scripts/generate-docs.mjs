#!/usr/bin/env node
/**
 * Generates the code-derived documentation set under docs/_generated/ — the single source for
 * everything that describes *what the code is* (never hand-edited). Curated design docs
 * (AGENTS.md, VISION_ARCHITECTURE.md, INTERFACES.md, DEVEX_LIFECYCLE.md, adr/, guides) stay
 * hand-authored; this generator owns only docs/_generated/.
 *
 * Produces, by scanning the repo:
 *   - architecture.json   modules / dependencies / ports / pipeline / messaging
 *   - ARCHITECTURE.md     module map, dependency edges, interceptor pipeline, messaging
 *   - INTERFACE_CONTRACTS.md  inbound/outbound port contracts per module
 *     (named distinctly from the curated docs/INTERFACES.md design contract)
 *   - USE_CASES.md        UseCase catalog (App Factory)
 *   - INTERCEPTORS.md     interceptor registry + DB-driven order
 *   - API_REFERENCE.md    router REST endpoints
 *   - CLI.md              orazaka CLI commands
 *   - MODELS.md           AI model catalog (from infra/initdb seed)
 *   - ADRS.md             ADR ledger (files + code citations)
 *   - REPOSITORIES.md     repository map (from orazaka.workspace.json)
 *
 * Output is deterministic (no timestamps) so `--check` is a pure staleness diff.
 *
 * Usage:
 *   node scripts/generate-docs.mjs           regenerate docs/_generated/
 *   node scripts/generate-docs.mjs --check   fail (exit 1) if any output is stale
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";

const ROOT = process.cwd();
const GEN_DIR = join(ROOT, "docs", "_generated");
const CHECK = process.argv.includes("--check");

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/**
 * The workspace manifest: every repository of the platform and where it is cloned. Docs are built
 * from the code of all of them, so the generator runs from the workspace root (AGENTS.md §10).
 */
const WORKSPACE = JSON.parse(read(join(ROOT, "orazaka.workspace.json")) || '{"repositories":[]}');
const REPOSITORIES = WORKSPACE.repositories;

/** The repository a workspace path belongs to (longest matching path prefix). */
const repositoryOf = (relPath) =>
  REPOSITORIES.filter((r) => relPath === r.path || relPath.startsWith(r.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0]?.name ?? WORKSPACE.umbrella ?? null;

/**
 * Concatenated DB bootstrap in execution (alphabetical) order. Each context's file lives in the
 * repository that owns it (<repo>/infra/initdb); the workspace keeps the reset and dev fixtures.
 */
const readInitDb = () => {
  const dirs = [join(ROOT, "infra", "initdb"), ...REPOSITORIES.map((r) => join(ROOT, r.path, "infra", "initdb"))];
  const files = [];
  for (const dir of dirs.filter((d) => existsSync(d))) {
    for (const n of readdirSync(dir).filter((x) => x.endsWith(".sql"))) files.push({ n, p: join(dir, n) });
  }
  return files
    .sort((a, b) => a.n.localeCompare(b.n))
    .map((f) => read(f.p))
    .join("\n");
};

/** Recursively list files matching a predicate. */
function walk(dir, pred) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "target" || name === ".git") continue;
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, pred));
    else if (pred(p)) out.push(p);
  }
  return out;
}
const javaFiles = (dir) => walk(dir, (p) => p.endsWith(".java"));

/** artifactId → module directory, for every Maven module of every cloned repository. */
const MODULES = (() => {
  const index = new Map();
  for (const repo of REPOSITORIES.filter((r) => r.kind === "maven")) {
    const repoDir = join(ROOT, repo.path);
    const candidates = [repoDir, ...(existsSync(repoDir) ? readdirSync(repoDir).map((n) => join(repoDir, n)) : [])];
    for (const dir of candidates) {
      const pom = read(join(dir, "pom.xml"));
      const own = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").match(/<artifactId>([\w-]+)<\/artifactId>/);
      if (own && !/<packaging>pom<\/packaging>/.test(pom)) index.set(own[1], dir);
    }
  }
  return index;
})();

function frontmatter(title, description, category, order) {
  return [
    "---",
    `title: ${title}`,
    `description: ${description}`,
    `category: ${category}`,
    `order: ${order}`,
    "generated: true",
    "---",
    "",
    `# ${title}`,
    "",
    "> 🤖 **Generated from code** by `scripts/generate-docs.mjs` — do not hand-edit. " +
      "Run `orazaka docs build` to refresh.",
    "",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

/** Port interface names under a relative ports dir (1 type per file, AGENTS ERR-103). */
function portsIn(moduleDir, relPortDir) {
  const javaSrcDir = join(moduleDir, "src/main/java");
  if (!existsSync(javaSrcDir)) return [];
  return javaFiles(javaSrcDir)
    .filter((f) => f.replaceAll("\\", "/").includes(relPortDir))
    .filter((f) => /\b(?:public\s+)?interface\s+\w+/.test(read(f)))
    .map((f) => basename(f, ".java"))
    .sort();
}

function extractArchitecture() {
  const moduleDefs = [
    // Framework
    { id: "orazaka-persistence-app", path: "orazaka-libs/orazaka-ai-engine/orazaka-persistence-app", layer: "framework", type: "maven" },
    { id: "orazaka-persistence-identity", path: "orazaka-apps/services/orazaka-users/orazaka-persistence-identity", layer: "framework", type: "maven" },
    { id: "orazaka-core", path: "orazaka-libs/orazaka-ai-engine/orazaka-core", layer: "framework", type: "maven" },
    { id: "orazaka-interceptors", path: "orazaka-libs/orazaka-ai-engine/orazaka-interceptors", layer: "framework", type: "maven" },
    { id: "orazaka-business", path: "orazaka-libs/orazaka-ai-engine/orazaka-business", layer: "framework", type: "maven" },
    { id: "orazaka-identity", path: "orazaka-apps/services/orazaka-users/orazaka-identity", layer: "framework", type: "maven" },
    { id: "orazaka-tools", path: "orazaka-libs/orazaka-ai-engine/orazaka-tools", layer: "framework", type: "maven" },
    { id: "orazaka-billing-client", path: "orazaka-apps/services/orazaka-billing/orazaka-billing-client", layer: "framework", type: "maven" },
    { id: "orazaka-studio-client", path: "orazaka-apps/services/orazaka-studio/orazaka-studio-client", layer: "framework", type: "maven" },

    // Apps & Workers
    { id: "orazaka-conversation-service", path: "orazaka-apps/services/orazaka-conversation-service", layer: "app", type: "maven" },
    { id: "orazaka-edge", path: "orazaka-apps/services/orazaka-edge", layer: "app", type: "maven" },
    { id: "orazaka-identity-service", path: "orazaka-apps/services/orazaka-users/orazaka-identity-service", layer: "app", type: "maven" },
    { id: "orazaka-automation-service", path: "orazaka-apps/services/orazaka-automation-service", layer: "app", type: "maven" },
    { id: "orazaka-knowledge-service", path: "orazaka-apps/services/orazaka-knowledge-service", layer: "app", type: "maven" },
    { id: "orazaka-job-service", path: "orazaka-apps/services/orazaka-job-service", layer: "app", type: "maven" },
    { id: "orazaka-billing-service", path: "orazaka-apps/services/orazaka-billing/orazaka-billing-service", layer: "app", type: "maven" },
    { id: "orazaka-studio-service", path: "orazaka-apps/services/orazaka-studio/orazaka-studio-service", layer: "app", type: "maven" },
    { id: "orazaka-notification-service", path: "orazaka-apps/services/orazaka-notifications/orazaka-notification-service", layer: "app", type: "maven" },
    { id: "orazaka-worker-media", path: "orazaka-apps/workers/orazaka-worker-media", layer: "app", type: "python" },
    
    // UI clients
    { id: "orazaka-web-client", path: "orazaka-apps/ui/orazaka-web-client", layer: "app", type: "ui" },
    { id: "orazaka-web-admin", path: "orazaka-apps/ui/orazaka-web-admin", layer: "app", type: "ui" },
    { id: "orazaka-mobile-client", path: "orazaka-apps/ui/orazaka-mobile-client", layer: "app", type: "ui" },
    { id: "orazaka-cli", path: "orazaka-apps/ui/orazaka-cli", layer: "app", type: "ui" }
  ];

  const modules = [];
  const dependencies = [];

  for (const m of moduleDefs) {
    const moduleDir = join(ROOT, m.path);
    let inbound = [];
    let outbound = [];

    if (m.type === "maven") {
      const pomPath = join(moduleDir, "pom.xml");
      // The <parent> is the repository's aggregator (or orazaka-parent), never a dependency.
      const pom = read(pomPath).replace(/<parent>[\s\S]*?<\/parent>/, "");
      for (const dep of pom.matchAll(/<artifactId>(orazaka-[\w-]+)<\/artifactId>/g)) {
        const to = dep[1];
        if (
          to !== m.id &&
          to !== "orazaka-parent" &&
          to !== "orazaka-test-support" &&
          to !== "orazaka-end2end" &&
          to !== "orazaka-persistence" &&
          to !== "orazaka-workers" &&
          !dependencies.some((e) => e.from === m.id && e.to === to)
        ) {
          dependencies.push({ from: m.id, to });
        }
      }
      inbound = portsIn(moduleDir, "/domain/ports/inbound/");
      outbound = portsIn(moduleDir, "/domain/ports/outbound/");
    }

    modules.push({
      id: m.id,
      path: m.path,
      repository: repositoryOf(m.path),
      layer: m.layer,
      ports: { inbound, outbound }
    });
  }

  // Add UI apps and Python worker manual dependencies representing real operational flow
  const manualDeps = [
    { from: "orazaka-web-client", to: "orazaka-conversation-service" },
    { from: "orazaka-web-admin", to: "orazaka-conversation-service" },
    { from: "orazaka-mobile-client", to: "orazaka-conversation-service" },
    { from: "orazaka-cli", to: "orazaka-conversation-service" },
    { from: "orazaka-conversation-service", to: "orazaka-worker-media" },
    { from: "orazaka-worker-media", to: "orazaka-persistence-app" }
  ];

  for (const d of manualDeps) {
    if (!dependencies.some((e) => e.from === d.from && e.to === d.to)) {
      dependencies.push(d);
    }
  }

  const initSql = readInitDb();
  const pipeline = [...initSql.matchAll(/\('(\w+)',\s*'[^']+',\s*(\d+),\s*(TRUE|FALSE),\s*'[^']*'\)/g)]
    .map((m) => ({ interceptor: m[1], order: Number(m[2]), enabled: m[3] === "TRUE" }))
    .sort((a, b) => a.order - b.order);

  const messaging = extractMessaging(moduleDefs);

  // The repository map (orazaka.workspace.json): which GitHub repository holds what, in build order.
  const repositories = REPOSITORIES.map((r) => ({
    name: r.name,
    url: `https://github.com/${WORKSPACE.org}/${r.name}`,
    path: r.path,
    kind: r.kind,
    layer: r.layer,
    description: r.description,
    dependsOn: r.dependsOn,
  }));

  return { product: "orazaka", source: "generated from code by scripts/generate-docs.mjs — do not hand-edit", repositories, modules, dependencies, pipeline, messaging };
}

/**
 * Real AMQP inventory (Phase 0 fitness function): resolves the topology constants
 * (MessagingContract + the worker's AmqpConstants copy), then scans every module's
 * Java sources for @RabbitListener consumers and convertAndSend / OutboxMessage
 * producers (plus the Python media worker's telemetry publisher). docs build --check
 * turns topology drift into a build failure.
 */
function extractMessaging(moduleDefs) {
  const contractFiles = [
    join(ROOT, "orazaka-libs/orazaka-ai-engine/orazaka-persistence-app/src/main/java/com/orazaka/persistence/infrastructure/config/MessagingContract.java"),
    join(ROOT, "orazaka-apps/services/orazaka-automation-service/src/main/java/com/orazaka/automationservice/infrastructure/config/AmqpConstants.java"),
    join(ROOT, "orazaka-apps/services/orazaka-notifications/orazaka-notification-api/src/main/java/com/orazaka/notification/domain/model/NotificationRouting.java"),
    join(ROOT, "orazaka-apps/services/orazaka-notifications/orazaka-notification-service/src/main/java/com/orazaka/notificationservice/infrastructure/config/AmqpConstants.java"),
  ];
  const constants = new Map();
  for (const f of contractFiles) {
    for (const m of read(f).matchAll(/String\s+(\w+)\s*=\s*"([^"]+)"/g)) constants.set(m[1], m[2]);
  }
  for (const f of contractFiles) {
    for (const m of read(f).matchAll(/String\s+(\w+)\s*=\s*(\w+)\s*\+\s*"([^"]+)"/g)) {
      if (constants.has(m[2])) constants.set(m[1], constants.get(m[2]) + m[3]);
    }
    // A constant that IS another constant — `JOBS_BATCH_BINDING = JOB_MEDIA_GENERATE` (ADR-067).
    // Without this the lanes documented themselves as binding nothing, which is the drift §10 of
    // AGENTS.md exists to refuse: a generated model that is quietly wrong is worse than none.
    // Qualified as well — `REQUESTS_BINDING = NotificationRouting.NOTIFICATION_REQUESTED` names the
    // contract's constant rather than copying its value.
    for (const m of read(f).matchAll(/String\s+(\w+)\s*=\s*([\w.]+)\s*;/g)) {
      const ref = m[2].split(".").pop();
      if (constants.has(ref) && !constants.has(m[1])) constants.set(m[1], constants.get(ref));
    }
  }
  const resolveToken = (raw, local = constants) => {
    const token = raw.trim();
    const lit = token.match(/^"([^"]+)"$/);
    if (lit) return lit[1];
    // CONSTANT or Type.CONSTANT, optionally "+ expr" (user-scoped suffix → {…})
    const concat = token.match(/^([\w.]+)\s*\+\s*.+$/);
    if (concat) {
      const base = local.get(concat[1].split(".").pop());
      return base ? base + "{…}" : null;
    }
    return local.get(token.split(".").pop()) ?? null;
  };

  /** File-local String constants/variables layered over the shared contract constants. */
  const localConstants = (src) => {
    const local = new Map(constants);
    for (const m of src.matchAll(/String\s+(\w+)\s*=\s*"([^"]+)"/g)) local.set(m[1], m[2]);
    for (const m of src.matchAll(/String\s+(\w+)\s*=\s*([\w.]+)\s*;/g)) {
      const v = local.get(m[2].split(".").pop());
      if (v) local.set(m[1], v);
    }
    for (const m of src.matchAll(/String\s+(\w+)\s*=\s*([\w.]+)\s*\+\s*[\w.()]+\s*;/g)) {
      const base = local.get(m[2].split(".").pop());
      if (base) local.set(m[1], base + "{…}");
    }
    return local;
  };

  const consumers = [];
  const producers = [];
  const addProducer = (module, exchange, routingKey) => {
    if (!exchange || !routingKey) return;
    if (!producers.some((x) => x.module === module && x.exchange === exchange && x.routingKey === routingKey)) {
      producers.push({ module, exchange, routingKey });
    }
  };

  for (const def of moduleDefs.filter((d) => d.type === "maven")) {
    const srcDir = join(ROOT, def.path, "src", "main", "java");
    for (const file of walk(srcDir, (p) => p.endsWith(".java"))) {
      const src = read(file);
      const local = localConstants(src);
      // `queues = X)` and `queues = X, concurrency = "…")` alike: a lane declares its own pool
      // size beside its queue (ADR-067), and a pattern that stopped at the first attribute lost
      // both lanes from the inventory.
      for (const m of src.matchAll(
        /@RabbitListener\(\s*queues\s*=\s*(\{[^}]*\}|[^,)\n]+)\s*[,)]/g,
      )) {
        const body = m[1].replace(/[{}]/g, "");
        for (const token of body.split(",")) {
          const queue = resolveToken(token, local);
          if (queue && !consumers.some((x) => x.module === def.id && x.queue === queue)) {
            consumers.push({ module: def.id, queue });
          }
        }
      }
      // A resolvable exchange with an unresolvable key is a DB-driven dynamic
      // dispatch (e.g. orazaka_routing_rules) — inventoried as "(dynamic)".
      for (const m of src.matchAll(/convertAndSend\(\s*([^,()]+),\s*([^,]+?),/g)) {
        const ex = resolveToken(m[1], local);
        addProducer(def.id, ex, resolveToken(m[2], local) ?? (ex ? "(dynamic)" : null));
      }
      for (const m of src.matchAll(/new OutboxMessage\(([\s\S]*?)\)/g)) {
        const args = m[1].split(",");
        if (args.length >= 4) {
          const ex = resolveToken(args[2], local);
          addProducer(def.id, ex, resolveToken(args[3], local) ?? (ex ? "(dynamic)" : null));
        }
      }
      // The studio's own outbox (ADR-067): `appendCommand(aggregate, exchange, routingKey, id, …)`
      // publishes a step dispatch, and `append(aggregate, eventType, …)` an event on the events
      // exchange. Both reach the broker through OutboxRelay; a generator that only knew
      // convertAndSend lost the run path as a producer the day it became durable.
      for (const m of src.matchAll(/appendCommand\(([\s\S]*?)\);/g)) {
        const args = m[1].split(",");
        if (args.length >= 4) {
          const ex = resolveToken(args[1], local);
          addProducer(def.id, ex, resolveToken(args[2], local) ?? (ex ? "(dynamic)" : null));
        }
      }
      for (const m of src.matchAll(/outboxService\.append\(([\s\S]*?)\);/g)) {
        const args = m[1].split(",");
        if (args.length >= 3) {
          addProducer(def.id, constants.get("EVENTS_EXCHANGE"), resolveToken(args[1], local) ?? "(dynamic)");
        }
      }
    }
  }

  // Python media worker: telemetry publisher (duplicated contract subset).
  const telemetry = read(join(ROOT, "orazaka-apps/workers/orazaka-worker-media/app/telemetry.py"));
  const pyExchange = telemetry.match(/EVENTS_EXCHANGE\s*=\s*'([^']+)'/)?.[1];
  const pyKey = telemetry.match(/routing_key=f"([^"]+)"/)?.[1]?.replace(/\{[^}]+\}/g, "{…}");
  if (pyExchange && pyKey) addProducer("orazaka-worker-media", pyExchange, pyKey);

  // Queues with their binding pattern and DLQ, from the *_QUEUE/*_BINDING/*_DLQ triples.
  const queues = [];
  for (const [name, value] of constants) {
    if (!name.endsWith("_QUEUE")) continue;
    const stem = name.slice(0, -"_QUEUE".length);
    const entry = {
      name: value,
      exchange: value.startsWith("orazaka.jobs") ? constants.get("JOBS_EXCHANGE") : constants.get("EVENTS_EXCHANGE"),
      // One queue may carry SEVERAL bindings — the interactive lane binds job.text.* and
      // job.media.analyze, because a lane is a property of the work and not of the media type
      // (ADR-067). Every JOBS_<LANE>_*_BINDING is collected, not just the exact stem.
      binding:
        [...constants.entries()]
          .filter(([k]) => k === stem + "_BINDING" || (k.startsWith(stem + "_") && k.endsWith("_BINDING")))
          .map(([, v]) => v)
          .filter((v, i, all) => all.indexOf(v) === i)
          .join(", ") || null,
      dlq: constants.get(stem + "_DLQ") ?? null,
    };
    if (!queues.some((q) => q.name === entry.name)) queues.push(entry);
  }
  queues.sort((a, b) => a.name.localeCompare(b.name));
  consumers.sort((a, b) => a.module.localeCompare(b.module) || a.queue.localeCompare(b.queue));
  producers.sort((a, b) => a.module.localeCompare(b.module) || a.routingKey.localeCompare(b.routingKey));

  const exchanges = [
    { name: constants.get("JOBS_EXCHANGE"), type: "topic" },
    { name: constants.get("EVENTS_EXCHANGE"), type: "topic" },
    { name: constants.get("DLX_EXCHANGE"), type: "direct" },
  ].filter((e) => e.name);

  return { exchanges, queues, producers, consumers };
}

/** UseCase catalog from business/usecases. */
function extractUseCases() {
  const dir = join(ROOT, "orazaka-libs/orazaka-ai-engine/orazaka-business/src/main/java/com/orazaka/business/usecases");
  return javaFiles(dir)
    .filter((f) => /implements\s+UseCase\b/.test(read(f)))
    .map((f) => {
      const src = read(f);
      const name = basename(f, ".java");
      const capability = src.match(/Capability\.([A-Z]+)/)?.[1] ?? "—";
      const domain = relative(dir, f).split(/[/\\]/)[0];
      // The first javadoc line, with inline tags ({@code X}, {@link X}) rendered as code — stopping
      // at the first "@" truncated "a first-class {@code Intention}" to an unclosed "{", which is
      // not valid MDX on the site.
      const javadoc = (src.match(/\/\*\*\s*\n\s*\*\s*([^\n]+)/)?.[1] ?? "")
        .replace(/\{@\w+\s+([^}]*)\}/g, "`$1`")
        .replace(/[{}]/g, "")
        .trim();
      return { name, capability, domain, summary: javadoc };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The Phase 1 core chain, read from PipelineRegistry rather than from the database.
 *
 * A core interceptor runs whatever the config table says — resolveCoreChain never consults
 * `enabled` — so rendering it as "no row, unknown order" reads as unregistered when the truth is
 * the opposite: mandatory and first. The ordering of a non-bypassable control belongs in code, so
 * that is where the registry reads it from (ADR-051).
 */
function coreInterceptorKeys() {
  const src = read(join(ROOT, "orazaka-libs/orazaka-ai-engine/orazaka-core/src/main/java/com/orazaka/core/application/pipeline/PipelineRegistry.java"));
  const block = /CORE_INTERCEPTOR_KEYS\s*=\s*List\.of\(([\s\S]*?)\);/.exec(src);
  return block ? [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1]) : [];
}

/** Interceptor registry: classes + concern package + core rank or DB order. */
function extractInterceptors(pipeline) {
  const dir = join(ROOT, "orazaka-libs/orazaka-ai-engine/orazaka-interceptors/src/main/java/com/orazaka/interceptor");
  const orderByName = new Map(pipeline.map((p) => [p.interceptor.toLowerCase(), p]));
  const core = coreInterceptorKeys();
  return javaFiles(dir)
    .filter((f) => /Interceptor\.java$/.test(f) && /\bclass\s+\w+Interceptor\b/.test(read(f)))
    .map((f) => {
      const name = basename(f, ".java");
      const concern = relative(dir, f).split(/[/\\]/)[0];
      const coreRank = core.indexOf(name);
      if (coreRank >= 0) {
        return { name, concern, order: `core ${coreRank + 1}`, enabled: "locked", sort: coreRank - 1000 };
      }
      const key = name.replace(/Interceptor$/, "").toLowerCase();
      const hit = [...orderByName.entries()].find(([k]) => key.includes(k) || k.includes(key))?.[1];
      return { name, concern, order: hit?.order ?? null, enabled: hit?.enabled ?? null, sort: hit?.order ?? 999 };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Router REST endpoints from @RequestMapping + @*Mapping. */
/**
 * The owned Tier-3 library source roots a service hosts, read from its pom.
 *
 * Only Tier-3 can hold a controller: Tier-1 is contracts and Tier-2 is the platform SDK, neither
 * of which owns a transport surface (AGENTS.md §2).
 */
function hostedTier3Dirs(serviceRoot) {
  const pom = read(join(serviceRoot, "pom.xml"));
  const dirs = [];
  for (const m of pom.matchAll(/<artifactId>(orazaka-(?:identity|business|persistence[\w-]*))<\/artifactId>/g)) {
    const moduleDir = MODULES.get(m[1]);
    const candidate = moduleDir && join(moduleDir, "src/main/java");
    if (candidate && existsSync(candidate) && !dirs.includes(candidate)) dirs.push(candidate);
  }
  return dirs;
}

/**
 * Authorisation rules from one service's SecurityConfig, most-specific first.
 *
 * Parsed from `.requestMatchers("<pattern>").<rule>` pairs. Comments are stripped first: the
 * configs explain their own rules in prose that names both a matcher and a verb, and a parser
 * that reads the justification as a rule reports the opposite of the truth.
 */
function accessRules(serviceDir) {
  const rules = [];
  for (const f of javaFiles(serviceDir)) {
    if (!f.endsWith("SecurityConfig.java")) continue;
    const code = read(f).replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    for (const m of code.matchAll(
      /requestMatchers\(\s*(?:HttpMethod\.(\w+)\s*,\s*)?((?:"[^"]*"\s*,?\s*)+)\)\s*\.\s*(permitAll|authenticated|hasAuthority|hasAnyAuthority)\(([^)]*)\)/g,
    )) {
      const httpMethod = m[1] ?? null;
      const patterns = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      const verb = m[3];
      const args = [...m[4].matchAll(/"([^"]*)"|(\b[A-Z_]{2,}\b)/g)].map((x) => x[1] ?? x[2]);
      const label =
        verb === "permitAll"
          ? "public"
          : verb === "authenticated"
            ? "authenticated"
            // " + ", never " | ": a pipe in a cell silently adds a column and the table
            // renders one row shorter than every other, which reads as missing data.
            : args.join(" + ") || verb;
      for (const pattern of patterns) rules.push({ pattern, label, httpMethod });
    }
    const anyRequest = code.match(/anyRequest\(\)\s*\.\s*(permitAll|authenticated)\(\)/);
    if (anyRequest) {
      rules.push({
        pattern: "/**",
        label: anyRequest[1] === "permitAll" ? "public" : "authenticated",
        httpMethod: null,
      });
    }
  }
  // Declaration order, deliberately unsorted. Spring Security is first-match-wins, and sorting by
  // specificity gets the answer backwards: billing's `requestMatchers(OPTIONS, "/**").permitAll()`
  // then shadowed everything below it and the reference called 28 authenticated billing endpoints
  // public — the exact opposite of the posture ADR-035 establishes.
  return rules;
}

/**
 * The access label of the first rule that covers a path for a verb, or "—" when none does.
 *
 * @param rules the service's rules, in declaration order
 * @param path the endpoint path
 * @param method the HTTP verb, so a method-scoped rule (preflight) applies only to its own
 */
function accessFor(rules, path, method) {
  const concrete = path.replace(/\{[^}]*\}/g, "x");
  for (const { pattern, label, httpMethod } of rules) {
    if (httpMethod && httpMethod !== method) continue;
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, ".*")
          .replace(/(?<!\.)\*/g, "[^/]*") +
        "$",
    );
    if (regex.test(concrete)) return label;
  }
  // Not a formatting placeholder — a finding. A service with no matching rule has no Spring
  // Security on the path at all, which is how `/internal/v1/knowledge/**` came to be reachable
  // with no credential and no `permitAll()` to notice (ADR-035, "Known gap").
  return "⚠ no rule";
}

/** First sentence of the javadoc immediately above a mapping, as the endpoint's summary. */
function summaryAbove(src, index) {
  const before = src.slice(0, index);
  // (?!\*\/) stops the block from spanning two javadocs: without it the lazy match starts at the
  // file's first comment and swallows everything up to the method's, so every endpoint inherits
  // the class summary and the table says the same sentence a dozen times.
  const doc = before.match(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*$/);
  if (!doc) return "";
  const text = doc[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l && !l.startsWith("@"))
    .join(" ");
  const sentence = text.split(/(?<=\.)\s/)[0] ?? "";
  return sentence.replace(/\{@\w+\s+([^}]*)\}/g, "$1").replace(/[{}]/g, "").replace(/\|/g, "\\|").trim();
}

/**
 * Every REST endpoint of every deployable service, with the authorisation rule that guards it.
 *
 * Scans all of `orazaka-apps/services`, not the conversation service alone: four services'
 * surfaces — including the credit ledger's `/internal/v1` — were absent from this reference
 * entirely, which is the failure mode a generated document is supposed to prevent.
 *
 * The access column is the point. A path list says what exists; ADR-035 turned "who may call it"
 * into the load-bearing fact, and a fact that lives only in a `SecurityConfig` diff is a fact that
 * erodes.
 */
function extractApi() {
  // Every deployable service of the workspace: a `*-service` module or the edge, whichever
  // repository holds it (a domain repository nests its service beside its contract and client).
  const services = [...MODULES.entries()]
    .filter(([id]) => id.endsWith("-service") || id === "orazaka-edge")
    .map(([id, dir]) => ({ service: id, root: dir }))
    .sort((a, b) => a.service.localeCompare(b.service));
  const rows = [];
  for (const { service, root } of services) {
    const dir = join(root, "src/main/java");
    if (!existsSync(dir)) continue;
    const rules = accessRules(dir);
    // A service's REST surface is not only what sits in its own module: identity hosts seven
    // controllers from `orazaka-apps/services/orazaka-users/orazaka-identity`, its owned Tier-3 (AGENTS.md §2). Scanning
    // the service directory alone dropped `/api/v1/auth/**` — the login endpoint — from the
    // reference entirely. The libs are read from the pom, so a future move needs no edit here.
    const sources = [dir, ...hostedTier3Dirs(root)];
    for (const f of sources.flatMap((d) => javaFiles(d))) {
      const src = read(f);
      if (!/@RestController/.test(src)) continue;
      const classDeclIndex = src.search(/\n(?:public\s+)?(?:final\s+)?class\s/);
      const classMapping = [...src.matchAll(/@RequestMapping\(\s*"([^"]*)"/g)].find(
        (m) => m.index < classDeclIndex,
      );
      const base = classMapping?.[1] ?? "";
      const controller = basename(f, ".java");
      // A *method*-level @RequestMapping is an endpoint answering every verb — the edge's
      // transparent proxy is written that way, and matching only the verb-specific annotations
      // left the whole facade undocumented. It is told from the class-level base by position:
      // the base is declared above the type.
      // The path is captured only when it is genuinely a quoted literal. A permissive `"?...?"`
      // spilled the rest of a multi-line annotation into the cell — `@PostMapping(value = "/code",
      // produces = ...)` documented a path called "/code/produces = MediaType...".
      for (const m of src.matchAll(
        /@(Get|Post|Put|Delete|Patch|Request)Mapping\b(?:\(\s*(?:value\s*=\s*)?(?:"([^"]*)")?)?/g,
      )) {
        if (m[1] === "Request" && m.index === classMapping?.index) continue;
        const method = m[1] === "Request" ? "ANY" : m[1].toUpperCase();
        const suffix = m[2] ? (m[2].startsWith("/") ? m[2] : "/" + m[2]) : "";
        const path = (base + suffix).replace(/\/$/, "") || base || "/";
        rows.push({
          method,
          path,
          controller,
          service: service.replace(/^orazaka-/, ""),
          access: accessFor(rules, path, method),
          summary: summaryAbove(src, m.index),
        });
      }
    }
  }
  return rows.sort(
    (a, b) => a.service.localeCompare(b.service) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

/**
 * orazaka CLI commands — name, description and options, parsed from the command
 * definitions. Each `new Command("x")` segment owns the `.description(...)` and
 * `.option(...)` calls that precede the next `new Command(` (so subcommands like
 * `docs build` are captured with their own flags).
 */
function extractCli() {
  const dir = join(ROOT, "orazaka-apps/ui/orazaka-cli/src/commands");
  if (!existsSync(dir)) return [];
  const commands = [];
  for (const n of readdirSync(dir).filter((x) => x.endsWith(".command.ts"))) {
    const src = read(join(dir, n));
    const markers = [...src.matchAll(/new Command\(\s*"([^"]+)"\s*\)/g)];
    for (let i = 0; i < markers.length; i++) {
      const name = markers[i][1];
      const segment = src.slice(markers[i].index, markers[i + 1]?.index ?? src.length);
      const description = segment.match(/\.description\(\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
      const options = [...segment.matchAll(/\.option\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => ({
        flag: m[1],
        desc: m[2],
      }));
      commands.push({ name, description, options });
    }
  }
  // Dedup by name, preferring the entry that carries a description.
  const byName = new Map();
  for (const c of commands) {
    const prev = byName.get(c.name);
    if (!prev || (!prev.description && c.description)) byName.set(c.name, c);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The architecture rules that bind the build, and the suites that enforce each one.
 *
 * These are the most load-bearing documentation in the repository and had none: a rule nobody can
 * find is a rule the next author re-litigates. ADR-034's tier decision and ADR-035's security
 * posture both survive only because a suite fails when they are broken — that fact belongs in a
 * document, generated, rather than in a reviewer's memory.
 *
 * Each rule's summary is the first sentence of its javadoc, so the registry is written by
 * whoever writes the rule.
 */
function extractGovernance() {
  const libDir = join(ROOT, "orazaka-libs/orazaka-build/orazaka-test-support/src/main/java");
  if (!existsSync(libDir)) return [];

  // One entry per RULE, keyed by holder + name — not one per method. A rule offered as a no-arg
  // convenience beside a JavaClasses variant is one rule with two signatures, and the first
  // version of this function keyed a Map by bare method name: the later overload overwrote the
  // earlier, every call site was attributed to it, and the earlier one rendered "Enforced by
  // **none**" forever. Seven rules read that way — [CFG-001] twice, [EXEC-001], [EXEC-002],
  // [ERR-130]'s support-package rule, [LOG-001] and [DOOR-001] — all of them enforced.
  //
  // That matters more than a cosmetic error, because AGENTS.md §10 makes this column a FINDING
  // when it reads `none`. The eleven previous instances of this project's defect produced a green
  // that meant nothing; this one produced a RED that meant nothing, in the index of every other
  // control. It fails socially rather than silently: the mechanism works and the readers stop
  // looking.
  const rules = new Map();
  for (const f of javaFiles(libDir)) {
    const src = read(f);
    const holder = basename(f, ".java");
    for (const m of src.matchAll(/public static (?:void|boolean) (assert\w+)\s*\(/g)) {
      const key = `${holder}.${m[1]}`;
      const summary = summaryAbove(src, m.index);
      const existing = rules.get(key);
      if (!existing) {
        rules.set(key, { name: m[1], holder, summary, signatures: 1, suites: [] });
      } else {
        existing.signatures += 1;
        // Keep the fullest javadoc of the overload set: the primary carries the reasoning and the
        // delegating convenience usually carries one line.
        if (summary.length > existing.summary.length) existing.summary = summary;
      }
    }
  }

  // Which suites enforce which rule — derived from what a suite actually INVOKES, qualified by the
  // class that holds it, rather than by matching a bare method name anywhere in the file. Two
  // holders may legitimately offer the same method name, and a name that appears in a comment is
  // not a call.
  for (const root of ["orazaka-apps", "orazaka-libs"]) {
    const dir = join(ROOT, root);
    if (!existsSync(dir)) continue;
    for (const f of walk(dir, (x) => x.endsWith("Test.java") || x.endsWith("IT.java"))) {
      const src = read(f);
      const suite = basename(f, ".java");
      for (const rule of rules.values()) {
        // `Holder.assertX(` — how most suites call it.
        const qualified = new RegExp(`\\b${rule.holder}\\s*\\.\\s*${rule.name}\\s*\\(`);
        // `import static ...Holder.assertX;` or `...Holder.*;` then a bare `assertX(`.
        const staticallyImported =
          new RegExp(`import\\s+static\\s+[\\w.]*\\b${rule.holder}\\.(?:${rule.name}|\\*)\\s*;`).test(src) &&
          new RegExp(`(?:^|[^.\\w])${rule.name}\\s*\\(`, "m").test(src);
        if ((qualified.test(src) || staticallyImported) && !rule.suites.includes(suite)) {
          rule.suites.push(suite);
        }
      }
    }
  }
  // Follow delegation inside the rule library. ExecutorCoherenceRules' two rules are enforced in
  // nine suites, but every one of them calls GovernanceRules.assertEveryCapabilityHasAnExecutor,
  // which delegates. Attributing only direct calls reported both as orphans — the instrument still
  // wrong, in the other direction, and it would have read as a finding about the rules rather than
  // about the generator. A rule reached through a facade is enforced by whatever enforces the
  // facade, so suites propagate along those edges to a fixpoint.
  // Follow delegation inside the rule library, per METHOD BODY rather than per file. Scanning the
  // whole file made every rule in GovernanceRules a caller of everything the file mentions, so
  // ExecutorCoherenceRules' two rules inherited the union of nine suites instead of the ones that
  // actually reach them. Approximately derived is not derived.
  //
  // Declarations are not calls: `public static void assertX(` counted as a call to assertX, which
  // silently rehabilitated the only genuinely orphaned rule in the library — the same correction
  // [DOOR-001] needed when a comment counted as a dispatch, and [BILL-001]'s docstring before it.
  const bodyOf = (src, name) => {
    const decl = new RegExp(`public static (?:void|boolean) ${name}\\s*\\(`).exec(src);
    if (!decl) return "";
    let i = src.indexOf("{", decl.index);
    if (i < 0) return "";
    let depth = 0;
    for (let j = i; j < src.length; j += 1) {
      if (src[j] === "{") depth += 1;
      else if (src[j] === "}") {
        depth -= 1;
        if (depth === 0) return src.slice(i, j);
      }
    }
    return src.slice(i);
  };

  const sources = new Map();
  for (const f of javaFiles(libDir)) {
    sources.set(basename(f, ".java"), read(f));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const caller of rules.values()) {
      const src = sources.get(caller.holder);
      if (!src || caller.suites.length === 0) continue;
      const body = bodyOf(src, caller.name);
      for (const callee of rules.values()) {
        if (callee === caller) continue;
        const reached =
          callee.holder === caller.holder
            ? new RegExp(`(?:^|[^.\\w])${callee.name}\\s*\\(`, "m").test(body)
            : new RegExp(`\\b${callee.holder}\\s*\\.\\s*${callee.name}\\s*\\(`).test(body);
        if (!reached) continue;
        for (const suite of caller.suites) {
          if (!callee.suites.includes(suite)) {
            callee.suites.push(suite);
            changed = true;
          }
        }
      }
    }
  }

  const all = [...rules.values()];
  for (const r of all) r.suites.sort();
  return all.sort((a, b) => a.holder.localeCompare(b.holder) || a.name.localeCompare(b.name));
}

/** AI model catalog from the infra/initdb seed. */
function extractModels() {
  const sql = readInitDb();
  const block = sql.match(/INSERT INTO orazaka_models[^;]*;/s)?.[0] ?? "";
  return [...block.matchAll(/\(\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'/g)]
    .map((m) => ({ name: m[1], label: m[2], category: m[3] }))
    .filter((m) => m.name && !/^https?:/.test(m.name))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** ADR ledger: dedup ADR-NNN citations across code + the adr/ source files. */
function extractAdrs() {
  const adrDir = join(ROOT, "docs", "adr");
  const fileById = new Map();
  if (existsSync(adrDir)) {
    for (const n of readdirSync(adrDir).filter((x) => x.endsWith(".md"))) {
      const id = n.match(/ADR-(\d{3})/)?.[0];
      if (id) {
        const title = read(join(adrDir, n)).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? n;
        fileById.set(id, { file: `adr/${n}`, title });
      }
    }
  }
  const cited = new Set();
  for (const f of walk(ROOT, (p) => (p.endsWith(".java") || p.endsWith(".md")) && !p.includes("/_generated/"))) {
    for (const m of read(f).matchAll(/ADR-(\d{3})/g)) cited.add(m[0]);
  }
  return [...cited].sort().map((id) => ({ id, ...(fileById.get(id) ?? { file: null, title: null }) }));
}

// ════════════════════════════════════════════════════════════════════════════
// MARKDOWN BUILDERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * The repository map, from orazaka.workspace.json: which GitHub repository holds what, what it
 * depends on, which modules of the architecture it hosts and which bootstrap SQL it owns. Built
 * from the manifest and the module paths, so a repository added to the manifest documents itself.
 */
const LAYER_TITLES = {
  foundation: "Foundation — reusable by any application",
  domain: "Domain services — reusable by any application",
  ai: "Orazaka AI engine",
  worker: "Native workers",
  app: "Applications",
  content: "Content",
};
const mdRepositories = (a) => {
  const lines = [
    frontmatter(
      "Repositories",
      "One GitHub repository per component — what each holds, what it depends on, and how they assemble into the workspace.",
      "Architecture",
      3,
    ),
  ];
  lines.push(
    `Orazaka is published as **${a.repositories.length + 1} repositories** in the [\`${WORKSPACE.org}\`](https://github.com/${WORKSPACE.org}) organisation: ` +
      `one per component, plus the workspace [\`${WORKSPACE.umbrella}\`](https://github.com/${WORKSPACE.org}/${WORKSPACE.umbrella}) that assembles them ` +
      "(governance contract, `orazaka.workspace.json`, local infrastructure, end-to-end tests, these docs).",
    "",
    "```bash",
    `git clone https://github.com/${WORKSPACE.org}/${WORKSPACE.umbrella}.git && cd ${WORKSPACE.umbrella}`,
    "node scripts/workspace.mjs clone   # every repository at its workspace path",
    "./mvnw install                     # the whole platform, in one reactor",
    "```",
    "",
  );
  for (const [layer, title] of Object.entries(LAYER_TITLES)) {
    const repos = a.repositories.filter((r) => r.layer === layer);
    if (!repos.length) continue;
    lines.push(`## ${title}\n`, "| Repository | Kind | What it holds | Depends on |", "|:---|:---|:---|:---|");
    for (const r of repos) {
      const hosted = a.modules.filter((m) => m.repository === r.name).map((m) => `\`${m.id}\``);
      const owns = REPOSITORIES.find((x) => x.name === r.name)?.initdb ?? [];
      const detail = [
        r.description,
        hosted.length ? `Modules: ${hosted.join(", ")}.` : "",
        owns.length ? `Owns ${owns.map((f) => `\`${f}\``).join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const deps = r.dependsOn.length ? r.dependsOn.map((d) => `\`${d}\``).join(", ") : "—";
      lines.push(`| [\`${r.name}\`](${r.url}) | ${r.kind} | ${detail} | ${deps} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Rules\n",
    "- A repository depends only on repositories listed **before** it in `orazaka.workspace.json` — the graph has no cycle.",
    "- A domain repository holds its contract, its client and its service together; other repositories depend on the contract or the client, never on the implementation.",
    "- A repository owns its context's bootstrap SQL (`infra/initdb/NN-*.sql`).",
    "- Cross-repository governance rules run inside the workspace and are reported as skipped — never as passed — in a standalone clone.",
  );
  return lines.join("\n") + "\n";
};

const mdArchitecture = (a) => {
  const lines = [frontmatter("Architecture Reference", "Module map, dependencies, pipeline and messaging — extracted from the code.", "Architecture", 2)];
  lines.push("## Modules\n", "| Module | Layer | Inbound ports | Outbound ports |", "|:---|:---|:---|:---|");
  for (const m of a.modules) lines.push(`| \`${m.id}\` | ${m.layer} | ${m.ports.inbound.join(", ") || "—"} | ${m.ports.outbound.join(", ") || "—"} |`);
  lines.push("\n## Dependency edges\n", "```", ...a.dependencies.map((d) => `${d.from} → ${d.to}`), "```");
  lines.push("\n## Interceptor pipeline (DB-driven order)\n", "| # | Interceptor | Enabled |", "|:--|:---|:--|");
  for (const p of a.pipeline) lines.push(`| ${p.order} | \`${p.interceptor}\` | ${p.enabled ? "✅" : "—"} |`);
  lines.push("\n## Messaging topology (AGENTS.md §6)\n", "**Exchanges**\n", ...a.messaging.exchanges.map((e) => `- \`${e.name}\` (${e.type})`));
  lines.push("\n**Queues**\n", "| Queue | Exchange | Binding | DLQ |", "|:---|:---|:---|:---|");
  for (const q of a.messaging.queues) lines.push(`| \`${q.name}\` | \`${q.exchange}\` | \`${q.binding ?? "—"}\` | \`${q.dlq ?? "—"}\` |`);
  lines.push("\n**Producers**\n", "| Module | Exchange | Routing key |", "|:---|:---|:---|");
  for (const p of a.messaging.producers) lines.push(`| \`${p.module}\` | \`${p.exchange}\` | \`${p.routingKey}\` |`);
  lines.push("\n**Consumers**\n", "| Module | Queue |", "|:---|:---|");
  for (const c of a.messaging.consumers) lines.push(`| \`${c.module}\` | \`${c.queue}\` |`);
  return lines.join("\n") + "\n";
};

const mdInterfaces = (a) => {
  const lines = [frontmatter("Interface Contracts (generated)", "Inbound and outbound ports per module, extracted from the code.", "Architecture", 3)];
  for (const m of a.modules.filter((x) => x.ports.inbound.length || x.ports.outbound.length)) {
    lines.push(`## \`${m.id}\`\n`);
    if (m.ports.inbound.length) lines.push("**Inbound ports**\n", ...m.ports.inbound.map((p) => `- \`${p}\``), "");
    if (m.ports.outbound.length) lines.push("**Outbound ports**\n", ...m.ports.outbound.map((p) => `- \`${p}\``), "");
  }
  return lines.join("\n") + "\n";
};

const mdUseCases = (rows) => {
  const lines = [frontmatter("Use-Case Catalog", "App Factory use-cases discovered in orazaka-business.", "Business", 4)];
  lines.push("| Use-case | Capability | Domain | Summary |", "|:---|:---|:---|:---|");
  for (const u of rows) lines.push(`| \`${u.name}\` | ${u.capability} | ${u.domain} | ${u.summary || "—"} |`);
  return lines.join("\n") + "\n";
};

const mdInterceptors = (rows) => {
  const lines = [frontmatter("Interceptor Registry", "Cross-cutting pipeline interceptors and their DB-driven order.", "Core", 5)];
  lines.push("| Order | Interceptor | Concern | Enabled |", "|:--|:---|:---|:--|");
  for (const i of rows) {
    // 🔒 is not "enabled": a core interceptor has no off switch to read (ADR-051 §3).
    const enabled = i.enabled === "locked" ? "🔒 non-bypassable" : i.enabled === null ? "—" : i.enabled ? "✅" : "—";
    lines.push(`| ${i.order ?? "—"} | \`${i.name}\` | ${i.concern} | ${enabled} |`);
  }
  return lines.join("\n") + "\n";
};

const mdApi = (rows) => {
  const lines = [
    frontmatter(
      "API Reference",
      "Every REST endpoint of every service, with the authorisation rule that guards it, extracted from the controllers and their SecurityConfig.",
      "API",
      6,
    ),
  ];
  lines.push(
    "",
    "**Access** is read from each service's `SecurityConfig`, most-specific matcher first — the same",
    "order Spring Security applies. `SERVICE` is the machine-to-machine authority required on",
    "`/internal/v1/**` (ADR-035); `public` means no credential at all, and **⚠ no rule** means",
    "no matcher covers the path — the service has no security on it whatsoever.",
    "",
  );
  let currentService = null;
  for (const r of rows) {
    if (r.service !== currentService) {
      currentService = r.service;
      lines.push("", `## ${currentService}`, "", "| Method | Path | Access | Controller | Summary |", "|:---|:---|:---|:---|:---|");
    }
    lines.push(`| ${r.method} | \`${r.path}\` | ${r.access} | ${r.controller} | ${r.summary} |`);
  }
  return lines.join("\n") + "\n";
};

const mdCli = (rows) => {
  const lines = [frontmatter("CLI Reference", "orazaka CLI commands and options, extracted from the command definitions.", "DevEx", 7)];

  // Local dev loop (authored here, single-sourced in the generator — see AGENTS.md §1).
  lines.push(
    "## Local dev workflow",
    "",
    "The dev loop has two layers — start them in order:",
    "",
    "1. **Infrastructure** — `orazaka start --mode dev` brings up the Docker middleware",
    "   (PostgreSQL+pgvector, Redis, RabbitMQ) and the native AI engines (Ollama, LocalAI,",
    "   video worker). Inference runs natively on macOS Metal — never in Docker.",
    "2. **Applications** — `orazaka dev` spawns the Router (Spring Boot), Web client, Web admin",
    "   and the Expo mobile server in parallel. Prefer to debug the backend in your IDE? Run",
    "   `RouterApplication` from IntelliJ and start the rest with `orazaka dev --skip-router`.",
    "",
    "`orazaka start --mode full` additionally builds/runs the Router JAR and the UI for a",
    "hands-off boot. Tear everything down with `orazaka stop`.",
    "",
    "> ℹ️ `start` manages *infrastructure*; `dev` manages *application processes*. They are",
    "> complementary, not alternatives.",
    "",
    "## Commands",
    "",
    "| Command | Description |",
    "|:---|:---|",
  );
  const cell = (s) => (s || "—").replace(/\|/g, "\\|");
  for (const c of rows) lines.push(`| \`orazaka ${c.name}\` | ${cell(c.description)} |`);

  const withOpts = rows.filter((c) => c.options.length > 0);
  if (withOpts.length) {
    lines.push("", "## Options", "");
    for (const c of withOpts) {
      lines.push(`### \`orazaka ${c.name}\``, "");
      if (c.description) lines.push(`${c.description}`, "");
      lines.push("| Option | Description |", "|:---|:---|");
      for (const o of c.options) lines.push(`| \`${cell(o.flag)}\` | ${cell(o.desc)} |`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
};

const mdGovernance = (rows) => {
  const lines = [
    frontmatter(
      "Governance Rules",
      "The architecture rules enforced at build time, and the suites that enforce each one, extracted from orazaka-test-support.",
      "Architecture",
      8,
    ),
  ];
  lines.push(
    "",
    "A rule with **no suite** is a rule that enforces nothing — it is written, it compiles, and no",
    "build fails when it is violated. Treat an empty cell as a defect, not as a gap.",
    "",
  );
  let holder = null;
  for (const r of rows) {
    if (r.holder !== holder) {
      holder = r.holder;
      lines.push("", `## ${holder}`, "", "| Rule | Enforced by | Summary |", "|:---|:---|:---|");
    }
    const suites = r.suites.length ? r.suites.map((x) => `\`${x}\``).join("<br/>") : "**none**";
    lines.push(`| \`${r.name}\` | ${suites} | ${r.summary} |`);
  }
  return lines.join("\n") + "\n";
};

const mdModels = (rows) => {
  const lines = [frontmatter("AI Model Catalog", "Models seeded in infra/initdb.", "Models", 8)];
  lines.push("| Model | Label | Category |", "|:---|:---|:---|");
  for (const m of rows) lines.push(`| \`${m.name}\` | ${m.label} | ${m.category} |`);
  return lines.join("\n") + "\n";
};

const mdAdrs = (rows) => {
  const lines = [frontmatter("ADR Ledger", "Architecture Decision Records cited across the codebase.", "Architecture", 9)];
  lines.push("| ADR | Title | Source file |", "|:---|:---|:---|");
  for (const r of rows) lines.push(`| ${r.id} | ${r.title ?? "_(cited in code, no dedicated file)_"} | ${r.file ? `\`${r.file}\`` : "—"} |`);
  return lines.join("\n") + "\n";
};

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

const arch = extractArchitecture();
const outputs = {
  "architecture.json": JSON.stringify(arch, null, 2) + "\n",
  "ARCHITECTURE.md": mdArchitecture(arch),
  "REPOSITORIES.md": mdRepositories(arch),
  "INTERFACE_CONTRACTS.md": mdInterfaces(arch),
  "USE_CASES.md": mdUseCases(extractUseCases()),
  "INTERCEPTORS.md": mdInterceptors(extractInterceptors(arch.pipeline)),
  "API_REFERENCE.md": mdApi(extractApi()),
  "CLI.md": mdCli(extractCli()),
  "GOVERNANCE.md": mdGovernance(extractGovernance()),
  "MODELS.md": mdModels(extractModels()),
  "ADRS.md": mdAdrs(extractAdrs()),
};

if (CHECK) {
  const stale = Object.entries(outputs).filter(([name, content]) => read(join(GEN_DIR, name)) !== content);
  if (stale.length) {
    console.error("✗ docs are stale — run `orazaka docs build`. Out of date:");
    for (const [name] of stale) console.error(`  - docs/_generated/${name}`);
    process.exit(1);
  }
  console.log(`✓ docs up to date (${Object.keys(outputs).length} generated files).`);
} else {
  mkdirSync(GEN_DIR, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) writeFileSync(join(GEN_DIR, name), content);
  console.log(
    `docs generated → docs/_generated/ (${arch.modules.length} modules, ${arch.dependencies.length} deps, ` +
      `${Object.keys(outputs).length} files).`
  );
}
