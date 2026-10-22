import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import globals from "../globals.css?raw";
import app from "../App.tsx?raw";
import main from "../main.tsx?raw";

/**
 * The product look is the plain Krizaka UI (krizaka-ui#492): `data-surface="product"` on <html> gives sans headings, the
 * system monospace and the brand accent. The notebook identity (Young Serif, Courier Prime, Caveat, paper, margin ink)
 * belongs to Krizaka's own sites, never to a product app.
 */
describe("the plain product look", () => {
  it("the page says it is a product surface", () => {
    expect(indexHtml).toMatch(/<html[^>]*data-surface="product"/);
  });

  it("no stylesheet or source names the notebook identity", () => {
    for (const [name, text] of Object.entries({ globals, app, main })) {
      expect(text, name).not.toMatch(/cahier|young ?serif|courier ?prime|caveat|data-paper|margin ?ink/i);
    }
  });
});
