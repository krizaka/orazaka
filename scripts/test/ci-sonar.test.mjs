// The required check « SonarCloud Code Analysis » is posted by the SonarCloud app after a CI scan. On a merge queue
// SHA the app's automatic analysis never runs, so without a CI scan job on merge_group the queue waits forever
// (krizaka-internal#2000). This guards that the scan exists and runs on every event the required checks run on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const sonarJob = ci.split(/\n  (?=[a-z-]+:\n)/).find((block) => /^sonar:/.test(block)) ?? "";

test("ci.yml triggers on merge_group, pull_request and push", () => {
  for (const event of ["merge_group", "pull_request", "push"]) {
    assert.match(ci.split(/\njobs:/)[0], new RegExp(`\\n  ${event}:`), `${event} trigger`);
  }
});

test("a CI Sonar job runs the org scan action with the org secret", () => {
  assert.ok(sonarJob, "a `sonar` job exists in ci.yml");
  assert.match(sonarJob, /name: SonarCloud\b/);
  assert.match(sonarJob, /krizaka\/\.github\/actions\/sonar-scan@/);
  assert.match(sonarJob, /secrets\.SONAR_TOKEN/);
  assert.match(sonarJob, /fetch-depth: 0/);
});

test("the Sonar job is not gated by an event condition that would skip merge_group", () => {
  assert.doesNotMatch(sonarJob, /github\.event_name\s*[!=]=\s*'pull_request'/);
  assert.doesNotMatch(sonarJob, /if:.*pull_request/);
});

test("sonar-project.properties names the project", () => {
  assert.ok(existsSync(new URL("../../sonar-project.properties", import.meta.url)));
  const p = readFileSync(new URL("../../sonar-project.properties", import.meta.url), "utf8");
  assert.match(p, /^sonar\.projectKey=krizaka_orazaka$/m);
  assert.match(p, /^sonar\.organization=krizaka$/m);
});
