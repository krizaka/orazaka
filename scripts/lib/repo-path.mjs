// A path an operator passes to a workspace tool (an output file, a raw-answers folder) is resolved against the repository and
// must stay inside it: a tool never writes outside the checkout it was run from, whatever its arguments say.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** `p` as an absolute path inside `root` (the repository by default); throws when it would leave it or is the root itself. */
export function repoPath(p, root = REPO_ROOT) {
  const absolute = path.resolve(root, String(p));
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${p} must be inside the repository (${root})`);
  return absolute;
}
