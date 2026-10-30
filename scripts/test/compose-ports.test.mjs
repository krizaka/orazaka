import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// orazaka#385: a second stack can run beside the first (a measurement stack, a second checkout, two products on one
// server) only when every container name and every published host port comes from the environment. The defaults are
// the values the running stacks already use, so nothing changes for them.
const compose = readFileSync(new URL("../../infra/docker-compose.yml", import.meta.url), "utf8");
const template = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

const TODAY = {
  POSTGRES_PORT: "5432", REDIS_PORT: "6379", RABBITMQ_PORT: "5672", RABBITMQ_MGMT_PORT: "15672", JAEGER_UI_PORT: "16686",
  OTLP_HTTP_PORT: "4318", MAILPIT_SMTP_PORT: "1025", MAILPIT_UI_PORT: "8025", LAGO_API_PORT: "8098", LAGO_FRONT_PORT: "8097",
};

test("every container name carries the prefix variable, orazaka by default", () => {
  const names = [...compose.matchAll(/container_name:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(names.length >= 5, "the compose file declares its containers");
  for (const name of names) assert.match(name, /^\$\{COMPOSE_CONTAINER_PREFIX:-orazaka\}-[a-z-]+$/, name);
});

test("every published host port is a variable whose default is today's port", () => {
  const published = [...compose.matchAll(/^\s*-\s*"127\.0\.0\.1:([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(published.length >= 8, "the compose file publishes its ports");
  const seen = new Set();
  for (const mapping of published) {
    const m = /^\$\{([A-Z0-9_]+):-(\d+)\}:\d+$/.exec(mapping);
    assert.ok(m, `a literal host port: ${mapping}`);
    assert.equal(m[2], TODAY[m[1]], `${m[1]} defaults to today's port`);
    seen.add(m[1]);
  }
  for (const name of Object.keys(TODAY)) assert.ok(seen.has(name), `${name} is used`);
});

test("the env template names every variable, at today's value", () => {
  for (const [name, value] of Object.entries({ ...TODAY, COMPOSE_CONTAINER_PREFIX: "orazaka" })) {
    const line = new RegExp(`^${name}=(.*)$`, "m").exec(template);
    if (name.startsWith("LAGO_") && !line) continue; // Lago's ports are documented with Lago, when enabled
    assert.ok(line, `${name} in .env.example`);
    assert.equal(line[1].trim(), value, name);
  }
});
