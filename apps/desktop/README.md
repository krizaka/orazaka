# Orazaka Desktop

A [Tauri 2](https://tauri.app) app (Rust + a web UI built with `@krizaka/ui` and `@krizaka/orazaka-design-system`,
Orazaka orange, dark/light, English/French) for macOS on Apple Silicon. v0.1 is a **test build**: it lets you run
Orazaka on your Mac, or connect to a hosted one, and give Orazaka **access to the folders you choose — and only those**.

> Delivery context: [`docs/DELIVERY.md`](../../docs/DELIVERY.md) — Orazaka Desktop is the installer and control panel of
> *Orazaka for Mac*. It never re-implements an operation: it runs the `orazaka` CLI as a sidecar.

## What it does (v0.1)

| | |
|---|---|
| **Control panel** | Status of the local stack (`orazaka status --json`), **Start** / **Stop**, **Run doctor**, logs (live output + `orazaka logs --service …`), CLI and app version, **Open workspace** (the web UI in an app window). |
| **Connect mode** | Point the app at a hosted Orazaka (default `https://dev.orazaka.com`, https only) and sign in **on the Orazaka page itself** — the app never sees or stores a password. |
| **File access** | Choose folders with the native picker; list and preview their files (text, images, PDF); **drag & drop** files into the workspace page or onto the panel; **watch a folder** for new files; **revoke** any folder or all of them. |
| **Menu bar** | An icon showing the stack's state (outline = stopped, filled = running/partial), with Open panel · Open workspace · Start · Stop · Quit. Closing the window keeps the app in the menu bar. |
| **Auto-start** | "Start Orazaka when I log in" (macOS login item) — **off by default**, and it only opens the menu-bar app; nothing is started unless you ask. |

## Least privilege — how access is bounded

1. **No filesystem permission in the web layer.** The control panel's capability (`src-tauri/capabilities/main.json`) is
   `core:default` only: no `fs`, no `shell`, no `opener` plugin. The hosted workspace window has **no capability at all**
   (no IPC): the Orazaka page cannot call the app.
2. **Folder scope** (`src-tauri/src/scope.rs`). The app can read a path only if its *canonical* form lies inside a
   folder you granted with the picker. `..` and symlinks that leave a folder are refused; grants are persisted
   (`~/Library/Application Support/com.krizaka.orazaka.desktop/scope.json`), shown in the **Files** tab and revocable
   (revoking also stops the folder watch). Your home folder itself, `/`, `/Users`, `/Volumes`, system folders and
   `~/.ssh`, `~/.aws`, `~/Library`, … can **never** be granted.
3. **Drops** on the panel are one-file, this-session-only permissions; a dropped **folder** is shared only if you
   confirm. Drops on the workspace page are the browser's own (the page receives the file you drag, nothing else).
4. **Sidecar allow-list** (`src-tauri/src/sidecar.rs`). The UI cannot run a shell or an arbitrary program, nor pass free-form
   arguments: it names one of `version · status · start [dev|full] · stop · doctor · logs [service] [tail]`, and Rust turns
   it into a fixed argument vector (`stop` is always `stop -y`, never `--purge`). Everything else is refused before a process
   exists.
5. **Navigation guard.** The workspace window can only stay on the configured origin; other links open in your browser.
6. **Hardened runtime** is on, with an explicit `entitlements.plist` that opts out of nothing (no JIT, no unsigned
   memory, no library-validation bypass). Notarization needs only the Developer ID (below).

## Requirements

macOS 14+, Apple Silicon. **Node.js 22+** on the Mac (`brew install node`): v0.1 bundles the orazaka CLI
(`@krizaka/orazaka-cli`, pinned in `package.json` → `orazakaCli`) but not a Node runtime. For the local stack: Docker
(OrbStack/Colima/Docker Desktop) and the Orazaka workspace folder — see Settings.

## Open the unsigned build

The `.dmg` is **not signed or notarized yet** (the Apple Developer ID is pending), so Gatekeeper blocks a plain
double-click. Drag **Orazaka** to *Applications*, then **right-click the app → Open → Open** (once). If macOS still
refuses ("damaged"), run `xattr -dr com.apple.quarantine /Applications/Orazaka.app`.

## Add signing and notarization (when the Developer ID exists)

Nothing in the code changes. Add these repository secrets; `.github/workflows/desktop.yml` already passes them to
`pnpm tauri build`, which signs the app and the sidecar with the hardened runtime and notarizes + staples the `.dmg`:
`APPLE_CERTIFICATE` (base64 of the *Developer ID Application* `.p12`), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY` (`Developer ID Application: Krizaka (TEAMID)`), `APPLE_ID`, `APPLE_PASSWORD` (app-specific
password), `APPLE_TEAM_ID`. Then drop "unsigned" from the release notes.

## Develop

```bash
pnpm install
pnpm sidecar        # bundles the orazaka CLI into src-tauri/resources/cli (not committed)
pnpm tauri dev      # the app, with hot reload
pnpm check          # typecheck + UI tests (vitest) + Rust tests (cargo test)
pnpm build:app      # the .dmg: src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/
```

Rust tests cover the scope (grant, revoke, `..`/symlink escapes, forbidden folders, persistence), the sidecar
allow-list, the settings and navigation guard, and file listing/preview. UI tests cover the panels, the allow-listed
calls, the catalogues (en/fr parity) and the helpers.

## Release

Tag `desktop-vX.Y.Z[-suffix]` (it must equal `version` in `package.json` and `src-tauri/tauri.conf.json`): the
`Desktop` workflow builds the `.dmg` on a macOS runner and attaches it, with its SHA-256, to the GitHub Release
(a pre-release when the tag has a suffix such as `-dev`).
