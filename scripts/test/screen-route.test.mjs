import { test } from "node:test";
import assert from "node:assert/strict";
import { screenRoute } from "../lib/screen-route.mjs";

test("a screen's route is its folder under app/, with Next.js route groups (parentheses) stripped", () => {
  assert.equal(screenRoute("(console)/billing"), "/billing");
  assert.equal(screenRoute("(console)/billing/invoices"), "/billing/invoices");
  assert.equal(screenRoute("(auth)/(public)/login"), "/login");
});

test("dynamic segments and plain folders are kept as written", () => {
  assert.equal(screenRoute("users/[id]"), "/users/[id]");
  assert.equal(screenRoute("(console)/users/[userId]/edit"), "/users/[userId]/edit");
});

test("the root page is /", () => {
  assert.equal(screenRoute("."), "/");
  assert.equal(screenRoute("(console)"), "/");
});
