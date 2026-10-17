# Orazaka — information architecture

> How Orazaka's menus are organised on every surface, who each one serves, and why. One structure, the same words on
> the public site, the signed-in web app, the phone and the Mac. Feedback:
> [Discussion #182](https://github.com/krizaka/orazaka/discussions/182).
>
> The public bar follows the **product-site navigation standard** every Krizaka product shares (decided 2026-10-15):
> logo · **Product ▾** · **Platforms ▾** · **Docs** · (Pricing when it exists), the tools on the right, the same groups
> in the phone panel and the footer. This document applies it to Orazaka and adds the signed-in app.

## 1. Who comes, and what for

| Audience | Arrives on | Top jobs | Where the answer is |
| :--- | :--- | :--- | :--- |
| **Evaluator** — a developer or an ops lead at a firm judging a self-hosted, sovereign AI engine | the public site, from a referral, LinkedIn or GitHub | *What does it do? Does it run on our hardware? Which models? Is it real?* | Product ▾ (How it works, Models, Demo) · Platforms ▾ (Self-host) · Docs |
| **Business user** — a firm that runs Studios and packs (contract review, Loi 25, image and video) | the public site, then the app | *What can it do for my trade? What does a run cost?* then *run it, follow it, get the result* | Product ▾ (Studios, Packs) → the app: Studios, Jobs, Usage & credits |
| **Krizaka's own products** — Yomizaka, Orochia, Yasakia using Orazaka as a service | the docs (API, packs, CLI) | *How do I call it, with which pack, under which limits?* | Docs |
| **Signed-in user** (today: QA accounts only, sign-up closed) | the app | chat, run a Studio, follow jobs, install packs, watch usage and credits, change settings | the rail: Home · Studios · Chat · Jobs · Packs · Usage & credits · Settings |

Sources: the landing and docs issues of `orazaka-web-client` (#72, #74, #75, #85, #88, #89, #90), the pack catalogue work
(`orazaka-packs#16`), the locomotive decision (Orazaka for Québec firms and SMEs, Yomizaka as the showcase).

## 2. The public site — dev.orazaka.com

### Before (2026-10-16)

```
Orazaka  [dev · v1.0.0+49d214f]  Product ▾  Demo  Mobile  Documentation      GitHub  EN FR  theme  Sign in  [Talk to us]
                                 ├ How it works
                                 ├ Studios
                                 ├ Packs
                                 ├ Models
                                 └ Mac app
```

Problems: six top-level things of different kinds (a version, a menu, a demo, a platform, the docs); Demo, Mobile and
the Mac app split across the menu and the bar; a version chip that means nothing to a visitor; a 480 × 380 px panel of
long sentences over the hero; the light of « Documentation » stayed on while the Product menu was open (two items lit).

### After

```
Orazaka   Product ▾   Platforms ▾   Docs                    GitHub  EN FR  theme  Sign in  [Talk to us]
          │           ├ Web          → the workspace in the browser (#platform)
          │           ├ Mobile       → /docs/mobile
          │           ├ Mac          → /desktop
          │           └ Self-host    → /docs/self-hosting (→ /infrastructure when that page ships)
          ├ How it works  (#how; the /features/* pages belong here)
          ├ Studios       (#studios)
          ├ Packs         (#packs)
          ├ Models        (/models)
          └ Demo          (/gallery — real runs, nothing staged)
footer: Product · Platforms · Docs · Legal — and « A Krizaka product », DEV · version, Montréal
```

- **Grouped by the visitor's question, not by our nouns**: *what does it do?* (Product), *where does it run?*
  (Platforms), *how do I use it?* (Docs). Pricing joins as a fourth entry when there are prices; until then, Packs
  (with their price before every run) answers it.
- **Models stay in Product**: a model is part of what Orazaka does for you (the standard lists it there); *where it
  runs* is the hardware, which is Platforms › Self-host.
- **Demo is in Product**: it is the proof of the product story, not a destination of its own.
- **The version is in the footer** (`DEV · vX.Y.Z`), never in the bar.
- **One item lit**: the group that holds the page (Product on /models, /gallery, /features/*; Platforms on /desktop,
  /docs/mobile, /docs/self-hosting), Docs for the rest of /docs, nothing on the home (its sections are anchors).
- **The menu is compact**: icon · title · one line (≤ 45 characters), 20 rem wide; it opens on click, keyboard, or a
  pointer that rests 200 ms (passing over the bar opens nothing); moving on to Docs closes it; Escape and a click
  outside close it (`@krizaka/ui` NavBar).
- **Phone**: one panel, the same two groups with their headings, then Docs, the language and theme, Sign in and the one
  action. A press outside closes it.
- **No URL changed**, so no redirect is needed.

Source of truth: `orazaka-web-client/src/features/landing/utils/site-nav.ts` (the bar, the panel and the footer read it);
test: `LandingNav.test.tsx` (structure snapshot, one item lit per route, axe on the bar and an open menu, the panel).

## 3. The signed-in app — web, phone, Mac

### Before

```
rail:   [mark] Dashboard · Chat Sessions · Studios · Packs · Task History · Credits · (Admin Panel) … Log out
header: [mark] Orazaka  [sovereign]                    EN▾  theme  bell  [name + avatar → /profile]
palette (⌘K): the same list again, in its own words
phone tabs: Studios · Chat · Jobs · Profile
```

Problems: three names for the same places (Chat Sessions / Chat, Task History / Jobs, Credits / Usage, Profile /
Settings); the rail, the palette and the phone each with their own list; Sign out on the rail, the account behind a bare
link; the language as a third control in the header.

### After

```
rail (desktop) / drawer (phone web):
  Home · Studios · Chat · Jobs · Packs · Usage & credits
  ───
  Settings · (Admin, admins only)
header: [≡ phone] [mark] Orazaka  [sovereign]                 theme  bell  [avatar ▾]
                                                                           ├ avatar · name · e-mail
                                                                           ├ Language: English / Français
                                                                           └ Sign out
⌘K palette: the rail's sections, same words, same order
phone tabs (Expo):  Studios · Chat · Jobs · Settings
Mac (Tauri): embeds the web client — the same rail and user menu
```

- **One list** — `orazaka-web-client/src/core/config/app-sections.ts` — read by the rail, the drawer and the palette;
  the phone's tabs are the same list without Home, Packs and Usage, in the same order and words.
- **Where you work on the rail, who you are under the avatar**: nothing appears in both (Settings is on the rail, Sign
  out only in the user menu).
- **Gallery is not a section**: the results of your runs are in Jobs (its gallery view); one concept, one place.
- **Automation** (`/automation`, connectors and approvals) is reachable by URL only today; it joins the rail (or
  Settings › Connectors, as on the phone) when it leaves preview — a decision for the automation work, not for this pass.
- **URLs kept** (`/dashboard/jobs`, `/billing`, `/profile`): renaming them to `/jobs`, `/usage`, `/settings` with 308s is
  a follow-up once the run-progress work on the Jobs page (#85/#86) has landed, to avoid two sessions moving the same
  files.

Tests: `Sidebar.test.tsx` (order snapshot, one section current per route, no Sign out on the rail),
`Header.test.tsx` (avatar first, the menu's content, nothing the rail holds), `AppCommandPalette.test.tsx`,
the phone's `app.test.tsx` / `app.fr.test.tsx` (the Settings tab).

## 4. Decisions

| Decision | Problem | Principle | Refused | Cost | Signal we are wrong |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Three entries grouped by question (Product · Platforms · Docs) | six mixed items, a visitor scanned all of them | Hick's law — choice time grows with the number of options (Hick 1952); card-sorting by user goals (Spencer, *Card Sorting*, 2009) | « Models & infra » as a fourth menu (splits *what it does* from *which models*) | Demo and Mobile one click deeper | Analytics or interviews: visitors open Product looking for Self-host, or never find the Demo |
| Compact menu, intent delay, one item lit | a sheet over the hero; menus flashing open on pass-over; two items lit | Recognition over recall, minimise visual noise (Nielsen, *10 Usability Heuristics*, 1994); hover intent (Amazon mega-menu pattern, Kalbach, *Designing Web Navigation*, 2007) | hover-only menus; a two-column mega-menu for nine links | descriptions must fit one line | people open menus by mistake, or miss that Product is a menu |
| One list of sections for rail, palette and phone | the same place under three names | Consistency and standards (Nielsen 1994); the same word everywhere builds one mental model (Norman, *The Design of Everyday Things*, 2013) | separate per-surface wording | Studios moves before Chat on the web rail (the phone's order) | users of both surfaces look for « Profile » or « Task History » |
| Account under the avatar, sections on the rail | Sign out on the rail, language as a third header control | Spatial memory — controls in conventional places (Fitts' law on corners; Jakob's law, Nielsen 2000) | a Settings entry in both the rail and the menu | the language is one click deeper in the app | people ask where to sign out or change the language |

*Owner: the UX lead session. Change a section here first, then in `site-nav.ts` / `app-sections.ts` and the phone's tab
bar, in the same pull requests.*
