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

/**
 * A source file found by name under a directory, or a loud failure. The model used to name its
 * sources by full path; when the Java packages moved to com.krizaka.orazaka every one of those
 * paths went dead, and the generator went on writing an empty messaging topology, an empty
 * interceptor registry and an empty use-case catalogue as if nothing had happened. A source the
 * model depends on is now looked up, and its absence stops the build.
 */
function sourceFile(relDir, name) {
  const hit = walk(join(ROOT, relDir), (p) => basename(p) === name && p.includes(`${"/"}src${"/"}main${"/"}`))[0];
  if (!hit) throw new Error(`generate-docs: ${name} not found under ${relDir} — the architecture model depends on it`);
  return hit;
}
/** A source directory found by its trailing path segments (e.g. "business/usecases"), or a loud failure. */
function sourceDir(relDir, tail) {
  const found = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "target" || name === ".git" || name === "test") continue;
      const p = join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      if (p.replaceAll("\\", "/").endsWith(`/${tail}`)) found.push(p);
      else visit(p);
    }
  };
  visit(join(ROOT, relDir));
  if (!found.length) throw new Error(`generate-docs: no ${tail}/ under ${relDir} — the architecture model depends on it`);
  return found[0];
}

const xmlText = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
/** A pom without its <parent>, <build> and <dependencyManagement>: what the module itself declares. */
const ownPom = (pom) =>
  pom
    .replace(/<parent>[\s\S]*?<\/parent>/, "")
    .replace(/<build>[\s\S]*?<\/build>/g, "")
    .replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, "")
    .replace(/<profiles>[\s\S]*?<\/profiles>/g, "");

/**
 * Every Maven module of the platform, read the way Maven reads it: from each repository's root
 * pom, down its <modules>. A module under examples/ is a sample, not part of the platform.
 */
function reactorModules() {
  const out = [];
  const visit = (dir, repo) => {
    const pom = read(join(dir, "pom.xml"));
    if (!pom) return;
    const own = ownPom(pom);
    const id = own.match(/<artifactId>([\w.-]+)<\/artifactId>/)?.[1];
    if (/<packaging>pom<\/packaging>/.test(pom)) {
      for (const m of pom.matchAll(/<module>([^<]+)<\/module>/g)) visit(join(dir, m[1].trim()), repo);
      return;
    }
    const rel = relative(ROOT, dir).replaceAll("\\", "/");
    if (!id || rel.split("/").includes("examples")) return;
    // The project's own <version> (outside dependencies, properties and plugins), else its parent's.
    const head = own.replace(/<(dependencies|properties|repositories|pluginRepositories|reporting)>[\s\S]*?<\/\1>/g, "");
    const parentVersion = pom.match(/<parent>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/parent>/)?.[1] ?? null;
    let version = head.match(/<version>([^<]+)<\/version>/)?.[1] ?? parentVersion;
    if (version?.startsWith("${")) version = parentVersion;
    out.push({ id, dir, path: rel, repository: repo, pom, version, description: xmlText(own.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "") || null });
  };
  for (const repo of REPOSITORIES.filter((r) => r.kind === "maven")) visit(join(ROOT, repo.path), repo);
  return out;
}

/** The module's declared dependencies, without the test-scoped ones (they never ship). */
function pomDependencies(pom) {
  const block = ownPom(pom).match(/<dependencies>([\s\S]*?)<\/dependencies>/)?.[1] ?? "";
  return [...block.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)]
    .map((m) => ({
      artifactId: m[1].match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]?.trim(),
      scope: m[1].match(/<scope>([^<]+)<\/scope>/)?.[1]?.trim() ?? "compile",
      optional: /<optional>\s*true\s*<\/optional>/.test(m[1]),
    }))
    .filter((d) => d.artifactId && d.scope !== "test");
}

/** The HTTP port a Spring Boot service listens on: server.port, or Spring's default 8080. */
function servicePort(dir) {
  const yml = read(join(dir, "src/main/resources/application.yml")) || read(join(dir, "src/main/resources/application.yaml"));
  const m = yml.match(/^server:\s*\n(?:[ \t]+.*\n)*?[ \t]+port:\s*(?:\$\{[\w.-]+:)?(\d+)/m);
  return m ? Number(m[1]) : 8080;
}

/**
 * The role of a module in the hexagon (AGENTS.md §2) — one band of the module map, outermost
 * first. Each rule reads a fact of the code or of the workspace manifest, never a list kept here.
 */
const ROLES = [
  { id: "client", title: "Clients", rule: "a UI repository of the workspace manifest (layer app, kind npm)" },
  { id: "service", title: "Services & workers", rule: "a module with a main (SpringApplication.run), or a native worker" },
  { id: "adapter", title: "Adapters", rule: "an imported module that is none of the below: persistence, typed HTTP clients, asset store, bridge" },
  { id: "application", title: "Application", rule: "the orchestration, pipeline and capability libraries around the core (AGENTS.md §2: business, interceptors, tools)" },
  { id: "domain", title: "Domain core", rule: "a `*-core` module — the centre of its hexagon, depending on no outer layer" },
  { id: "contract", title: "Contracts", rule: "a Tier-1 `*-api` module — pure interfaces and records" },
  { id: "platform", title: "Krizaka platform kit", rule: "a module of krizaka-platform-kit — the cross-cutting code with one author (ADR-073), starters included" },
];
const APPLICATION_LIBRARIES = ["orazaka-business", "orazaka-interceptors", "orazaka-tools"];

function roleOf(m) {
  if (/SpringApplication\.run\(/.test(javaFiles(join(m.dir, "src/main/java")).map(read).join("\n"))) return "service";
  if (m.repository.name === "krizaka-platform-kit") return "platform";
  if (m.id.endsWith("-api")) return "contract";
  if (m.id.endsWith("-core")) return "domain";
  if (APPLICATION_LIBRARIES.includes(m.id)) return "application";
  return "adapter";
}

/** Glob-free match of an AMQP topic binding ("job.*.done", "job.#") against a routing key. */
function topicMatches(binding, key) {
  const b = binding.split("."), k = key.split(".");
  const go = (i, j) => {
    if (i === b.length) return j === k.length;
    if (b[i] === "#") return go(i + 1, j) || (j < k.length && go(i, j + 1));
    if (j === k.length) return false;
    return (b[i] === "*" || b[i] === k[j] || k[j] === "{…}") && go(i + 1, j + 1);
  };
  return go(0, 0);
}

function extractArchitecture() {
  const reactor = reactorModules();
  const known = new Set(reactor.map((m) => m.id));
  const modules = [];
  const dependencies = [];

  // The test kits (`*-test-support`, AGENTS.md §2 Tier 2) are build tooling, not architecture.
  const testOnly = new Set(reactor.filter((k) => k.id.endsWith("-test-support")).map((k) => k.id));
  for (let i = reactor.length - 1; i >= 0; i--) if (testOnly.has(reactor[i].id)) reactor.splice(i, 1);
  known.clear();
  for (const m of reactor) known.add(m.id);

  for (const m of reactor) {
    m.role = roleOf(m);
    for (const d of pomDependencies(m.pom)) {
      if (!known.has(d.artifactId) || d.artifactId === m.id) continue;
      if (dependencies.some((e) => e.from === m.id && e.to === d.artifactId)) continue;
      dependencies.push({ from: m.id, to: d.artifactId, ...(d.scope !== "compile" ? { scope: d.scope } : {}), ...(d.optional ? { optional: true } : {}) });
    }
  }

  // Native workers and UI clients: one repository each, described by the manifest.
  const extra = REPOSITORIES.filter((r) => r.layer === "worker" || (r.layer === "app" && r.kind === "npm")).map((r) => ({
    id: r.name,
    dir: join(ROOT, r.path),
    path: r.path,
    repository: r,
    role: r.layer === "worker" ? "service" : "client",
    runtime: r.layer === "worker" ? (r.kind === "python" ? "python" : r.kind) : "node",
    version: null,
    description: r.description,
  }));

  for (const m of [...reactor, ...extra]) {
    const owner = m.repository.layer === "krizaka" ? "krizaka" : "orazaka";
    modules.push({
      id: m.id,
      path: m.path,
      repository: m.repository.name,
      owner,
      role: m.role,
      // The two-value layer the first site schemas read (framework = imported, app = run).
      layer: m.role === "client" || m.role === "service" ? "app" : "framework",
      runtime: m.runtime ?? "jvm",
      version: m.version,
      description: m.description,
      ports: m.runtime ? { inbound: [], outbound: [] } : { inbound: portsIn(m.dir, "/domain/ports/inbound/"), outbound: portsIn(m.dir, "/domain/ports/outbound/") },
    });
  }
  const order = new Map(ROLES.map((r, i) => [r.id, i]));
  modules.sort((a, b) => order.get(a.role) - order.get(b.role) || a.owner.localeCompare(b.owner) * -1 || a.id.localeCompare(b.id));
  dependencies.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  // What each module packages, transitively: a library's code runs inside every service that
  // depends on it, so that is where its HTTP calls and its messages come from.
  const direct = new Map(modules.map((m) => [m.id, dependencies.filter((d) => d.from === m.id && d.scope !== "provided").map((d) => d.to)]));
  const closure = (id, seen = new Set()) => {
    for (const to of direct.get(id) ?? []) if (!seen.has(to)) { seen.add(to); closure(to, seen); }
    return seen;
  };
  const services = modules.filter((m) => m.role === "service");
  const hostsOf = (id) => {
    const self = modules.find((m) => m.id === id);
    if (self?.role === "service") return [id];
    return services.filter((s) => closure(s.id).has(id)).map((s) => s.id);
  };

  // ── Runtime flows ─────────────────────────────────────────────────────────────────────────
  const flows = [];
  const addFlow = (f) => {
    if (f.from === f.to) return;
    if (!flows.some((x) => x.from === f.from && x.to === f.to && x.kind === f.kind && x.via === f.via)) flows.push(f);
  };
  const jvmServices = reactor.filter((m) => m.role === "service");
  const byPort = new Map(jvmServices.map((m) => [servicePort(m.dir), m.id]));

  // 1. UI clients → the services whose default local address they name.
  for (const c of extra.filter((m) => m.role === "client")) {
    const ports = new Set();
    // Sources only (src/, app/): build output (.next, dist, …) would make the model depend on what ran before it.
    const sources = ["src", "app"].flatMap((d) => walk(join(c.dir, d), (p) => /\.(ts|tsx|js|mjs)$/.test(p) && !/(__tests__|\.test\.|\.spec\.|\/e2e\/|\/tests?\/|\/\.next\/|\/dist\/|\/\.expo\/)/.test(p.replaceAll("\\", "/"))));
    for (const f of sources) {
      for (const m of read(f).matchAll(/localhost:(\d{4,5})/g)) if (byPort.has(Number(m[1]))) ports.add(Number(m[1]));
    }
    for (const port of [...ports].sort()) addFlow({ from: c.id, to: byPort.get(port), kind: "http", via: `localhost:${port}` });
  }
  // 2. Route tables (the edge): `- path-prefix: X` + `target: ${VAR:http://localhost:PORT}`.
  for (const s of jvmServices) {
    const yml = read(join(s.dir, "src/main/resources/application.yml"));
    for (const m of yml.matchAll(/-\s*path-prefix:\s*(\S+)\s*\n\s*target:\s*\$\{[\w.-]+:https?:\/\/[\w.-]+:(\d+)\}/g)) {
      const to = byPort.get(Number(m[2]));
      if (to) addFlow({ from: s.id, to, kind: "http", via: `route ${m[1]}` });
    }
  }
  // 3. Typed clients: a service that packages `<x>-client` calls the service of the same repository.
  for (const s of jvmServices) {
    for (const lib of closure(s.id)) {
      if (!lib.endsWith("-client")) continue;
      const repo = reactor.find((m) => m.id === lib)?.repository.name;
      const target = jvmServices.find((m) => m.repository.name === repo && m.id !== s.id);
      if (target) addFlow({ from: s.id, to: target.id, kind: "http", via: lib });
    }
  }

  const initSql = readInitDb();
  const interceptorClasses = extractInterceptors([]);
  const pipeline = [...initSql.matchAll(/\('(\w+)',\s*'[^']+',\s*(\d+),\s*(TRUE|FALSE),\s*'[^']*'\)/g)]
    .map((m) => {
      const cls = interceptorClasses.find((c) => c.name === m[1]);
      return {
        interceptor: m[1],
        order: Number(m[2]),
        enabled: m[3] === "TRUE",
        // Phase 1 (core) runs in the order of the code whatever the row says (ADR-051); phase 2 by this order.
        phase: coreInterceptorKeys().includes(m[1]) ? "core" : "dynamic",
        // A row with no class behind it configures nothing.
        implemented: Boolean(cls),
        ...(cls ? { concern: cls.concern, summary: cls.summary } : {}),
      };
    })
    .sort((a, b) => a.order - b.order);
  const coreChain = coreInterceptorKeys().map((name, i) => {
    const cls = interceptorClasses.find((c) => c.name === name);
    return { interceptor: name, rank: i + 1, ...(cls ? { concern: cls.concern, summary: cls.summary } : {}) };
  });

  const messaging = extractMessaging(reactor, extra);

  // 4. Messages: the services that publish a routing key → the services whose queue it reaches.
  for (const p of messaging.producers) {
    if (p.routingKey === "(dynamic)") continue;
    const keys = p.routingKey === "(capability route)" ? [...new Set(messaging.capabilityRoutes.map((r) => r.routingKey))] : [p.routingKey];
    for (const key of keys) {
      for (const q of messaging.queues.filter((x) => x.exchange === p.exchange && x.binding)) {
        if (!q.binding.split(", ").some((b) => topicMatches(b, key))) continue;
        for (const c of messaging.consumers.filter((x) => x.queue === q.name)) {
          for (const from of hostsOf(p.module)) for (const to of hostsOf(c.module)) {
            if (!flows.some((f) => f.kind === "amqp" && f.from === from && f.to === to && f.via === q.name)) {
              addFlow({ from, to, kind: "amqp", via: q.name, exchange: p.exchange, routingKey: p.routingKey === "(capability route)" ? q.binding : key });
            }
          }
        }
      }
    }
  }
  flows.sort((a, b) => a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.via.localeCompare(b.via));

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

  return {
    product: "orazaka",
    source: "generated from code by scripts/generate-docs.mjs — do not hand-edit",
    roles: ROLES,
    repositories,
    modules,
    dependencies,
    flows,
    pipeline,
    coreChain,
    messaging,
  };
}

/**
 * Real AMQP inventory (Phase 0 fitness function). Every module's topology constants are read
 * from the module itself (its AmqpConstants) over the shared contracts (MessagingContract,
 * NotificationRouting); queues are the *_QUEUE / *_BINDING / *_DLQ triples of one file;
 * consumers are @RabbitListener queues — SpEL bean references (`#{settlementQueue.name}`)
 * resolved through the bean that declares the queue — and producers the convertAndSend /
 * outbox calls. `docs build --check` turns topology drift into a build failure.
 */
function extractMessaging(reactor, extra) {
  const constantsOf = (src, base = new Map()) => {
    const map = new Map(base);
    for (let pass = 0; pass < 3; pass++) {
      for (const m of src.matchAll(/String\s+(\w+)\s*=\s*"([^"]+)"\s*;/g)) map.set(m[1], m[2]);
      for (const m of src.matchAll(/String\s+(\w+)\s*=\s*([\w.]+)\s*\+\s*"([^"]+)"\s*;/g)) {
        const v = map.get(m[2].split(".").pop());
        if (v) map.set(m[1], v + m[3]);
      }
      for (const m of src.matchAll(/String\s+(\w+)\s*=\s*([\w.]+)\s*;/g)) {
        const v = map.get(m[2].split(".").pop());
        if (v && !map.has(m[1])) map.set(m[1], v);
      }
    }
    return map;
  };

  // The shared contracts every module may name.
  const contractFiles = reactor.flatMap((m) =>
    walk(join(m.dir, "src/main/java"), (p) => /\/(MessagingContract|NotificationRouting)\.java$/.test(p.replaceAll("\\", "/"))),
  );
  if (!contractFiles.some((f) => f.endsWith("MessagingContract.java"))) {
    throw new Error("generate-docs: MessagingContract.java not found — the messaging topology depends on it");
  }
  const shared = constantsOf(contractFiles.map(read).join("\n"));
  const JOBS = shared.get("JOBS_EXCHANGE");
  const EVENTS = shared.get("EVENTS_EXCHANGE");
  const DLX = shared.get("DLX_EXCHANGE");

  // The Krizaka building blocks name no exchange: they run on the one the host platform gives them
  // (krizaka.messaging.exchanges, EVENTS_EXCHANGE / DLX_EXCHANGE in the workspace env).
  // The contract's key builders — `jobDoneKey(jobId)` is `JOB_EVENT_PREFIX + jobId + JOB_EVENT_DONE_SUFFIX`.
  const keyBuilders = new Map(
    [...contractFiles.map(read).join("\n").matchAll(/static\s+String\s+(\w+)\(\s*String\s+\w+\s*\)\s*\{\s*return\s+([^;]+);/g)].map((m) => [m[1], m[2]]),
  );
  // A routing key or a queue name as the code writes it: a literal, a constant, or a concatenation
  // of both with runtime values (`"job." + jobId + ".done"` → `job.{…}.done`).
  const resolveToken = (raw, local) => {
    const token = raw.trim();
    if (/^(exchanges\.events\(\)|eventsExchange|this\.eventsExchange)$/.test(token)) return EVENTS;
    if (/^(exchanges\.deadLetter\(\)|deadLetterExchange)$/.test(token)) return DLX;
    const call = token.match(/^(?:[\w]+\.)?(\w+)\(([^()]*)\)$/);
    if (call && keyBuilders.has(call[1])) return resolveToken(keyBuilders.get(call[1]), local);
    const parts = token.split(/\s*\+\s*/);
    let known = false;
    const text = parts
      .map((part) => {
        const lit = part.match(/^"([^"]*)"$/);
        if (lit) { known = true; return lit[1]; }
        const v = local.get(part.split(".").pop());
        if (v) { known = true; return v; }
        return "{…}";
      })
      .join("")
      .replace(/(\{…\})+/g, "{…}");
    return known ? text : null;
  };

  const queues = [];
  const consumers = [];
  const producers = [];
  // A job whose key comes from the capability registry (CapabilityRoutingClient, ADR-037) is
  // routed by a row of orazaka_capabilities: the key is data, so it is read from the seed below.
  let routedByCapability = false;
  const addProducer = (module, exchange, routingKey) => {
    if (!exchange || !routingKey) return;
    if (routingKey === "(dynamic)" && exchange === JOBS && routedByCapability) routingKey = "(capability route)";
    if (!producers.some((x) => x.module === module && x.exchange === exchange && x.routingKey === routingKey)) producers.push({ module, exchange, routingKey });
  };
  const addConsumer = (module, queue) => {
    if (queue && !consumers.some((x) => x.module === module && x.queue === queue)) consumers.push({ module, queue });
  };

  for (const mod of reactor) {
    const files = walk(join(mod.dir, "src/main/java"), (p) => p.endsWith(".java"));
    if (!files.length) continue;
    const moduleConstants = constantsOf(
      files.filter((f) => /\/(AmqpConstants|MessagingContract|NotificationRouting)\.java$/.test(f.replaceAll("\\", "/"))).map(read).join("\n"),
      shared,
    );

    // Queues: the *_QUEUE / *_BINDING / *_DLQ triples of each constants file of this module.
    for (const f of files.filter((p) => /\/(AmqpConstants|MessagingContract)\.java$/.test(p.replaceAll("\\", "/")))) {
      const own = constantsOf(read(f), shared);
      const local = [...read(f).matchAll(/String\s+(\w+_QUEUE)\s*=/g)].map((m) => m[1]);
      for (const name of local) {
        const value = own.get(name);
        if (!value) continue;
        const stem = name.slice(0, -"_QUEUE".length);
        // One queue may carry several bindings — the interactive lane binds job.text.* and
        // job.media.analyze (ADR-067); a service's queue binds DONE_BINDING and ERROR_BINDING.
        const fileBindings = [...read(f).matchAll(/String\s+(\w+_BINDING)\s*=/g)].map((m) => m[1]);
        let keys = fileBindings.filter((k) => k === `${stem}_BINDING` || (k.startsWith(`${stem}_`) && k.endsWith("_BINDING")));
        // A file with one queue and unprefixed bindings (DONE_BINDING, ERROR_BINDING) binds them to it
        // when the configuration says so: read the Binding beans of the module.
        if (!keys.length) {
          const config = files.map(read).join("\n");
          const bean = stem.toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase());
          keys = fileBindings.filter((k) => new RegExp(`bind\\(\\s*\\w*${bean}Queue\\s*\\)[\\s\\S]{0,120}?with\\(\\s*(?:AmqpConstants\\.)?${k}\\b`, "i").test(config));
        }
        const binding = keys.map((k) => own.get(k)).filter((v, i, all) => v && all.indexOf(v) === i).join(", ") || null;
        const exchange = value.startsWith(`${JOBS}.`) ? JOBS : EVENTS;
        if (!queues.some((q) => q.name === value)) {
          queues.push({ name: value, exchange, binding, dlq: own.get(`${stem}_DLQ`) ?? null, declaredBy: mod.id });
        }
      }
    }

    for (const file of files) {
      const src = read(file);
      const local = constantsOf(src, moduleConstants);
      routedByCapability = /\bCapabilityRoutingClient\b/.test(src);
      for (const m of src.matchAll(/@RabbitListener\(\s*queues\s*=\s*(\{[^}]*\}|[^,)\n]+)\s*[,)]/g)) {
        for (const token of m[1].replace(/[{}]/g, " ").split(",")) {
          const spel = token.trim().match(/^"#\s*(\w+)\.name\s*"$/) ?? token.trim().match(/^"#\{(\w+)\.name\}"$/);
          if (spel) {
            // `#{settlementQueue.name}`: the queue the bean of that name declares.
            const bean = files.map(read).join("\n").match(new RegExp(`Queue\\s+${spel[1]}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?(?:new Queue\\(|QueueBuilder\\.durable\\()\\s*([^,)]+)`));
            addConsumer(mod.id, bean ? resolveToken(bean[1], local) : null);
          } else addConsumer(mod.id, resolveToken(token, local));
        }
      }
      for (const m of src.matchAll(/convertAndSend\(\s*([^,()]+),\s*([^,]+?),/g)) {
        const ex = resolveToken(m[1], local);
        addProducer(mod.id, ex, resolveToken(m[2], local) ?? (ex ? "(dynamic)" : null));
      }
      for (const m of src.matchAll(/new OutboxMessage\(([\s\S]*?)\)\s*\)?;/g)) {
        const args = m[1].split(",");
        if (args.length >= 4) {
          const ex = resolveToken(args[2], local);
          addProducer(mod.id, ex, resolveToken(args[3], local) ?? (ex ? "(dynamic)" : null));
        }
      }
      // The studio's own outbox (ADR-067): `appendCommand(aggregate, exchange, routingKey, …)` and
      // `append(aggregate, eventType, …)` on the events exchange, both relayed by OutboxRelay.
      for (const m of src.matchAll(/appendCommand\(([\s\S]*?)\);/g)) {
        const args = m[1].split(",");
        if (args.length >= 4) {
          const ex = resolveToken(args[1], local);
          addProducer(mod.id, ex, resolveToken(args[2], local) ?? (ex ? "(dynamic)" : null));
        }
      }
      for (const m of src.matchAll(/outboxService\.append\(([\s\S]*?)\);/g)) {
        const args = m[1].split(",");
        if (args.length >= 3) addProducer(mod.id, EVENTS, resolveToken(args[1], local) ?? "(dynamic)");
      }
    }
  }

  // Native workers: Python publishers and consumers (a duplicated subset of the contract).
  for (const w of extra.filter((m) => m.runtime === "python")) {
    for (const f of walk(w.dir, (p) => p.endsWith(".py") && !/\/tests?\//.test(p))) {
      const src = read(f);
      const pyConst = new Map([...src.matchAll(/^(\w+)\s*=\s*["']([^"']+)["']/gm)].map((m) => [m[1], m[2]]));
      for (const m of src.matchAll(/basic_consume\(\s*queue\s*=\s*(\w+)/g)) {
        const queue = pyConst.get(m[1]);
        addConsumer(w.id, queue);
        // The worker binds its queue from its declaration (worker.yaml `bindings`, ADR-038).
        const declared = [...read(join(w.dir, "worker.yaml")).matchAll(/^\s*-\s*"(job\.[^"]+)"/gm)].map((b) => b[1]);
        const q = queues.find((x) => x.name === queue);
        if (q && declared.length) q.binding = [...new Set([...(q.binding ? q.binding.split(", ") : []), ...declared])].join(", ");
      }
      const ex = src.match(/EVENTS_EXCHANGE\s*=\s*'([^']+)'/)?.[1];
      const key = src.match(/routing_key=f"([^"]+)"/)?.[1]?.replace(/\{[^}]+\}/g, "{…}");
      if (ex && key) addProducer(w.id, ex, key);
    }
  }

  // The retry policy of the kit's listener container (krizaka.messaging.retry), defaults read from code.
  const retrySrc = read(sourceFile("krizaka/krizaka-platform-kit/krizaka-messaging", "ConsumerRetryProperties.java"));
  const retry = {
    maxAttempts: Number(retrySrc.match(/maxAttempts\s*=\s*maxAttempts\s*==\s*null\s*\?\s*(\d+)/)?.[1]),
    initialMs: Number(retrySrc.match(/initial\s*=\s*initial\s*==\s*null\s*\?\s*Duration\.ofMillis\((\d+)\)/)?.[1]),
    multiplier: Number(retrySrc.match(/multiplier\s*=\s*multiplier\s*==\s*null\s*\?\s*([\d.]+)/)?.[1]),
    maxMs: Number(retrySrc.match(/max\s*=\s*max\s*==\s*null\s*\?\s*Duration\.ofSeconds\((\d+)\)/)?.[1]) * 1000,
    property: "krizaka.messaging.retry",
    module: "krizaka-messaging",
  };
  if (Object.values(retry).some((v) => typeof v === "number" && !Number.isFinite(v))) {
    throw new Error("generate-docs: could not read the retry defaults of ConsumerRetryProperties");
  }
  // Which consumers run on the kit's listener container (retry, then <queue>.dlq).
  const deps = new Map(reactor.map((m) => [m.id, pomDependencies(m.pom).map((d) => d.artifactId)]));
  const usesKit = (id, seen = new Set()) => {
    if (id === "krizaka-messaging") return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (deps.get(id) ?? []).some((d) => usesKit(d, seen));
  };
  for (const c of consumers) c.retry = usesKit(c.module) ? "kit" : "module";

  // The capability routes: (feature_key, handler_key, routing_key, …) rows of orazaka_capabilities.
  const seed = readInitDb();
  const capabilityRoutes = [];
  for (const block of seed.matchAll(/INSERT INTO orazaka_capabilities\s*\(([^)]*)\)\s*VALUES([\s\S]*?);\s*$/gm)) {
    const cols = block[1].split(",").map((c) => c.trim());
    const [fi, hi, ri] = ["feature_key", "handler_key", "routing_key"].map((c) => cols.indexOf(c));
    if (fi < 0 || ri < 0) continue;
    for (const row of block[2].matchAll(/^\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/gm)) {
      const vals = [row[1], row[2], row[3]];
      const route = { feature: vals[fi], handler: hi >= 0 ? vals[hi] : null, routingKey: vals[ri] };
      if (!capabilityRoutes.some((r) => r.feature === route.feature)) capabilityRoutes.push(route);
    }
  }
  capabilityRoutes.sort((a, b) => a.routingKey.localeCompare(b.routingKey) || a.feature.localeCompare(b.feature));

  queues.sort((a, b) => a.name.localeCompare(b.name));
  consumers.sort((a, b) => a.module.localeCompare(b.module) || a.queue.localeCompare(b.queue));
  producers.sort((a, b) => a.module.localeCompare(b.module) || a.routingKey.localeCompare(b.routingKey));
  const exchanges = [
    { name: JOBS, type: "topic" },
    { name: EVENTS, type: "topic" },
    { name: DLX, type: "direct" },
  ].filter((e) => e.name);

  return { exchanges, queues, producers, consumers, capabilityRoutes, retry };
}

/** UseCase catalog from business/usecases. */
function extractUseCases() {
  const dir = sourceDir("orazaka-libs/orazaka-ai-engine/orazaka-business", "business/usecases");
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
  const src = read(sourceFile("orazaka-libs/orazaka-ai-engine/orazaka-core", "PipelineRegistry.java"));
  const block = /CORE_INTERCEPTOR_KEYS\s*=\s*List\.of\(([\s\S]*?)\);/.exec(src);
  return block ? [...block[1].matchAll(/"(\w+)"/g)].map((m) => m[1]) : [];
}

/**
 * The first sentence of the javadoc right above `class <name>`, inline tags rendered as code and
 * braces dropped (the text is compiled as MDX on the site), or null.
 */
function classSummary(src, name) {
  const at = src.search(new RegExp(`\\bclass\\s+${name}\\b`));
  if (at < 0) return null;
  const doc = src.slice(0, at).match(/\/\*\*([\s\S]*?)\*\/[^/]*$/)?.[1];
  if (!doc) return null;
  const text = doc
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .filter((l) => !l.startsWith("@"))
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .replace(/\{@\w+\s+([^}]*)\}/g, "`$1`")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // "Order 6 — …": the order lives in the database (ADR-027), a number in prose is stale by design.
  const body = text.replace(/^Order\s+\d+\s*[—–-]\s*/, "");
  const first = body.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? body;
  return first || null;
}

/** Interceptor registry: classes + concern package + core rank or DB order. */
function extractInterceptors(pipeline) {
  const dir = sourceDir("orazaka-libs/orazaka-ai-engine/orazaka-interceptors", "orazaka/interceptor");
  const orderByName = new Map(pipeline.map((p) => [p.interceptor.toLowerCase(), p]));
  const core = coreInterceptorKeys();
  return javaFiles(dir)
    // An interceptor is a class implementing the core's PromptContextInterceptor SPI (ERR-122),
    // whatever its name says: UserContextResolver and SystemContextInjector lead the core chain.
    .filter((f) => new RegExp(`\\bclass\\s+${basename(f, ".java")}\\b[^{]*\\bimplements\\b[^{]*\\bPromptContextInterceptor\\b`).test(read(f)))
    .map((f) => {
      const name = basename(f, ".java");
      const concern = relative(dir, f).split(/[/\\]/)[0];
      const summary = classSummary(read(f), name);
      const coreRank = core.indexOf(name);
      if (coreRank >= 0) {
        return { name, concern, summary, order: `core ${coreRank + 1}`, enabled: "locked", sort: coreRank - 1000 };
      }
      // By exact key: the fuzzy match it replaces gave UserContextInterceptor the order of UserContextResolver.
      const hit = orderByName.get(name.toLowerCase());
      return { name, concern, summary, order: hit?.order ?? null, enabled: hit?.enabled ?? null, sort: hit?.order ?? 999 };
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
  for (const m of pom.matchAll(/<artifactId>(orazaka-(?:business|persistence[\w-]*)|krizaka-users-(?:core|persistence))<\/artifactId>/g)) {
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
    // krizaka-security's SecurityBaseline.apply(http, serviceRules) declares the shared rules
    // first and `anyRequest().authenticated()` last, around the service's own: the same order
    // Spring Security will evaluate them in (krizaka/krizaka-platform-kit, ADR-073).
    const baseline = code.includes("SecurityBaseline.apply(");
    if (baseline) {
      rules.push({ pattern: "/**", label: "public", httpMethod: "OPTIONS" });
      for (const pattern of ["/actuator/health", "/actuator/info", "/error"]) {
        rules.push({ pattern, label: "public", httpMethod: null });
      }
      rules.push({ pattern: "/internal/v1/**", label: "SERVICE", httpMethod: null });
    }
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
    const anyRequest = baseline
      ? [null, "authenticated"]
      : code.match(/anyRequest\(\)\s*\.\s*(permitAll|authenticated)\(\)/);
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
    // controllers from `krizaka/krizaka-users/krizaka-users-core`, its owned Tier-3 (AGENTS.md §2). Scanning
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
  const code = (x) => `\`${x}\``;
  const lines = [frontmatter("Architecture Reference", "Module map, dependencies, runtime flows, pipeline and messaging — extracted from the code.", "Architecture", 2)];
  lines.push(
    "Ports & Adapters: dependencies point toward the core. Each module has one **role** — one ring of the hexagon, outermost first — read from the code by the rule beside it.\n",
    "| Role | Rule | Modules |",
    "|:---|:---|:---|",
  );
  for (const r of a.roles) {
    const ms = a.modules.filter((m) => m.role === r.id).map((m) => code(m.id));
    lines.push(`| **${r.title}** | ${r.rule} | ${ms.join(", ") || "—"} |`);
  }
  lines.push("\n## Modules\n", "| Module | Role | Repository | Version | Inbound ports | Outbound ports |", "|:---|:---|:---|:---|:---|:---|");
  for (const m of a.modules) {
    lines.push(`| ${code(m.id)} | ${m.role} | ${code(m.repository)} | ${m.version ?? "—"} | ${m.ports.inbound.join(", ") || "—"} | ${m.ports.outbound.join(", ") || "—"} |`);
  }
  lines.push("\n## Dependencies\n", "Build dependencies between the modules above (test scope excluded): who packages whom.\n", "| Module | Depends on |", "|:---|:---|");
  for (const m of a.modules) {
    const to = a.dependencies.filter((d) => d.from === m.id).map((d) => code(d.to) + (d.scope ? ` (${d.scope})` : ""));
    if (to.length) lines.push(`| ${code(m.id)} | ${to.join(", ")} |`);
  }
  lines.push(
    "\n## Runtime flows\n",
    "Who calls whom while the platform runs: HTTP (UI defaults, the edge route table, the typed clients a service packages) and AMQP (a published routing key that reaches a queue).\n",
    "| From | To | Kind | Via |",
    "|:---|:---|:---|:---|",
  );
  for (const f of a.flows) lines.push(`| ${code(f.from)} | ${code(f.to)} | ${f.kind} | ${code(f.via)}${f.routingKey ? ` (${code(f.routingKey)})` : ""} |`);
  lines.push("\n## Interceptor pipeline\n", "**Phase 1 — core chain** (fixed in code, non-bypassable, ADR-051)\n", "| # | Interceptor | Concern |", "|:--|:---|:---|");
  for (const c of a.coreChain) lines.push(`| ${c.rank} | ${code(c.interceptor)} | ${c.concern ?? "—"} |`);
  lines.push("\n**Phase 2 — configured chain** (order and switch in `pipeline_interceptor_config`)\n", "| Order | Interceptor | Enabled | Implemented |", "|:--|:---|:--|:--|");
  for (const p of a.pipeline.filter((x) => x.phase === "dynamic")) lines.push(`| ${p.order} | ${code(p.interceptor)} | ${p.enabled ? "✅" : "—"} | ${p.implemented ? "✅" : "⚠ no class"} |`);
  const r = a.messaging.retry;
  lines.push(
    "\n## Messaging topology (AGENTS.md §6)\n",
    "**Exchanges**\n",
    ...a.messaging.exchanges.map((e) => `- ${code(e.name)} (${e.type})`),
    "",
    `**Retry, then dead letter** — a listener on the kit's container (${code(r.module)}, ${code(r.property)}) runs up to ${r.maxAttempts} times, ` +
      `waiting ${r.initialMs} ms ×${r.multiplier} up to ${r.maxMs / 1000} s, then the message goes to ${code("<queue>.dlq")}.`,
  );
  lines.push("\n**Queues**\n", "| Queue | Exchange | Binding | DLQ | Declared by | Consumed by |", "|:---|:---|:---|:---|:---|:---|");
  for (const q of a.messaging.queues) {
    const by = a.messaging.consumers.filter((c) => c.queue === q.name).map((c) => code(c.module) + (c.retry === "kit" ? "" : " (own retry)"));
    lines.push(`| ${code(q.name)} | ${code(q.exchange)} | ${q.binding ? code(q.binding) : "—"} | ${q.dlq ? code(q.dlq) : "—"} | ${code(q.declaredBy)} | ${by.join(", ") || "—"} |`);
  }
  lines.push("\n**Producers**\n", "| Module | Exchange | Routing key |", "|:---|:---|:---|");
  for (const p of a.messaging.producers) lines.push(`| ${code(p.module)} | ${code(p.exchange)} | ${code(p.routingKey)} |`);
  lines.push("\n**Capability routes** (`orazaka_capabilities`: where a job of each capability is published)\n", "| Capability | Handler | Routing key |", "|:---|:---|:---|");
  for (const c of a.messaging.capabilityRoutes) lines.push(`| ${code(c.feature)} | ${c.handler ? code(c.handler) : "—"} | ${code(c.routingKey)} |`);
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
