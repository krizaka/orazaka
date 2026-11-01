import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* The Krizaka building blocks are on GitHub Packages (ADR-019, krizaka-internal#1879), not on Maven Central: since 2026-10-31
   every dev image build failed to resolve krizaka-parent 0.3.x. The image declares the repository in its Maven settings and
   receives the read credential as a build secret, never baked into a layer. */
const root = new URL("../../", import.meta.url);
const dockerfile = readFileSync(new URL("infra/deploy/Dockerfile", root), "utf8");
const spec = readFileSync(new URL("infra/deploy/orazaka-dev.app.yaml", root), "utf8");

test("the build stage carries the GitHub Packages settings and fails early without the token", () => {
  const build = dockerfile.slice(dockerfile.indexOf("AS build"), dockerfile.indexOf("# ── 3. Runtime"));
  assert.match(build, /COPY --from=sources \/m2\/settings\.xml \/root\/\.m2\/settings\.xml/);
  assert.match(build, /ARG MAVEN_GITHUB_PACKAGES_TOKEN\n/);
  assert.ok(build.indexOf("ARG MAVEN_GITHUB_PACKAGES_TOKEN") < build.indexOf("./mvnw"), "the token is declared before Maven runs");
  assert.match(build, /test -n "\$MAVEN_GITHUB_PACKAGES_TOKEN"/);
});

test("the settings are generated without a credential: nothing secret in a layer", () => {
  assert.match(dockerfile, /maven-github-packages-settings\.mjs --settings \/m2\/settings\.xml/);
  const code = dockerfile.split("\n").filter((l) => !l.startsWith("#")).join("\n");
  assert.doesNotMatch(code, /--build-arg|ENV MAVEN_GITHUB_PACKAGES_TOKEN|ARG MAVEN_GITHUB_PACKAGES_TOKEN=./);
  assert.match(dockerfile, /grep -q -E '<password>\[\^\$\]'/);
});

test("the settings generator is pinned to a commit of krizaka/.github", () => {
  assert.match(dockerfile, /ARG GITHUB_ORG_SHA=[0-9a-f]{40}\n/);
});

test("the App Platform spec hands the token to the core build as a BUILD_TIME secret", () => {
  assert.match(spec, /key: MAVEN_GITHUB_PACKAGES_TOKEN, scope: BUILD_TIME, type: SECRET, value: "__MAVEN_GITHUB_PACKAGES_TOKEN__"/);
});

test("a pull request touching the image or the build configuration builds the core image, with the credential from the environment", () => {
  const wf = readFileSync(new URL(".github/workflows/dev-image-build.yml", root), "utf8");
  assert.match(wf, /pull_request:\n\s+paths:[\s\S]*infra\/deploy\/Dockerfile/);
  assert.match(wf, /packages: read/);
  assert.match(wf, /--build-arg MAVEN_GITHUB_PACKAGES_TOKEN /, "no value on the command line");
  assert.doesNotMatch(wf, /docker push|push: true/);
});
