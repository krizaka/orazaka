// node --test scripts/test — the core container's supervisor (infra/deploy/run-services.sh).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../infra/deploy/run-services.sh", import.meta.url));

/** Runs bash with the script in library mode, then `body`. */
function bash(body, timeout = 15000) {
  return spawnSync("bash", ["-c", `RUN_SERVICES_LIB=1 source "${script}"; ${body}`], {
    encoding: "utf8",
    timeout,
    env: { ...process.env, ORAZAKA_WORKER_BACKOFF_START: "1", ORAZAKA_WORKER_BACKOFF_MAX: "2" },
  });
}

test("library mode defines the supervisor and starts nothing", () => {
  const r = bash("type supervise >/dev/null && echo defined");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "defined");
});

test("a failing worker is restarted with a doubling, capped backoff while the platform keeps running", () => {
  // The worker fails at once; the "JVM" (sleep 4) is what the container waits on — it must end normally.
  const r = bash(`
    log=$(mktemp); supervise flaky false > "$log" 2>&1 &
    sup=$!
    sleep 4 & jvm=$!
    wait -n $jvm; jvm_status=$?
    kill $sup; cat "$log"; rm -f "$log"
    echo "jvm=$jvm_status"`);
  const restarts = (r.stdout.match(/worker flaky exited \(status 1\)/g) ?? []).length;
  assert.ok(restarts >= 2, `restarted ${restarts}×:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /restarting in 1s/);
  assert.match(r.stdout, /restarting in 2s/);
  assert.doesNotMatch(r.stdout, /restarting in 4s/); // capped at ORAZAKA_WORKER_BACKOFF_MAX
  assert.match(r.stdout, /jvm=0/);
});
