// Integration tests that skip themselves (an Assumption that finds no workspace, no Docker...) report green in
// Failsafe, so a whole class such as StudioRunLifecycleIT (47 tests) can stop protecting anything unseen
// (orazaka-studio#98). This reads Failsafe's reports and names every skipped test not on the allow-list.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** One Failsafe report (TEST-<class>.xml) -> { name, tests, skipped }. */
export function readReport(xml) {
  const tag = /<testsuite\b[^>]*>/.exec(xml)?.[0] ?? "";
  return { name: attr(tag, "name") ?? "?", tests: Number(attr(tag, "tests") ?? 0), skipped: Number(attr(tag, "skipped") ?? 0) };
}

/** The Failsafe reports under a component, wherever its modules sit. */
export function reportFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git"].includes(entry.name)) reportFiles(full, found);
    else if (entry.isFile() && /^TEST-.*IT\.xml$/.test(entry.name) && dir.endsWith("failsafe-reports")) found.push(full);
  }
  return found;
}

/**
 * allowed: [{ component, class, reason }] - a justified skip. Returns the totals and the offenders (skipped, not allowed).
 * A class on the allow-list that no longer skips is also reported as stale, so the list only shrinks.
 */
export function judge(component, reports, allowed = []) {
  const mine = allowed.filter((a) => a.component === component);
  const offenders = reports.filter((r) => r.skipped > 0 && !mine.some((a) => a.class === r.name));
  const stale = mine.filter((a) => !reports.some((r) => r.name === a.class && r.skipped > 0));
  return {
    classes: reports.length,
    tests: reports.reduce((sum, r) => sum + r.tests, 0),
    skipped: reports.reduce((sum, r) => sum + r.skipped, 0),
    offenders,
    stale,
  };
}

export function load(dir) {
  return existsSync(dir) ? reportFiles(dir).map((f) => readReport(readFileSync(f, "utf8"))) : [];
}
