// node --test scripts/test — where the dev tools read their secrets: an explicit file, or secret.sh @dev (never a hard-coded path).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { devSecrets, envFileFromArgs } from "../lib/dev-secrets.mjs";

test("--env-file is taken out of the arguments and wins over ORAZAKA_DEV_ENV_FILE", () => {
  assert.deepEqual(envFileFromArgs(["apply", "orazaka-dev", "--env-file", "/x/dev.env", "--dry-run"], { ORAZAKA_DEV_ENV_FILE: "/y" }), {
    envFile: "/x/dev.env",
    args: ["apply", "orazaka-dev", "--dry-run"],
  });
  assert.deepEqual(envFileFromArgs(["data"], { ORAZAKA_DEV_ENV_FILE: "/y" }), { envFile: "/y", args: ["data"] });
  assert.deepEqual(envFileFromArgs(["data"], {}), { envFile: null, args: ["data"] });
  assert.throws(() => envFileFromArgs(["apply", "--env-file"], {}), /--env-file needs a path/);
});

test("with a file, the secrets are its lines; a missing file is named, never a value", () => {
  const dir = mkdtempSync(join(tmpdir(), "devsec-"));
  const file = join(dir, "dev.env");
  writeFileSync(file, "# c\nDATABASE_HOST=db.example\nB=x=y\n");
  const env = devSecrets({ envFile: file });
  assert.equal(env.DATABASE_HOST, "db.example");
  assert.equal(env.B, "x=y");
  assert.equal(env.NOPE, undefined);
  assert.throws(() => devSecrets({ envFile: join(dir, "absent.env") }), /no secrets file at .*absent\.env/);
});

test("without a file, each key is read through secret.sh @dev, once, and an empty answer is undefined", () => {
  const calls = [];
  const run = (tool, args) => {
    calls.push([tool, ...args]);
    return args[1] === "KNOWN" ? "v1\n" : "";
  };
  const env = devSecrets({ envFile: null, tool: "/t/secret.sh", run });
  assert.equal(env.KNOWN, "v1");
  assert.equal(env.KNOWN, "v1");
  assert.equal(env.UNKNOWN, undefined);
  assert.deepEqual(calls, [["/t/secret.sh", "@dev", "KNOWN"], ["/t/secret.sh", "@dev", "UNKNOWN"]]);
});

test("the settings overrides (CORE_REBUILD) come from the process environment first", () => {
  const env = devSecrets({ envFile: null, run: () => "from-tool", environ: { CORE_REBUILD: "stamp" }, overridable: ["CORE_REBUILD"] });
  assert.equal(env.CORE_REBUILD, "stamp");
  assert.equal(env.OTHER, "from-tool");
});
