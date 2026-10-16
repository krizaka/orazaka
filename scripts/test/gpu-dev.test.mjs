// node --test scripts/test — the GPU host: what a droplet receives, and what it never does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../../", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const JWT = "j".repeat(48);

function render(profile) {
  const dir = mkdtempSync(join(tmpdir(), "gpu-dev-"));
  const env = join(dir, "orazaka-dev.env");
  writeFileSync(
    env,
    [
      `IDENTITY_JWT_SECRET=${JWT}`,
      "RABBITMQ_PASS_GPU=rabbit-secret-value",
      `RABBITMQ_CA_CERT_BASE64=${Buffer.from("-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n").toString("base64")}`,
      "AI_GPU_RELAY_PASSWORD=relay-secret-value-0123456789abcdef",
      "GPU_WATCHDOG_DO_TOKEN=dop_v1_watchdog",
    ].join("\n"),
  );
  const out = join(dir, "user-data.yaml");
  execFileSync("bash", [join(root, "scripts/gpu-dev.sh"), "user-data", profile, out], {
    env: { ...process.env, ORAZAKA_DEV_ENV_FILE: env, GPU_REGIONS: "tor1" },
  });
  const text = readFileSync(out, "utf8");
  const files = {};
  for (const m of text.matchAll(/- path: (\S+)\n\s+encoding: b64\n\s+permissions: '(\d+)'\n\s+owner: \S+\n\s+content: (\S+)/g)) {
    files[m[1]] = { mode: m[2], content: Buffer.from(m[3], "base64").toString() };
  }
  return { text, files, mode: statSync(out).mode & 0o777 };
}

test("user-data: the host scripts are the repository's, secrets are 0600 and the identity secret never leaves", () => {
  const { text, files, mode } = render("big");
  assert.equal(mode, 0o600);
  assert.match(text, /^#cloud-config\n/);
  assert.equal(files["/opt/orazaka-gpu/host.sh"].content, read("infra/gpu/host.sh"));
  assert.equal(files["/opt/orazaka-gpu/watchdog.sh"].content, read("infra/gpu/watchdog.sh"));
  for (const secret of ["/etc/orazaka-gpu/worker.env", "/etc/orazaka-gpu/relay.env", "/etc/orazaka-gpu/do-token"]) {
    assert.equal(files[secret].mode, "0600", secret);
  }
  assert.ok(!text.includes(JWT) && !Object.values(files).some((f) => f.content.includes(JWT)));
  assert.match(files["/etc/orazaka-gpu/host.env"].content, /^PROFILE=big$/m);
  assert.match(files["/etc/orazaka-gpu/host.env"].content, /^VOLUME_NAME=orazaka-gpu-models-tor1$/m);
  assert.match(files["/etc/orazaka-gpu/host.env"].content, /^IDLE_MINUTES=30$/m);
  assert.match(files["/etc/orazaka-gpu/relay.env"].content, /^AUTH=gpu:relay-secret-value/);
  // The narrow broker user, never the platform's; the dev CA to verify the broker with.
  assert.match(files["/etc/orazaka-gpu/worker.env"].content, /^SPRING_RABBITMQ_USERNAME=gpu-worker$/m);
  assert.match(files["/etc/orazaka-gpu/broker-ca.pem"].content, /BEGIN CERTIFICATE/);
  assert.match(text, /ufw allow from 127\.0\.0\.1 to any port 22/);
});

test("user-data: the worker's SERVICE token is signed, scoped to SERVICE, and expires with the droplet", () => {
  const { files } = render("small");
  const token = files["/etc/orazaka-gpu/worker.env"].content.match(/^ORAZAKA_SERVICE_TOKEN=(\S+)$/m)[1];
  const [h, p, s] = token.split(".");
  assert.equal(createHmac("sha256", JWT).update(`${h}.${p}`).digest("base64url"), s);
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(claims.roles, ["SERVICE"]);
  const hours = (claims.exp - claims.iat) / 3600;
  assert.ok(hours > 8 && hours <= 9, `token lives ${hours} h`);
  assert.match(files["/etc/orazaka-gpu/host.env"].content, /^IMAGE_OFFLOAD=true$/m); // small shares 20 GB
});

test("the droplet opens no port but SSH from the caller, and reaches the platform only through the relay", () => {
  const host = read("infra/gpu/host.sh");
  assert.doesNotMatch(host, /\s-p\s+\d+:\d+/, "no published port");
  assert.match(host, /iptables -I DOCKER-USER -d 169\.254\.169\.254 -j DROP/);
  assert.match(host, /client .*"\$RELAY_URL"[\s\S]*0\.0\.0\.0:5671:broker-dev\.orazaka\.com:5671 0\.0\.0\.0:8090:core:8090[\s\S]*R:0\.0\.0\.0:8086:sd-server:8086 R:0\.0\.0\.0:8188:worker:8188 R:0\.0\.0\.0:11434:ollama:11434/);
  // A private registry never blocks a start: the image is built once per worker commit and kept on the volume.
  assert.match(host, /docker pull -q "\$WORKER_IMAGE"[\s\S]*docker load -q -i[\s\S]*docker build -q -f "\$src\/Dockerfile\.cuda"[\s\S]*docker save/);
  // The watchdog is armed before anything that can fail.
  assert.ok(host.indexOf("orazaka-gpu-watchdog.timer") < host.indexOf("--name orazaka-fetch"));
});

test("the watchdog destroys (never powers off) on idle, lifetime or a stuck setup", () => {
  const wd = read("infra/gpu/watchdog.sh");
  assert.match(wd, /-X DELETE[\s\S]*\/v2\/droplets\/\$\{id\}/);
  assert.doesNotMatch(wd, /power_?off|shutdown|halt/i);
  assert.match(wd, /IDLE_MINUTES="\$\{IDLE_MINUTES:-30\}"/);
  for (const reason of ["idle for", "lifetime of", "setup unfinished"]) assert.ok(wd.includes(reason), reason);
});

test("gpu-dev.sh: stop always destroys, and the sizes are the stated ones", () => {
  const script = read("scripts/gpu-dev.sh");
  assert.match(script, /doctl compute droplet delete \$ids --force/);
  // The GPU image takes no root password: the droplet is created with this machine's SSH key.
  assert.match(script, /--ssh-keys "\$fingerprint"/);
  assert.doesNotMatch(script, /power-?off|droplet-action shutdown/);
  assert.match(script, /big\) echo "gpu-l40sx1-48gb:1\.57 gpu-6000adax1-48gb:1\.57"/);
  assert.match(script, /small\) echo "gpu-4000adax1-20gb:0\.76"/);
});

// RunPod spend guard (ADR-078): the rule alone, on fixtures — no network, no key.
function decide(fixture) {
  const dir = mkdtempSync(join(tmpdir(), "runpod-guard-"));
  const file = join(dir, "fixture.json");
  writeFileSync(file, JSON.stringify(fixture));
  return JSON.parse(execFileSync("python3", [join(root, "scripts/runpod-guard.py"), "decide", file], { encoding: "utf8" }));
}

test("runpod guard: a busy pod is kept, an idle one is stopped after 20 minutes", () => {
  const busy = { id: "a", name: "busy", uptime: 3600, util: 80 };
  const idle = { id: "b", name: "idle", uptime: 3600, util: 0 };
  assert.deepEqual(decide({ now: 10_000, pods: [busy, idle], idle_since: { b: 10_000 - 19 * 60 } }), []);
  const stopped = decide({ now: 10_000, pods: [busy, idle], idle_since: { a: 0, b: 10_000 - 21 * 60 } });
  assert.deepEqual(stopped.map(([id]) => id), ["b"]);
});

test("runpod guard: a pod older than 6 hours is stopped even when busy", () => {
  const stopped = decide({ now: 1, pods: [{ id: "c", name: "old", uptime: 6 * 3600 + 1, util: 90 }] });
  assert.deepEqual(stopped.map(([id]) => id), ["c"]);
});

test("runpod guard: gpu-dev.sh routes `runpod` to the guard and the key never travels as an argument", () => {
  const script = read("scripts/gpu-dev.sh");
  assert.match(script, /runpod\)[\s\S]*runpod-guard\.py/);
  assert.doesNotMatch(read("scripts/runpod-guard.py"), /sys\.argv\[\d\].*key/i);
});
