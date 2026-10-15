import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Directories no source lives in. */
const SKIP = new Set(["node_modules", "target", ".git", ".venv", "venv", "__pycache__"]);

/**
 * Recursively lists the files matching a predicate. A dangling symlink (a worker's `.venv` pointing at an
 * interpreter that is not on this machine) is skipped, never fatal.
 */
export function walk(dir, pred) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.has(name)) continue;
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...walk(p, pred));
    else if (pred(p)) out.push(p);
  }
  return out;
}
