#!/usr/bin/env node
// Bundles the orazaka CLI into the app: installs the published @krizaka/orazaka-cli (the exact version pinned in
// package.json -> "orazakaCli") with its production dependencies into src-tauri/resources/cli, which Tauri copies to
// Contents/Resources/cli. The sidecar shim (src-tauri/binaries/orazaka-*) runs it with the Node.js found on the Mac.
// Offline afterwards: nothing is downloaded when the app runs.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.orazakaCli;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error('package.json needs an exact "orazakaCli" version');

const out = join(root, "src-tauri", "resources", "cli");
const marker = join(out, ".bundled-version");
if (existsSync(marker) && readFileSync(marker, "utf8").trim() === `${version}@node${process.versions.node.split(".")[0]}`) {
  console.log(`orazaka CLI ${version} already bundled`);
  process.exit(0);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({ name: "orazaka-desktop-cli", private: true, dependencies: { "@krizaka/orazaka-cli": version } }));
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", out], { stdio: "inherit" });
// Slim the bundle: sources, build trees, type declarations and source maps are not needed to run.
for (const rel of ["node_modules/better-sqlite3/deps", "node_modules/better-sqlite3/src", "node_modules/better-sqlite3/build/Release/obj", "node_modules/better-sqlite3/build/Release/.deps"]) {
  rmSync(join(out, rel), { recursive: true, force: true });
}
const prune = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) prune(p);
    else if (/\.(d\.ts|d\.cts|d\.mts|map)$/.test(e.name)) rmSync(p, { force: true });
  }
};
prune(join(out, "node_modules"));
// The native module (better-sqlite3) is built for this Node ABI: the shim prefers the same major at run time.
writeFileSync(join(out, ".node-major"), process.versions.node.split(".")[0]);
writeFileSync(marker, `${version}@node${process.versions.node.split(".")[0]}`);
// The packaged CLI must answer: refuse a bundle that cannot even print its version.
const printed = execFileSync(process.execPath, [join(out, "node_modules/@krizaka/orazaka-cli/dist/index.js"), "--version"], { encoding: "utf8", env: { ...process.env, ORAZAKA_SKIP_VERSION_CHECK: "1" } }).trim();
if (!printed.includes(version)) throw new Error(`bundled CLI printed "${printed}", expected ${version}`);
console.log(`orazaka CLI ${printed} bundled in ${out}`);
