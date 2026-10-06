# Rule: UI/UX & Frontend Standards

## §1 Design System

- **Typography**: Display (`Outfit`), Body (`Inter`), Monospace (`JetBrains Mono`).
- **Colors**: HSL variables exclusively. Banned: inline hex colors or hardcoded Tailwind color classes. Frosted glass panels use `backdrop-filter: blur(16px)`.
- **Interactions**: All interactive elements require `hover`, `active`, `focus`, and `disabled` states. Toast alerts for API notifications. Mobile-first layouts with touch targets ≥ 44px.
- **Icons**: Centralized Lucide icons from `Icon.tsx`. Banned: direct imports from external icon libraries.

## §2 Date-fns Standard (ERR-108)

- **Library**: `date-fns` is the exclusive date formatting library.
- **Banned libraries**: `moment.js`, `dayjs`, `luxon`.
- **Banned patterns**:
  - `new Date().toISOString()` → use `formatISO(new Date())`
  - Native `toLocaleTimeString()` / `toLocaleDateString()` (causes SSR hydration mismatch)
  - Native `.getMonth()`, `.getDate()` → use date-fns helpers
  - Manual regex date parsing → use `parseISO` or `parse`
- **Allowed exceptions**: `Date.now()` for state keys, `new Date().getFullYear()` for copyright notices.

## §3 Accessibility & i18n

- **Elements**: Unique `id` attributes on all interactive controls. Associated `<label>` for form fields. `aria-label` for icon-only buttons.
- **Translation**: No hardcoded JSX text. Fetch display strings from `TranslationDictionary`. Allow +30% space for French translation expansion.

## §4 Workspace Architecture

All client applications are grouped under `orazaka-apps/ui/` as an npm workspace:

- **`orazaka-web-client/`**: Client-facing Next.js 16 App Router application (port 3000). Cinematic dark-mode, React 19, input-blocking.
- **`orazaka-web-admin/`**: Isolated SecOps Administration Console (port 3001). Must never share runtime state with `orazaka-web-client`.
- **`orazaka-mobile-client/`**: Expo SDK 53 cross-platform mobile app. **Two typed stacks chosen by session** — auth (Login, Register, ForgotPassword, ResetPassword) and app (a six-tab bar: Studios, Chat, Jobs, Connecteurs, Système, Profil; plus StudioDetail, StudioRun, Subscription, Console, AdminGovernance). Every colour comes from `themes` in `orazaka-shared`; no literal `hsl()`/hex in a screen.
- **Mobile talks to the edge**, never to the BFF (AGENTS.md §8): `src/config/api.ts` owns the base URL and the bearer, `src/core/AuthContext.tsx` owns the session (JWT in `expo-secure-store`, never AsyncStorage — it is a credential), `src/core/useApi.ts` owns loading/error/retry. A screen builds no URL and sets no header.
- **Streaming on mobile is XHR, not `fetch`/`EventSource`**: React Native's `fetch` exposes no readable stream and `EventSource` cannot carry an `Authorization` header. `src/core/streamChat.ts` is the one place that knows this.
- **Mobile tests run in a `node` environment with `ts-jest`, not the `jest-expo` preset.** What is worth testing there is pure logic — the SSE parser, the API client, the session store — and loading Expo's native runtime for a string parser costs a teardown crash for nothing. Component rendering, if ever wanted, belongs in a second Jest project.
- **Expo pins are not suggestions**: `react-native-screens` had drifted to 4.26 under a caret while SDK 53 expects `~4.11`, and the app could not bundle at all. Run `npx expo install --check` after touching mobile dependencies — but pin the reported package individually rather than running `--fix`, which would drag `react`/`typescript` back to versions the web client cannot use.
- **`orazaka-cli/`**: Developer automation CLI. All UI logging must use `logWarning`/`logError` from `ui/prompts.ts` — never raw `console.log`.
- **`orazaka-shared/`**: Shared TypeScript types and Zod validation schemas. All client packs import types from here — zero type duplication across packs.

## §5 Input Blocking (ERR-126)

Text entry surfaces must lock when `isSending || isGenerating`. This applies to **all** client platforms (web, admin, mobile):
- Disable textareas, menus, attachments, and submit buttons.
- Applies to both web (`orazaka-web-client`, `orazaka-web-admin`) and mobile (`orazaka-mobile-client`).

## §6 Form Event Typing

Form `onSubmit` handlers must use React 19+ native types:
- `React.SubmitEventHandler<HTMLFormElement>` or `React.SubmitEvent<HTMLFormElement>`
- **Banned**: `React.FormEvent`
