import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findCodeNames } from "@krizaka/org";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

/** Every string of a catalogue, with its key. */
const leaves = (o: unknown, p = ""): [string, string][] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "object" && v ? leaves(v, `${p}${k}.`) : [[`${p}${k}`, String(v)] as [string, string]],
  );
/** A command to type keeps the CLI's code name (`orazaka doctor`); it is drawn as code. */
const isCommand = (key: string) => /\.(code|terminal)$/.test(key);

const tauri = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const infoPlist = readFileSync(new URL("../../src-tauri/Info.plist", import.meta.url), "utf8");

/** The commercial names (krizaka-internal#2103): the name under the icon, the window and the prompts are Sovkora. */
describe("no code name in what the customer reads", () => {
  for (const [locale, catalogue] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`the ${locale} messages`, () => {
      const hits = leaves(catalogue)
        .filter(([key]) => !isCommand(key))
        .flatMap(([key, text]) => findCodeNames(text).map((h) => `${key}: ${h.word} -> ${h.use}`));
      expect(hits).toEqual([]);
    });
  }

  it("the app's name, window, description and folder prompts say Sovkora", () => {
    expect(tauri.productName).toBe("Sovkora");
    expect(tauri.app.windows[0].title).toBe("Sovkora");
    // identifiers stay: the bundle identifier is not a name.
    expect(tauri.identifier).toBe("com.krizaka.orazaka.desktop");
    const shown = [tauri.bundle.shortDescription, tauri.bundle.longDescription, ...[...infoPlist.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1])];
    expect(shown.length).toBeGreaterThanOrEqual(5);
    expect(shown.flatMap((t) => findCodeNames(t))).toEqual([]);
  });
});
