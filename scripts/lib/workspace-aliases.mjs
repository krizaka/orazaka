import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * Folder aliases of the workspace manifest: `{ path, target, why }`, a name under which a folder of the layout is also
 * reachable. The merged Sovkora POMs resolve their parent at `../../../sovkora-libs/sovkora-build/sovkora-parent`, while the
 * layout folder is still `orazaka-libs` (its rename moves test-support's scan roots, the studio and worker tests, the CLI:
 * the layout wave, krizaka-internal#2684). The alias lets both names resolve until that wave; remove it with `orazaka-libs`.
 */
export function aliasesToCreate(root, aliases = [], { exists = existsSync } = {}) {
  return aliases.filter((a) => exists(join(root, a.target)) && !exists(join(root, a.path)));
}

/** Creates the missing aliases as relative symbolic links; returns the paths created. */
export function linkAliases(root, aliases = [], { link = symlinkSync, exists = existsSync } = {}) {
  return aliasesToCreate(root, aliases, { exists }).map((a) => {
    link(a.target, join(root, a.path), "dir");
    return a.path;
  });
}
