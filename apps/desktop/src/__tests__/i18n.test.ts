import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

const keys = (o: unknown, p = ""): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const leaves = (o: unknown, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "object" && v ? Object.entries(leaves(v, `${p}${k}.`)) : [[`${p}${k}`, v as string]])));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogues", () => {
  it("fr has exactly the keys of en", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });
  it("no empty string and the same {placeholders}", () => {
    const e = leaves(en);
    const f = leaves(fr);
    for (const k of Object.keys(e)) {
      expect(f[k], k).not.toBe("");
      expect(placeholders(f[k]), k).toEqual(placeholders(e[k]));
    }
  });
});
