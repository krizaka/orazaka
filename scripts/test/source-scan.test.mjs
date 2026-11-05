// node --test scripts/test — what generate-docs reads from the services' sources, in linear time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { byNumber, byText, requestMatcherRules, servicePortOf } from "../lib/source-scan.mjs";

test("names sort in code-point order and numbers numerically", () => {
  assert.deepEqual(["b", "B", "a", "ADR-010", "ADR-002"].sort(byText), ["ADR-002", "ADR-010", "B", "a", "b"]);
  assert.deepEqual([9000, 10000, 8085].sort(byNumber), [8085, 9000, 10000]);
});

test("the server port of an application.yml, with or without a variable default", () => {
  assert.equal(servicePortOf("spring:\n  name: x\nserver:\n  port: 8085\n"), 8085);
  assert.equal(servicePortOf("server:\n  shutdown: graceful\n  port: ${SERVER_PORT:8090}\n"), 8090);
  assert.equal(servicePortOf("server:\n  shutdown: graceful\nother:\n  port: 1\n"), null);
  assert.equal(servicePortOf("spring:\n  port: 1\n"), null);
  assert.equal(servicePortOf(""), null);
});

test("a long file without a match is read in linear time", () => {
  const started = performance.now();
  servicePortOf(`server:\n${"  a: b\n".repeat(50_000)}x`);
  requestMatcherRules(`requestMatchers(${'"a" , '.repeat(5_000)}`);
  requestMatcherRules(`requestMatchers(${'"" '.repeat(5_000)}x`);
  assert.ok(performance.now() - started < 2_000, "no backtracking blow-up");
});

test("the requestMatchers rules of a SecurityConfig", () => {
  const code = `
    http.authorizeHttpRequests(a -> a
      .requestMatchers(HttpMethod.GET, "/api/v1/public/**", "/docs") .permitAll()
      .requestMatchers("/api/v1/admin/**").hasAnyAuthority("ADMIN", OPERATOR)
      .requestMatchers("/api/v1/**").authenticated());`;
  assert.deepEqual(requestMatcherRules(code), [
    { httpMethod: "GET", patterns: ["/api/v1/public/**", "/docs"], verb: "permitAll", args: [] },
    { httpMethod: null, patterns: ["/api/v1/admin/**"], verb: "hasAnyAuthority", args: ["ADMIN", "OPERATOR"] },
    { httpMethod: null, patterns: ["/api/v1/**"], verb: "authenticated", args: [] },
  ]);
});
