// The workspace root a local-stack tool is pointed at (its first argument, else the current folder): an absolute folder that holds
// the stack's compose file. A relative, option-like or foreign path is refused before any file is read or any program runs.
import { existsSync } from "node:fs";
import path from "node:path";

export const COMPOSE_FILE = path.join("infra", "docker-compose.yml");

/** `dir` resolved to an absolute workspace root; throws when it does not hold infra/docker-compose.yml. */
export function composeRoot(dir) {
  const root = path.resolve(String(dir));
  if (!existsSync(path.join(root, COMPOSE_FILE))) throw new Error(`${dir} is not an Orazaka workspace (no ${COMPOSE_FILE})`);
  return root;
}
