// node --test scripts/test — the connection-budget alarm.
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parseRows } from "../db-connections.mjs";

test("parseRows reads role,count lines and refuses anything else", () => {
  assert.deepEqual(parseRows("a,3\n\nb,1\n"), [{ role: "a", count: 3 }, { role: "b", count: 1 }]);
  assert.throws(() => parseRows("a;3"), /not a "role,count" line/);
  assert.throws(() => parseRows("a,-1"), /not a "role,count" line/);
});

test("evaluate: 22 usable of 25; alert strictly above 80 %", () => {
  const at = (n) => evaluate([{ role: "x", count: n }]);
  assert.equal(at(17).usable, 22);
  assert.equal(at(17).over, false); // 77 %
  assert.equal(at(18).over, true); // 82 %
  assert.equal(at(28).percent, 127);
});

test("evaluate sorts the roles by weight and honours another plan", () => {
  const r = evaluate([{ role: "small", count: 1 }, { role: "big", count: 5 }], { max: 50, reserved: 3, threshold: 50 });
  assert.equal(r.byRole[0].role, "big");
  assert.equal(r.usable, 47);
  assert.equal(r.over, false);
});
