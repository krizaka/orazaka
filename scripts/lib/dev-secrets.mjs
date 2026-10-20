/**
 * Where the dev tools read their secrets (the company folder was restructured on 2026-10-18: `env/dev.env`,
 * `env/org.env`, resolved by `~/.krizaka-worktrees/tools/secret.sh @dev KEY` through `secrets.map`).
 *
 *   --env-file <path> (or ORAZAKA_DEV_ENV_FILE)   one KEY=value file, read whole
 *   nothing                                        each key asked to `secret.sh @dev KEY` (dev.env, then org.env), on demand
 *
 * A value is never printed and never put on a command line: the tool answers on stdout, read here.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SECRET_TOOL = join(homedir(), ".krizaka-worktrees/tools/secret.sh");

/** KEY=value lines; comments and blanks skipped, `=` kept in values. */
export function readEnvFile(text) {
  const env = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

/** Takes `--env-file <path>` out of the arguments; the variable ORAZAKA_DEV_ENV_FILE is the fallback. */
export function envFileFromArgs(argv, environ = process.env) {
  const args = [...argv];
  const i = args.indexOf("--env-file");
  let envFile = environ.ORAZAKA_DEV_ENV_FILE || null;
  if (i >= 0) {
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("--env-file needs a path");
    envFile = args[i + 1];
    args.splice(i, 2);
  }
  return { envFile, args };
}

function runTool(tool, args) {
  const r = spawnSync(tool, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout : "";
}

/**
 * The secrets as an object read by key (`env.DATABASE_HOST`): a file's lines, or `secret.sh @dev <KEY>` per key.
 * @param {{ envFile?: string|null, tool?: string, run?: (tool: string, args: string[]) => string, environ?: object, overridable?: string[] }} [options]
 */
export function devSecrets({ envFile = null, tool = SECRET_TOOL, run = runTool, environ = process.env, overridable = [] } = {}) {
  if (envFile) {
    if (!existsSync(envFile)) throw new Error(`no secrets file at ${envFile}`);
    const fromFile = readEnvFile(readFileSync(envFile, "utf8"));
    return new Proxy(fromFile, {
      get: (target, key) => (typeof key === "string" && overridable.includes(key) && environ[key] ? environ[key] : target[key]),
    });
  }
  const cache = new Map();
  return new Proxy({}, {
    get: (_, key) => {
      if (typeof key !== "string") return undefined;
      if (overridable.includes(key) && environ[key]) return environ[key];
      if (!cache.has(key)) {
        const value = run(tool, ["@dev", key]).replace(/\r?\n$/, "");
        cache.set(key, value === "" ? undefined : value);
      }
      return cache.get(key);
    },
    set: (_, key, value) => (cache.set(String(key), value), true),
  });
}
