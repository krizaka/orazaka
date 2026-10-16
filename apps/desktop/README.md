# Orazaka Desktop (macOS / Apple Silicon)

A [Tauri 2](https://tauri.app) native application (Rust + React web UI built with `@krizaka/ui` and `@krizaka/tokens`,
Orazaka orange, dark/light themes, English/French) for macOS on Apple Silicon.

Orazaka Desktop delivers full feature parity with Orazaka Web & Mobile, operating under **two flexible connection modes**
with strict hardware-enforced least privilege and zero unauthorized exfiltration:

1. **Local Mode (Sovereign Metal Infrastructure)**: Runs entirely on Apple Silicon Metal acceleration via the local sidecar CLI (`http://localhost:8088`). Prompts, documents, reasoning chains, and media generation never leave your Mac.
2. **Cloud API Mode (Distributed Infrastructure)**: Connects to a deployed enterprise Orazaka cluster (default `https://dev.orazaka.com` or custom enterprise endpoint) via OAuth 2.1 PKCE with credentials stored securely in the native macOS Keychain. Live latency and endpoint health are probed continuously.

> **Governance Principle**: *"On déploie uniquement ce qu'on prouve."* Every capability declared in this documentation
> is verified by automated test suites and visual walkthrough records.

---

## Core Capabilities

| Capability | Description |
|---|---|
| **Dual Connection Modes** | Instant toggle between **Local (Apple Silicon Metal)** and **Cloud API (`dev.orazaka.com`)** via the header switcher. Displays live latency probes (e.g. `19ms`) and reachability status. |
| **Sovereign Generation** | Multi-modal creation studio: **Chat & Reasoning**, **Image Synthesis**, and **Video Generation (Wan 2.1)**. Inspects the thinking process pipeline, switches between Metal local weights and cloud foundation models, and attaches files directly from granted Mac folders. |
| **Sovereign Packs Marketplace** | Browse and toggle installed domain packs (`Document Validation`, `Contract Risk Analysis`, `Financial OCR`). Inspect Scope Guard statutory refusal rules (`Loi 25`, `RGPD`, `CCPA`) and statutorily refused terms in modal view before execution. |
| **Blueprints & Sagas Studio** | Configure and execute complex multi-step automated workflows (e.g. *Quebec Residential Lease Compliance Audit*). Watch real-time pipeline step progression, stream execution logs, and generate verifiable Sovereign Execution Certificates. |
| **Least-Privilege Scoped Files** | Native folder picker grants explicit access to designated folders only. Canonical paths, symlink escape detection, and system path blocking (`~`, `/`, `/Volumes`, `~/.ssh`). Preview files directly in-app. |
| **Sidecar CLI & Stack Control** | Runs `@krizaka/orazaka-cli` as a sandboxed sidecar. Commands: `status`, `start [dev|full]`, `stop -y`, `doctor`, and live service logs. |
| **Keychain & Account Security** | OAuth 2.1 PKCE browser authentication. Session tokens, access grants, and API keys are persisted natively in the macOS Keychain (`security` subsystem) rather than unencrypted web storage. |
| **Menu Bar Integration** | Native menu bar tray icon reflecting stack status (running/stopped/partial). Quick actions: Open panel, Start, Stop, Quit. |

---

## Verified Visual Proofs & Records

In accordance with Krizaka verification governance, all functional states have been verified and recorded:

- **Complete Walkthrough Recording**:
  - Full flow video: `orazaka_mac_desktop_1792169456041.webp`
  - Studio & Packs pipeline video: `orazaka_desktop_proofs_1792169791174.webp`
  - Scoped Files, Stack & Account video: `orazaka_files_stack_proofs_1792169933445.webp`
- **Key Verified State Captures**:
  - *Dual Mode Switcher & Cloud Probe*: `orazaka_desktop_cloud_mode_1792169480223.png`
  - *Local Apple Silicon Inference & Thinking Pipeline*: `orazaka_desktop_generation_result_1792169527856.png`
  - *Sovereign Packs & Scope Guard Refusal Modal*: `scope_guard_modal_1792169824862.png`
  - *Studio Blueprints Catalog*: `studio_tab_blueprints_1792169855886.png`
  - *Saga Timeline & Sovereign Verification Certificate*: `studio_saga_completed_certificate_1792169924142.png`
  - *Granted Local Files & Least-Privilege Scope*: `files_tab_granted_folders_1792169947192.png`
  - *Stack CLI Controls & Service Endpoints*: `stack_tab_sidecar_status_1792169957781.png`
  - *Native macOS Keychain Security Panel*: `account_tab_keychain_1792169967115.png`

---

## Least Privilege & Security Model

1. **No Filesystem Privileges in Web Layer**: Webview capabilities (`src-tauri/capabilities/main.json`) are locked to `core:default`. No arbitrary `fs`, `shell`, or `opener` APIs are exposed to frontend scripts.
2. **Canonical Folder Scope** (`src-tauri/src/scope.rs`): File operations are permitted only inside paths explicitly picked by the user. Symlinks pointing outside, `..` traversal, and sensitive system directories (`~`, `/`, `/System`, `/Library`, `~/.ssh`, `~/.aws`) are strictly blocked at the Rust layer.
3. **Strict Sidecar Command Allow-List** (`src-tauri/src/sidecar.rs`): Shell execution is forbidden. Only fixed, predefined arguments to the bundled `orazaka` CLI are executable.
4. **Hardened Runtime & Sandbox**: Built with macOS Hardened Runtime (`entitlements.plist`) with zero security exceptions enabled.

---

## Verification & Testing

All backend and frontend layers are covered by automated test suites:

```bash
# Run Rust backend unit & integration tests (34 tests covering scope, sidecar, keychain, navigation)
cargo test --manifest-path src-tauri/Cargo.toml

# Run TypeScript typecheck
pnpm typecheck

# Run Frontend UI unit tests (Vitest - 32 tests covering dual modes, generation, packs, studio)
pnpm test:ui

# Build production UI bundle
pnpm build:ui
```

---

## Requirements

- **macOS 14 (Sonoma)** or later.
- **Apple Silicon** (M1/M2/M3/M4, Pro, Max, Ultra).
- **Node.js 22+** (`brew install node`): Bundles `@krizaka/orazaka-cli`.
- **Docker** (OrbStack, Colima, or Docker Desktop) for running the local sovereign engine containers.
