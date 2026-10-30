#!/usr/bin/env node
/** Fails when the BOM (or orazaka-parent) names a com.krizaka version that neither the reactor nor Maven Central provides. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claims, explain, projectCoordinates, unprovided } from "./lib/krizaka-versions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : null);

/** artifactId -> version of every pom under a repository (node_modules and build output skipped). */
function builtArtifacts(dir, into = new Map()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !["node_modules", "target", ".git", "site"].includes(entry.name)) builtArtifacts(join(dir, entry.name), into);
    if (entry.isFile() && entry.name === "pom.xml") {
      const { artifactId, version } = projectCoordinates(readFileSync(join(dir, entry.name), "utf8"));
      if (artifactId && version) into.set(artifactId, version);
    }
  }
  return into;
}

export async function check() {
  const manifest = JSON.parse(read("orazaka.workspace.json"));
  const built = new Map();
  for (const r of manifest.repositories.filter((x) => x.layer === "krizaka" && x.kind === "maven")) {
    if (existsSync(join(ROOT, r.path))) builtArtifacts(join(ROOT, r.path), built);
  }
  const bom = read("krizaka/krizaka-build/krizaka-bom/pom.xml");
  const parent = read("orazaka-libs/orazaka-build/orazaka-parent/pom.xml");
  if (!bom || !parent) return [];
  return unprovided(claims({ bom, parent, built }));
}

const missing = await check();
for (const c of missing) console.error(`::error::${explain(c)}`);
if (missing.length) process.exit(1);
console.log("Every com.krizaka version the workspace imports is built here or on Maven Central.");
