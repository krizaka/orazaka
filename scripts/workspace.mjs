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
 *   node scripts/workspace.mjs ci <repository>          build its upstreams, then verify it
 *   node scripts/workspace.mjs publish <repository>     publish it (CI, on a v* tag): Maven → GitHub Packages, npm → npmjs
 *
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
    run("git", ["clone", ...(depth ? ["--depth", depth] : []), url, target]);
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

function ci(name) {
  const target = repo(name);
  const mavenUpstream = upstream(name).filter((r) => r.kind === "maven");

  if (target.kind === "maven") {
    for (const r of mavenUpstream) {
      run(MVNW, ["-B", "-ntp", "-f", join(r.path, "pom.xml"), "install", "-DskipTests"], { cwd: ROOT });
    }
    run(MVNW, ["-B", "-ntp", "-f", join(target.path, "pom.xml"), "verify"], { cwd: ROOT });
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
    return;
  }

  if (target.kind === "python") {
    const dir = join(ROOT, target.path);
    run("python3", ["-m", "pip", "install", "--quiet", "pytest", "pyyaml", "pika", "Pillow", "psutil"], { cwd: dir });
    run("python3", ["-m", "pytest", "-q", "test_capability_contract.py"], { cwd: dir });
    return;
  }

  if (target.kind === "packs") {
    // A pack is judged by the platform that installs it: the pack-bundle and catalogue rules of the
    // studio service, and the document-validation rule engine's own tests.
    for (const r of upstream("orazaka-studio").filter((x) => x.kind === "maven")) {
      run(MVNW, ["-B", "-ntp", "-f", join(r.path, "pom.xml"), "install", "-DskipTests"], { cwd: ROOT });
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
    run("python3", ["test_rules.py"], { cwd: join(ROOT, target.path, "document-validation", "worker") });
    return;
  }

  console.error(`No CI recipe for kind "${target.kind}"`);
  process.exit(2);
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
    run(MVNW, ["-B", "-ntp", "-f", join(target.path, "pom.xml"), "deploy", "-DskipTests"], { cwd: ROOT });
    return;
  }
  if (target.name === "orazaka-ui-kit") {
    run("npm", ["install", "--no-audit", "--no-fund"], { cwd: UI });
    for (const ws of npmWorkspaces(target)) run("npm", ["publish", `--workspace=${ws}`, "--access", "public", "--provenance"], { cwd: UI });
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
  case "publish":
    publish(args[0] ?? "");
    break;
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).join("\n"));
    process.exit(command ? 2 : 0);
}
