/**
 * The URL of a Next.js page from its folder under `app/`: route groups `(name)` only organise the
 * folders and never reach the URL, so they are dropped. `"."` (the root page) is `/`.
 * @param {string} relDir the page's folder, relative to `app/`, with `/` separators.
 * @returns {string}
 */
export function screenRoute(relDir) {
  const segments = relDir.split(/[/\\]/).filter((s) => s && s !== "." && !/^\(.*\)$/.test(s));
  return segments.length ? `/${segments.join("/")}` : "/";
}
