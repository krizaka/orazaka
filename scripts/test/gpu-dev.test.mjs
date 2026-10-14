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
      "RABBITMQ_PASS=rabbit-secret-value",
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
  assert.match(host, /client .*"\$RELAY_URL"[\s\S]*0\.0\.0\.0:5672:rabbitmq:5672 0\.0\.0\.0:8090:core:8090[\s\S]*R:0\.0\.0\.0:8086:sd-server:8086 R:0\.0\.0\.0:8188:worker:8188/);
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
  assert.doesNotMatch(script, /power-?off|droplet-action shutdown/);
  assert.match(script, /big\) echo "gpu-l40sx1-48gb:1\.57 gpu-6000adax1-48gb:1\.57"/);
  assert.match(script, /small\) echo "gpu-4000adax1-20gb:0\.76"/);
});
