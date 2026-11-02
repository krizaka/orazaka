#!/usr/bin/env node
/**
 * Keeps the dev `core` image in step with the workspace's repositories (docs/DEPLOY_DEV.md § Redeploy).
 *
 * `core` is built from krizaka/orazaka's Dockerfile, which clones every component's main at build time: a merge to a component
 * (or to the workspace) changes nothing App Platform watches, so `deploy_on_push` could never see it (and stays false). This
 * script (run by .github/workflows/dev-redeploy.yml every 15 minutes, or by hand) compares the newest commit on main of the
 * workspace and of every component with the last manual deployment, and starts `--force-rebuild` when one is newer.
 *
 *   node scripts/dev-redeploy.mjs [--dry-run]     # needs an authenticated doctl (the workflow logs it in with OPERATOR_DEPLOY_TOKEN) and gh (GH_TOKEN, public reads)
 *
 * It only starts a deployment, never changes the spec, and does nothing while a deployment is building.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = "orazaka-dev";
const BUSY = new Set(["PENDING_BUILD", "BUILDING", "PENDING_DEPLOY", "DEPLOYING"]);

/**
 * @param {{ deployments: {created_at: string, cause: string, phase: string}[], heads: Record<string, string> }} state
 *   deployments newest first; heads = repository → ISO date of the newest commit on main
 * @returns {{ redeploy: boolean, reason: string, newer: string[] }}
 */
export function decide({ deployments, heads }) {
  if (deployments.some((d) => BUSY.has(d.phase))) return { redeploy: false, reason: "a deployment is in progress", newer: [] };
  const last = deployments.find((d) => /manual/i.test(d.cause) && d.phase !== "ERROR" && d.phase !== "CANCELED");
  if (!last) return { redeploy: true, reason: "no manual deployment on record", newer: Object.keys(heads) };
  const since = Date.parse(last.created_at);
  const newer = Object.entries(heads).filter(([, at]) => Date.parse(at) > since).map(([repo]) => repo).sort();
  return newer.length
    ? { redeploy: true, reason: `${newer.join(", ")} moved after the last rebuild (${last.created_at})`, newer }
    : { redeploy: false, reason: "core is up to date", newer: [] };
}

/**
 * A rollback must never go unnoticed (2026-10-29: dev ran an old image for hours after two failed deployments, "automated
 * rollback after failed deployment", so merged packs and fixes were not live). Fails when the ACTIVE deployment is an automated
 * rollback, or when a newer deployment than the active one ended in ERROR.
 * @param {{ id: string, created_at: string, cause: string, phase: string }[]} deployments newest first
 * @returns {{ ok: boolean, message: string }}
 */
export function rollbackVerdict(deployments) {
  const active = deployments.find((d) => d.phase === "ACTIVE");
  if (!active) return { ok: false, message: "no ACTIVE deployment" };
  if (/rollback/i.test(active.cause)) {
    const failed = /"([0-9a-f-]{36})"/.exec(active.cause)?.[1] ?? "unknown";
    return { ok: false, message: `dev runs an automated rollback (${active.id}); the deployment ${failed} failed: read its logs (doctl apps logs <app> core --deployment ${failed} --type deploy)` };
  }
  const failedAfter = deployments.find((d) => d.phase === "ERROR" && Date.parse(d.created_at) > Date.parse(active.created_at));
  if (failedAfter) return { ok: false, message: `deployment ${failedAfter.id} failed after the active one (${active.id})` };
  return { ok: true, message: `the active deployment ${active.id} is the latest` };
}

/**
 * "app spec updated" (and a spec apply in general) redeploys the commit App Platform already had, not main's head: on 2026-11-01 three
 * builds in a row compiled the commit BEFORE the fix that would have made them pass. Fails when the newest finished deployment's `core`
 * source commit is not the head of krizaka/orazaka main.
 * @param {{ id: string, phase: string, services?: {name: string, source_commit_hash?: string}[] }[]} deployments newest first
 * @param {string} mainSha head of krizaka/orazaka main
 * @returns {{ ok: boolean, message: string }}
 */
export function staleSourceVerdict(deployments, mainSha) {
  const coreCommit = (d) => d.services?.find((s) => s.name === "core")?.source_commit_hash;
  // A rebuild just started (the redeploy step runs right before this check) is the cure: judge it when it ends.
  if (deployments.some((d) => BUSY.has(d.phase))) return { ok: true, message: "a deployment is in progress; the commit is judged once it ends" };
  const last = deployments.find((d) => !BUSY.has(d.phase) && coreCommit(d));
  const built = last && coreCommit(last);
  if (!last || !built) return { ok: true, message: "no finished deployment with a recorded source commit" };
  if (mainSha.startsWith(built) || built.startsWith(mainSha)) return { ok: true, message: `core was built from main's head (${built.slice(0, 7)})` };
  return { ok: false, message: `deployment ${last.id} built core from ${built.slice(0, 7)}, behind main (${mainSha.slice(0, 7)}): a spec apply reuses the old commit, start doctl apps create-deployment <app> --force-rebuild` };
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });

function main(dryRun, check) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "orazaka.workspace.json"), "utf8"));
  const repos = ["orazaka", ...manifest.repositories.map((r) => r.name)];
  const heads = {};
  for (const repo of repos) {
    heads[repo] = JSON.parse(run("gh", ["api", `repos/${manifest.org}/${repo}/commits/main`, "--jq", "{d: .commit.committer.date}"])).d;
  }
  const apps = JSON.parse(run("doctl", ["apps", "list", "-o", "json"]));
  const id = apps.find((a) => a.spec?.name === APP)?.id;
  if (!id) throw new Error(`no app ${APP}`);
  const deployments = JSON.parse(run("doctl", ["apps", "list-deployments", id, "-o", "json"]));
  if (check) {
    const v = rollbackVerdict(deployments);
    console.log(`${APP}: ${v.message}`);
    if (!v.ok) process.exitCode = 1;
    const mainSha = run("gh", ["api", `repos/${manifest.org}/orazaka/commits/main`, "--jq", ".sha"]).trim();
    const stale = staleSourceVerdict(deployments, mainSha);
    console.log(`${APP}: ${stale.message}`);
    if (!stale.ok) process.exitCode = 1;
    return;
  }
  const verdict = decide({ deployments, heads });
  console.log(`${APP}: ${verdict.reason}`);
  if (!verdict.redeploy || dryRun) return;
  run("doctl", ["apps", "create-deployment", id, "--force-rebuild", "--format", "ID", "--no-header"]);
  console.log(`${APP}: rebuild started`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.includes("--dry-run"), process.argv.includes("--check"));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
