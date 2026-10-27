import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The repositories of the workspace manifest that are not cloned (absent or empty) under `root`.
 *
 * The docs are built from the code of every repository (AGENTS.md §10). The model catalogue's INSERTs live in the
 * `infra/initdb` of the repositories that own them (orazaka-job-service…), while the UPDATEs of the registry metadata
 * are in this repository's `infra/migrations`: run from a checkout without the siblings, the generator died with
 * « model registry: UPDATE of v1-5-pruned-emaonly, which no INSERT created » — true, and a puzzle. It now stops
 * first, and says what is missing.
 */
export function missingRepositories(root, repositories, { exists = existsSync, list = readdirSync } = {}) {
  return repositories.filter((r) => {
    const dir = join(root, r.path);
    return !exists(dir) || list(dir).length === 0;
  });
}

/** The message that tells how to complete the workspace. */
export function notClonedMessage(missing) {
  return (
    `✗ the workspace is not cloned: ${missing.map((r) => r.path).join(", ")}.\n` +
    "  The docs are built from the code of every repository; run `node scripts/workspace.mjs clone --depth 1` first, " +
    "or run the generator from the workspace root."
  );
}
