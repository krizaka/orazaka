import assert from "node:assert/strict";
import { test } from "node:test";
import { modulesOf, plan } from "../ci-plan.mjs";

const modules = modulesOf(`<modules><module>krizaka/krizaka-build</module><module>orazaka-end2end</module>
<module>orazaka-apps/services/orazaka-edge</module><module>orazaka-apps/services/orazaka-edge-x</module></modules>`);

test("modules are read from the root pom, longest first", () => {
  assert.equal(modules.length, 4);
  assert.ok(modules.indexOf("orazaka-apps/services/orazaka-edge-x") < modules.indexOf("orazaka-apps/services/orazaka-edge"));
});

test("everything but a pull request runs the full reactor", () => {
  for (const event of ["push", "merge_group", "schedule", "workflow_dispatch"]) {
    assert.equal(plan({ event, files: ["orazaka-end2end/a.java"], modules }).mode, "full");
  }
});

test("a pull request builds the changed modules and their dependents", () => {
  const p = plan({
    event: "pull_request",
    files: ["orazaka-end2end/src/A.java", "orazaka-apps/services/orazaka-edge/x/B.java"],
    modules,
  });
  assert.equal(p.mode, "changed");
  assert.equal(p.pl, "orazaka-apps/services/orazaka-edge,orazaka-end2end");
});

test("a sibling directory with the same prefix is not the module", () => {
  const p = plan({ event: "pull_request", files: ["orazaka-apps/services/orazaka-edge-x/A.java"], modules });
  assert.equal(p.pl, "orazaka-apps/services/orazaka-edge-x");
});

test("what every module shares, or an unknown change set, fails open to full", () => {
  for (const f of ["pom.xml", ".mvn/maven.config", "infra/initdb/10-x.sql", "orazaka.workspace.json", ".github/workflows/ci.yml", "scripts/ci-plan.mjs"]) {
    assert.equal(plan({ event: "pull_request", files: [f, "orazaka-end2end/A.java"], modules }).mode, "full", f);
  }
  assert.equal(plan({ event: "pull_request", files: [], modules }).mode, "full");
  assert.equal(plan({ event: "pull_request", files: null, modules }).mode, "full");
});

test("a pull request outside every module tests no module", () => {
  const p = plan({ event: "pull_request", files: ["docs/a.md"], modules });
  assert.equal(p.mode, "changed");
  assert.equal(p.pl, "");
});
