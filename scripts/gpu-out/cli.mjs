#!/usr/bin/env node
/**
 * Mac / server side of the GPU output store (krizaka-internal#2121). A rented pod writes straight to the dedicated zone (the pod's
 * only storage credential); this tool reads from it through the port of @krizaka/storage and:
 *
 *   pod-env <run>            KEY=value lines for the pod's environment (read by scripts/lib/gpu-runpod.sh, never shown)
 *   list [prefix]                  what the zone holds
 *   promote <key> --to <cdn path>  a validated clip -> krizaka-assets through krizaka-com's scripts/cdn-assets.mjs (layout v2, hashed name)
 *   expire [--yes]                 delete the date folders older than the retention (dry run without --yes)
 *
 * Settings: infra/gpu/gpu-out.settings.json (the admin's storage fields; a credential is a vault name). Secrets: `secret.sh @orazaka`.
 * Env: KRIZAKA_COM_DIR (default ~/krizaka-com) and --env-file for cdn-assets.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clipKind, expiredDays, podEnvProblems, podOutputEnv, readSettings } from "../lib/gpu-out.mjs";
import { devSecrets } from "../lib/dev-secrets.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const settings = readSettings(readFileSync(join(here, "../../infra/gpu/gpu-out.settings.json"), "utf8"));
const secrets = devSecrets();
const today = () => new Date().toISOString().slice(0, 10);

async function openStore() {
  const { openProvider } = await import("@krizaka/storage/node");
  const opened = await openProvider(settings.provider, settings.coordinates, { accessKey: secrets[settings.credentialRef] }, {
    runtime: "dev", environment: "dev", fetch: globalThis.fetch, clock: { now: () => new Date() },
  });
  return opened.store;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "pod-env") {
  const [run] = args;
  const env = podOutputEnv(settings, secrets[settings.credentialRef], { day: today(), run });
  const problems = podEnvProblems(env, [secrets.MEDIA_STORAGE_API_KEY].filter(Boolean));
  if (problems.length) throw new Error(`gpu-out: ${problems.join("; ")}`);
  for (const [k, v] of Object.entries(env)) process.stdout.write(`${k}=${v}\n`);
} else if (cmd === "list") {
  for (const o of await (await openStore()).list(args[0] ?? "")) console.log(`${o.size}\t${o.key}`);
} else if (cmd === "promote") {
  const key = args[0];
  const to = args[args.indexOf("--to") + 1];
  if (!key || !to || args.indexOf("--to") < 0) throw new Error("promote <key> --to <cdn path, e.g. products/orazaka/tour/clip.mp4>");
  const got = await (await openStore()).get(key);
  if (!got) throw new Error(`gpu-out: ${key} is not in the zone`);
  const kind = clipKind(got.bytes);
  if (!kind) throw new Error(`gpu-out: ${key} is not a playable mp4/webm: not promoted`);
  const dir = mkdtempSync(join(tmpdir(), "gpu-out-"));
  const file = join(dir, basename(key));
  writeFileSync(file, got.bytes, { mode: 0o600 });
  const cdn = join(process.env.KRIZAKA_COM_DIR ?? join(homedir(), "krizaka-com"), "scripts/cdn-assets.mjs");
  const envFile = args.includes("--env-file") ? ["--env-file", args[args.indexOf("--env-file") + 1]] : [];
  const r = spawnSync("node", [cdn, "upload", file, "--to", to, ...envFile], { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else if (cmd === "expire") {
  const store = await openStore();
  const keys = (await store.list("")).map((o) => o.key);
  const days = expiredDays(keys, today(), settings.retentionDays);
  for (const day of days) {
    const old = keys.filter((k) => k.startsWith(`${day}/`));
    console.log(`${args.includes("--yes") ? "delete" : "would delete"} ${day}: ${old.length} object(s)`);
    if (args.includes("--yes")) for (const k of old) await store.delete(k);
  }
  if (!days.length) console.log(`nothing older than ${settings.retentionDays} days`);
} else {
  console.error("usage: gpu-out.mjs pod-env <run> | list [prefix] | promote <key> --to <path> | expire [--yes]");
  process.exit(2);
}
