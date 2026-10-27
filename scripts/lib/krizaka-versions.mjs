/**
 * Guard: every `com.krizaka` version the workspace imports must be provided — by the reactor (the repository cloned
 * under `krizaka/`, built from source) or by Maven Central. The BOM of krizaka-build names one release per repository
 * (`krizaka-<repository>.version`) and orazaka-parent imports the BOM (`krizaka.version`); a version that neither the
 * reactor nor Central carries makes `./mvnw install` fail late, in the first module that needs it (orazaka#434: the
 * kit's starters exist from 0.3.0, the BOM still said 0.2.0, Central had no 0.3.0). Pure functions + one fetcher, so
 * the rule is unit-tested (scripts/test/krizaka-versions.test.mjs).
 */

const MAVEN_CENTRAL = "https://repo1.maven.org/maven2";

/** XML without its comments (an unterminated one drops the rest). Scanned, not a regex: a pattern can leave a « <!-- » behind. */
export function stripComments(xml) {
  let out = "";
  let at = 0;
  for (let open = xml.indexOf("<!--"); open >= 0; open = xml.indexOf("<!--", at)) {
    out += xml.slice(at, open);
    const close = xml.indexOf("-->", open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
  return out + xml.slice(at);
}

/** The project's own `<artifactId>` and `<version>` (a pom's `<parent>` and comments removed; version falls back to the parent's). */
export function projectCoordinates(pom) {
  const bare = stripComments(pom);
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(bare)?.[1] ?? "";
  // Only the project's direct children: nested blocks (dependencies, build, properties…) carry other versions.
  const own = bare.replace(/<(parent|dependencyManagement|dependencies|build|properties|profiles|modules|reporting|licenses|developers|scm|distributionManagement|repositories|pluginRepositories)>[\s\S]*?<\/\1>/g, "");
  const first = (xml, tag) => new RegExp(`<${tag}>\\s*([^<\\s]+)\\s*</${tag}>`).exec(xml)?.[1] ?? null;
  return { artifactId: first(own, "artifactId"), version: first(own, "version") ?? first(parent, "version") };
}

/** `<name>value</name>` properties of a pom's `<properties>` block. */
export function properties(pom) {
  const block = /<properties>([\s\S]*?)<\/properties>/.exec(stripComments(pom))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g)].map((m) => [m[1], m[2]]));
}

/** Every `<dependencyManagement>` entry of a BOM: { group, artifactId, version } with `${…}` resolved from its properties. */
export function managed(bom) {
  const bare = stripComments(bom);
  const props = { ...properties(bare), "project.version": projectCoordinates(bom).version };
  const resolve = (v) => v.replace(/\$\{([^}]+)\}/g, (_, k) => props[k] ?? "");
  return [...bare.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].flatMap((m) => {
    const g = /<groupId>\s*([^<\s]+)/.exec(m[1])?.[1];
    const a = /<artifactId>\s*([^<\s]+)/.exec(m[1])?.[1];
    const v = /<version>\s*([^<\s]+)/.exec(m[1])?.[1];
    return g === "com.krizaka" && a && v ? [{ group: g, artifactId: a, version: resolve(v) }] : [];
  });
}

/**
 * The versions to prove: [{ what, group, artifactId, version, reactor }] — `reactor` is the version at which the cloned
 * repositories build that artifact, or null when none does. Checked per ARTIFACT, not per repository: a release can
 * exist on Central and still lack an artifact a later one added (kit 0.2.0 has no krizaka-spring-boot-starter-app-config).
 * @param {{ bom: string, parent: string, built: Map<string,string> }} input
 *   bom / parent: pom texts of krizaka-bom and orazaka-parent; built: artifactId -> version the reactor builds it at.
 */
export function claims({ bom, parent, built }) {
  const out = managed(bom).map((d) => ({ what: "krizaka-bom manages", ...d, reactor: built.get(d.artifactId) ?? null }));
  const bomVersion = properties(parent)["krizaka.version"];
  if (bomVersion) {
    out.push({ what: "orazaka-parent krizaka.version imports", group: "com.krizaka", artifactId: "krizaka-bom", version: bomVersion, reactor: built.get("krizaka-bom") ?? null });
  }
  return out;
}

/** True when the pom of `group:artifactId:version` is on Maven Central; null when Central cannot be reached (never a failure). */
export async function onCentral({ group, artifactId, version }, fetchImpl = fetch) {
  const url = `${MAVEN_CENTRAL}/${group.replaceAll(".", "/")}/${artifactId}/${version}/${artifactId}-${version}.pom`;
  try {
    const res = await fetchImpl(url, { method: "HEAD" });
    if (res.status === 200) return true;
    return res.status === 404 ? false : null;
  } catch {
    return null;
  }
}

/** The claims nobody provides: the reactor builds another version and Central does not carry the one named. */
export async function unprovided(list, centralCheck = onCentral) {
  const missing = [];
  for (const c of list) {
    if (c.reactor === c.version) continue;
    if ((await centralCheck(c)) === false) missing.push(c);
  }
  return missing;
}

export function explain(c) {
  const built = c.reactor ? `the workspace builds it at ${c.reactor}` : "no repository of the workspace builds it";
  return `${c.what} ${c.group}:${c.artifactId}:${c.version}, which is not on Maven Central and ${built}. Set the version in the BOM (krizaka-build) to the one the repository carries on main.`;
}
