#!/usr/bin/env node
/**
 * The Orazaka workspace tool: clones, inspects, updates and builds every repository listed in
 * orazaka.workspace.json, at its workspace path. Node only — no shell scripts (AGENTS.md §1,
 * ERR-125) — so it runs the same on macOS, Linux and in CI.
 *
 *   node scripts/workspace.mjs list                     the repositories, in build order
 *   node scripts/workspace.mjs clone [--ssh] [--depth N] [--only a,b]
 *                                                       clone what is missing
 *   node scripts/workspace.mjs status                   branch / dirty / ahead-behind of each
 *   node scripts/workspace.mjs pull                     fast-forward every clean repository
 *   node scripts/workspace.mjs deps <repository>        its upstream repositories, in build order
 *   node scripts/workspace.mjs upstreams <repository>   install its Maven upstreams, tests skipped (a coding agent's setup)
 *   node scripts/workspace.mjs ci <repository>          build its upstreams, then verify it
 *   node scripts/workspace.mjs publish <repository>     publish it (CI, on a v* tag): Maven → GitHub Packages, npm → npmjs
 *
 * `ci` first runs scripts/check-krizaka-versions.mjs (every com.krizaka version the BOM names is built here or on Central).
 * `ci` is what every repository's GitHub Actions workflow runs (.github/workflows/component.yml):
 * a component is always verified inside the workspace, against its upstreams built from source.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "orazaka.workspace.json"), "utf8"));
const REPOS = MANIFEST.repositories;
const byName = new Map(REPOS.map((r) => [r.name, r]));
const isWindows = process.platform === "win32";
const MVNW = join(ROOT, isWindows ? "mvnw.cmd" : "mvnw");
const UI = join(ROOT, "orazaka-apps", "ui");
/** The pnpm the self-contained UI member is installed with (same as apps/desktop in desktop.yml). */
const PNPM = "pnpm@12.10.1";

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${[cmd, ...args].join(" ")}${opts.cwd ? `   (in ${opts.cwd})` : ""}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: isWindows, ...opts });
  if (result.status !== 0) {
    console.error(`✗ ${cmd} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function capture(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: isWindows });
  return result.status === 0 ? result.stdout.trim() : null;
}

function repo(name) {
  const r = byName.get(name);
  if (!r) {
    console.error(`Unknown repository "${name}". Known: ${REPOS.map((x) => x.name).join(", ")}`);
    process.exit(2);
  }
  return r;
}

function option(args, flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

/** Transitive upstream repositories of `name`, in manifest (= build) order. */
function upstream(name) {
  const seen = new Set();
  const visit = (n) => {
    for (const d of repo(n).dependsOn) {
      if (!seen.has(d)) {
        seen.add(d);
        visit(d);
      }
    }
  };
  visit(name);
  return REPOS.filter((r) => seen.has(r.name));
}

function list() {
  for (const r of REPOS) {
    const present = existsSync(join(ROOT, r.path, ".git")) ? "✓" : "·";
    console.log(`${present} ${r.name.padEnd(30)} ${r.kind.padEnd(7)} ${r.path}`);
  }
}

function clone(args) {
  const ssh = args.includes("--ssh");
  const depth = option(args, "--depth");
  const only = option(args, "--only")?.split(",");
  for (const r of REPOS) {
    if (only && !only.includes(r.name)) continue;
    const target = join(ROOT, r.path);
    if (existsSync(join(target, ".git"))) {
      console.log(`✓ ${r.name} already cloned`);
      continue;
    }
    const url = ssh
      ? `git@github.com:${MANIFEST.org}/${r.name}.git`
      : `https://github.com/${MANIFEST.org}/${r.name}.git`;
    const shallow = depth ? ["--depth", depth] : [];
    // A repository may name a `ref` (a branch) while its change and the workspace's must land together
    // (a lock that follows a migration). Once the branch is merged and deleted, the default branch is cloned.
    if (r.ref) {
      const taken = spawnSync("git", ["clone", ...shallow, "--branch", r.ref, url, target], { stdio: "inherit" });
      if (taken.status === 0) continue;
      console.warn(`· ${r.name}: branch ${r.ref} is gone, cloning the default branch`);
    }
    run("git", ["clone", ...shallow, url, target]);
  }
}

function status() {
  for (const r of REPOS) {
    const dir = join(ROOT, r.path);
    if (!existsSync(join(dir, ".git"))) {
      console.log(`· ${r.name.padEnd(30)} not cloned`);
      continue;
    }
    const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], dir);
    const dirty = capture("git", ["status", "--porcelain"], dir);
    const counts = capture("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], dir);
    const [behind, ahead] = counts ? counts.split(/\s+/) : ["?", "?"];
    console.log(
      `${dirty ? "✎" : "✓"} ${r.name.padEnd(30)} ${String(branch).padEnd(12)} ↑${ahead} ↓${behind}${dirty ? "  (uncommitted changes)" : ""}`,
    );
  }
}

function pull() {
  for (const r of REPOS) {
    const dir = join(ROOT, r.path);
    if (!existsSync(join(dir, ".git"))) continue;
    if (capture("git", ["status", "--porcelain"], dir)) {
      console.log(`✎ ${r.name}: uncommitted changes — skipped`);
      continue;
    }
    run("git", ["pull", "--ff-only"], { cwd: dir });
  }
}

/** The npm workspace names a UI repository provides. */
function npmWorkspaces(r) {
  return r.name === "orazaka-ui-kit"
    ? ["@krizaka/orazaka-shared", "@krizaka/orazaka-design-system"]
    : [r.name];
}

/**
 * An upstream is built to be installed, not tested: its own CI runs its tests. `-DskipTests` alone still runs the
 * Failsafe integration tests (Testcontainers: 30-90 s per upstream repository), so both flags are always given together
 * (scripts/test/workspace-ci.test.mjs).
 */
const SKIP_TESTS = ["-DskipTests", "-DskipITs"];

/** Installs a Maven component's upstreams into the local repository, tests skipped: what a component needs before it builds alone. */
function upstreams(name) {
  for (const r of upstream(name).filter((x) => x.kind === "maven")) {
    run(MVNW, ["-B", "-ntp", "-f", join(r.path, "pom.xml"), "install", ...SKIP_TESTS], { cwd: ROOT });
  }
}

/**
 * The formatter rule (krizaka/.github#427): a component repository that carries a `format:check` script (Prettier with
 * `@krizaka/config/prettier`) is checked here too, so an unformatted change cannot reach the workspace through a member.
 */
function formatCheck(target) {
  const dir = join(ROOT, target.path);
  const file = join(dir, "package.json");
  if (!existsSync(file) || !JSON.parse(readFileSync(file, "utf8")).scripts?.["format:check"]) return;
  if (target.packageManager === "pnpm") run("npx", ["-y", PNPM, "--dir", dir, "run", "format:check"], { cwd: ROOT });
  else run("npm", ["run", "format:check"], { cwd: dir });
}

function ci(name) {
  const target = repo(name);

  if (target.kind === "maven") {
    // Before any build: a com.krizaka version that neither a cloned repository nor Maven Central provides fails here, by name.
    run("node", [join(ROOT, "scripts", "check-krizaka-versions.mjs")], { cwd: ROOT });
    upstreams(name);
    run(MVNW, ["-B", "-ntp", "-f", join(target.path, "pom.xml"), "verify"], { cwd: ROOT });
    // A skipped integration test is green in Failsafe: fail it here, and print the count (orazaka-studio#98).
    run("node", [join(ROOT, "scripts", "check-skipped-tests.mjs"), join(ROOT, target.path), name], { cwd: ROOT });
    return;
  }

  if (target.kind === "npm" && target.packageManager === "pnpm") {
    // Self-contained member: its own pnpm-lock.yaml pins its dependencies (orazaka-apps/ui/package-lock.json does not),
    // so a bump of @krizaka/ui there never waits for a lock here. Installed from the registry, frozen.
    // The member's own tests (incl. krizaka-deps) run here, in ITS pull requests; the workspace job only builds it (check:web).
    run("npm", ["run", "validate:web"], { cwd: UI });
    run("npx", ["-y", PNPM, "--dir", target.path, "run", "build"], { cwd: ROOT });
    formatCheck(target);
    return;
  }

  if (target.kind === "npm") {
    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: UI });
    run("npm", ["run", "build:shared"], { cwd: UI });
    for (const ws of npmWorkspaces(target)) {
      const pkg = JSON.parse(
        readFileSync(join(ROOT, target.path, ws.startsWith("@") ? ws.split("/")[1] : "", "package.json"), "utf8"),
      );
      const script = pkg.scripts?.validate ? "validate" : pkg.scripts?.lint ? "lint" : null;
      if (script) run("npm", ["run", script, `--workspace=${ws}`], { cwd: UI });
      if (pkg.scripts?.build && ws !== "@krizaka/orazaka-shared") {
        run("npm", ["run", "build", `--workspace=${ws}`], { cwd: UI });
      }
    }
    formatCheck(target);
    return;
  }

  if (target.kind === "python") {
    const dir = join(ROOT, target.path);
    run("python3", ["-m", "pip", "install", "--quiet", "pytest", "pyyaml", "pika", "Pillow", "psutil", "cryptography", "numpy"], { cwd: dir });
    run("python3", ["-m", "pytest", "-q", "test_capability_contract.py"], { cwd: dir });
    // The CUDA host's own suites (ADR-077, ADR-080) — each run once the worker carries it: the GPU runtime, image to
    // video (the I2V A14B of a cinematic short) and the cut. The cut's ffmpeg test skips itself where ffmpeg lacks drawtext.
    // A film's sound and text (orazaka#289): the foley, the mix and its loudness contract, the titles, the voice direction,
    // the deliverables.
    for (const suite of ["test_gpu_runtime.py", "test_image_to_video.py", "test_cut.py", "test_deliver.py", "test_foley.py",
      "test_mixer.py", "test_titles.py", "test_voice_direction.py"]) {
      if (existsSync(join(dir, suite))) run("python3", ["-m", "pytest", "-q", suite], { cwd: dir });
    }
    return;
  }

  if (target.kind === "packs") {
    // A pack is judged by the platform that installs it: the pack-bundle and catalogue rules of the
    // studio service, and the document-validation rule engine's own tests.
    for (const r of upstream("orazaka-studio").filter((x) => x.kind === "maven")) {
      run(MVNW, ["-B", "-ntp", "-f", join(r.path, "pom.xml"), "install", ...SKIP_TESTS], { cwd: ROOT });
    }
    run(
      MVNW,
      [
        "-B",
        "-ntp",
        "-f",
        join(byName.get("orazaka-studio").path, "pom.xml"),
        "install",
        "-Dtest=PackBundleResolverTest,BlueprintFitnessTest",
        "-Dsurefire.failIfNoSpecifiedTests=false",
        "-DskipITs",
      ],
      { cwd: ROOT },
    );
    const validationWorker = join(ROOT, target.path, "document-validation", "worker");
    run("python3", ["test_rules.py"], { cwd: validationWorker });
    // The broker connection (TLS to the dev broker) — the worker's one third-party import here is pika.
    run("python3", ["-m", "pip", "install", "--quiet", "pika==1.4.4", "pyyaml==6.0.3"], { cwd: validationWorker });
    // The broker connection is shared by every worker (worker-common/, tested once) and the validation worker's own screening tests;
    // a packs revision from before that factoring still carries test_broker.py.
    if (existsSync(join(validationWorker, "test_screening.py"))) {
      run("python3", ["test_screening.py"], { cwd: validationWorker });
      run("python3", ["test_worker_broker.py"], { cwd: join(ROOT, target.path, "worker-common") });
    } else {
      run("python3", ["test_broker.py"], { cwd: validationWorker });
    }
    return;
  }

  console.error(`No CI recipe for kind "${target.kind}"`);
  process.exit(2);
}

/** True when `<workspace>@<its package.json version>` is already on the npm registry (a re-run never fails on it). */
function isPublished(ws) {
  const version = capture("npm", ["pkg", "get", "version", `--workspace=${ws}`, "--json"], UI);
  const local = version ? Object.values(JSON.parse(version))[0] : null;
  return local !== null && capture("npm", ["view", `${ws}@${local}`, "version", "--prefer-online"], UI) === local;
}

/**
 * Publishes a component: its Maven modules to GitHub Packages (maven.pkg.github.com/<org>/<repo>,
 * orazaka-parent's distributionManagement), the @krizaka/* packages of the UI kit to the public npm registry with
 * provenance (installable by anyone without a token). Applications, workers and packs are not libraries: nothing to
 * publish. Expects the credentials CI provides (settings.xml server "github"; npm trusted publishing over OIDC).
 */
function publish(name) {
  const target = repo(name);
  if (target.kind === "maven") {
    run(MVNW, ["-B", "-ntp", "-f", join(target.path, "pom.xml"), "deploy", ...SKIP_TESTS], { cwd: ROOT });
    return;
  }
  if (target.name === "orazaka-ui-kit") {
    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: UI });
    for (const ws of npmWorkspaces(target)) {
      if (isPublished(ws)) {
        console.log(`${ws} is already on npm at this version — skipped.`);
        continue;
      }
      run("npm", ["publish", `--workspace=${ws}`, "--access", "public", "--provenance"], { cwd: UI });
    }
    return;
  }
  if (target.name === "orazaka-cli") {
    // @krizaka/orazaka-cli first: its `orazaka` alias (alias/) depends on that exact version on the registry.
    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: UI });
    const dir = join(ROOT, target.path);
    for (const pkgDir of [dir, join(dir, "alias")]) {
      const { name: pkg, version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      if (capture("npm", ["view", `${pkg}@${version}`, "version", "--prefer-online"], pkgDir) === version) {
        console.log(`${pkg}@${version} is already on npm — skipped.`);
        continue;
      }
      run("npm", ["publish", "--access", "public", "--provenance"], { cwd: pkgDir });
    }
    return;
  }
  console.log(`${name} is a ${target.kind} application — nothing to publish.`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "list":
    list();
    break;
  case "clone":
    clone(args);
    break;
  case "status":
    status();
    break;
  case "pull":
    pull();
    break;
  case "deps":
    for (const r of upstream(args[0] ?? "")) console.log(r.name);
    break;
  case "ci":
    ci(args[0] ?? "");
    break;
  case "upstreams":
    upstreams(args[0] ?? "");
    break;
  case "publish":
    publish(args[0] ?? "");
    break;
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).join("\n"));
    process.exit(command ? 2 : 0);
}
