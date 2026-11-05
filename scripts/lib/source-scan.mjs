// What generate-docs reads from the services' sources, in linear time: a pattern with nested or overlapping quantifiers can
// take exponential time on a crafted file, so each one here is either a line walk or a pattern with one way to match.

/** Code-point order for strings (stable across machines, unlike a locale's): the compare function of every sort of names. */
export function byText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Numeric order: ports, counts. */
export function byNumber(a, b) {
  return a - b;
}

const SERVER_KEY = /^server:\s*$/;
const INDENTED = /^[ \t]/;
const PORT_LINE = /^[ \t]+port:[ \t]*(?:\$\{[\w.-]+:)?(\d+)/;

/** The `server.port` of a Spring application.yml (a `${VAR:8081}` default counts), or null when the file sets none. */
export function servicePortOf(yml) {
  const lines = String(yml ?? "").split("\n");
  const start = lines.findIndex((line) => SERVER_KEY.test(line));
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    if (!INDENTED.test(line)) return null;
    const port = PORT_LINE.exec(line);
    if (port) return Number(port[1]);
  }
  return null;
}

// `"…"` then separators (spaces, commas): a quote opens each string and no separator is a quote, so there is one way to match.
const REQUEST_MATCHERS =
  /requestMatchers\(\s*(?:HttpMethod\.(\w+)\s*,\s*)?((?:"[^"]*"[\s,]*)+)\)\s*\.\s*(permitAll|authenticated|hasAuthority|hasAnyAuthority)\(([^)]*)\)/g;

/** Each `requestMatchers(…).<verb>(…)` of a SecurityConfig: { httpMethod, patterns, verb, args }. */
export function requestMatcherRules(code) {
  return [...String(code).matchAll(REQUEST_MATCHERS)].map((m) => ({
    httpMethod: m[1] ?? null,
    patterns: [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]),
    verb: m[3],
    args: [...m[4].matchAll(/"([^"]*)"|(\b[A-Z_]{2,}\b)/g)].map((x) => x[1] ?? x[2]),
  }));
}
