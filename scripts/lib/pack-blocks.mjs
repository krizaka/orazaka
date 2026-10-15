/**
 * The pack catalogue as fenced data blocks for the docs site (orazaka-web-client renders them as cards): a
 * `pack-index` (find a pack: filters on tier and category) and one `pack` per bundle under its own heading, so the
 * page's contents list one entry per pack. No prose, no wide table — the site lays the data out.
 */
const oneLine = (s) => (s ?? "").replace(/\s+/g, " ").trim();

/** The English words of a pack, the way the catalogue shows them. */
export function packTitle(x) {
  return x.text.en?.label ?? x.studios[0]?.text.en?.label ?? x.key;
}

/** One pack, with only what a card shows. */
export function packBlock(x) {
  const t = x.text.en ?? {};
  return {
    key: x.key,
    title: packTitle(x),
    tagline: oneLine(t.tagline) || null,
    description: oneLine(t.description) || null,
    version: x.version,
    tier: x.tier,
    kind: x.kind ?? null,
    distribution: x.distribution ?? null,
    regulatoryClass: x.regulatoryClass ?? null,
    category: x.categoryText?.en?.label ?? x.category ?? null,
    listed: x.status !== "UNLISTED",
    workers: x.workers,
    controls: { scopeGuard: x.scopeGuard, consent: x.consent, safety: x.safety },
    rulesets: x.rulesets.map((r) => ({ label: r.label, jurisdiction: r.jurisdiction, rules: r.rules, versions: r.versions })),
    studios: x.studios.map((s) => {
      const st = s.text.en ?? {};
      return {
        key: s.key,
        label: st.label ?? s.key,
        summary: oneLine(st.tagline) || null,
        description: oneLine(st.description) || null,
        inputs: s.inputs.map((i) => ({ key: i.key, title: i.title })),
        steps: s.steps,
        stepKinds: s.stepKinds,
        credits: s.estimatedCredits,
      };
    }),
  };
}

export function packIndexBlock(shown) {
  return shown.map((x) => ({ key: x.key, title: packTitle(x), tagline: oneLine(x.text.en?.tagline) || null, tier: x.tier, category: x.categoryText?.en?.label ?? x.category ?? null, studios: x.studios.length }));
}

const fence = (lang, data) => ["```" + lang, JSON.stringify(data, null, 1), "```", ""];

/** The markdown lines of the "The packs" section. */
export function packsSection(shown) {
  const lines = ["## The packs", "", ...fence("pack-index", packIndexBlock(shown))];
  for (const x of shown) lines.push(`### ${packTitle(x)}`, "", ...fence("pack", packBlock(x)));
  return lines;
}
