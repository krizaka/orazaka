// node --test scripts/test — the core container's supervisor (infra/deploy/run-services.sh).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

test("a stopped container takes its worker down: SIGTERM ends the supervisor and the worker it supervises (no stray consumer)", () => {
  // (pgrep -f would match this very script on Linux, so the pattern is written so that it cannot match its own text.)
  // Before: the supervisor had no TERM handler, so the container's `wait` hung on it until the platform's SIGKILL, and the
  // worker kept consuming the broker's queue next to the new deployment's worker (orazaka validation queue, 2026-10-20).
  const r = bash(`
    n=31337; supervise w sleep $n > /dev/null 2>&1 &
    sup=$!
    sleep 1
    kill -TERM $sup
    for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 $sup 2>/dev/null || break; sleep 0.5; done
    kill -0 $sup 2>/dev/null && echo "supervisor-alive" || echo "supervisor-gone"
    for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "sleep 3133[7]" >/dev/null || break; sleep 0.2; done
    pgrep -f "sleep 3133[7]" >/dev/null && echo "worker-alive" || echo "worker-gone"
    pkill -f "sleep 3133[7]" 2>/dev/null; true`);
  assert.match(r.stdout, /supervisor-gone/, r.stdout + r.stderr);
  assert.match(r.stdout, /worker-gone/, r.stdout + r.stderr);
});

test("the container stops its supervised workers when it stops (stop_all signals them)", () => {
  const text = readFileSync(script, "utf8");
  assert.match(text, /workers\+=\("\$!"\)/);
  assert.match(text, /for pid in "\$\{pids\[@\]\}" "\$\{workers\[@\]\}"; do kill -TERM/);
});
