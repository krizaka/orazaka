import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, QueryClientProvider } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";
import type { CodeChecksOverview } from "../lib/api";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import { I18nProvider } from "../lib/i18n";
import { ChecksPanel } from "../components/code/ChecksPanel";

const check = { name: "test", argv: ["npm", "test"], cwd: "", timeoutSecs: 300, network: false, env: [] };
const grant = { id: "g1", repo: "/r", check: { ...check, name: "lint", argv: ["npm", "run", "lint"] }, argvHash: "abc", createdAt: "2026-10-27", revokedAt: null };
let overview: CodeChecksOverview;
let client = createQueryClient({ maxRetries: 0 });
const wrap = (ui: React.ReactNode, locale: "en" | "fr" = "en") => (
  <QueryClientProvider client={client}><ThemeProvider defaultMode="dark"><I18nProvider locale={locale}>{ui}</I18nProvider></ThemeProvider></QueryClientProvider>
);

beforeEach(() => {
  client = createQueryClient({ maxRetries: 0 });
  overview = { suggested: [check], confirmed: [grant], needsApproval: false };
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: { check?: typeof check; id?: string; name?: string; approved?: boolean }) => {
    if (cmd === "code_checks_overview") return overview;
    if (cmd === "code_check_confirm") { overview = { ...overview, suggested: [], confirmed: [...overview.confirmed, { ...grant, id: "g2", check: args!.check! }] }; return overview.confirmed[1]; }
    if (cmd === "code_check_revoke") { overview = { ...overview, confirmed: [] }; return true; }
    if (cmd === "code_check_run") return { name: args!.name, exitCode: 0, durationMs: 12, timedOut: false, argvHash: "abc", output: "all green", truncated: false };
    throw new Error(`unexpected ${cmd}`);
  });
});

describe("ChecksPanel", () => {
  it("shows the command exactly as it will run, and a suggestion is not a confirmation", async () => {
    render(wrap(<ChecksPanel />));
    const suggested = await screen.findByTestId("suggested-check");
    expect(within(suggested).getByText("npm test")).toBeInTheDocument();
    expect(within(suggested).getByRole("button", { name: "Confirm this command" })).toBeInTheDocument();
    expect(within(suggested).queryByRole("button", { name: "Run" })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("code_check_run", expect.anything());
  });

  it("confirms a suggestion only on a click, and says it is shown no network when it is", async () => {
    render(wrap(<ChecksPanel />));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm this command" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("code_check_confirm", { check }));
    expect(screen.getAllByText("No network").length).toBeGreaterThan(0);
  });

  it("revokes a confirmed check", async () => {
    render(wrap(<ChecksPanel />));
    const row = await screen.findByTestId("confirmed-check");
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("code_check_revoke", { id: "g1" }));
    await waitFor(() => expect(screen.queryByTestId("confirmed-check")).toBeNull());
  });

  it("runs a confirmed check unapproved, and shows the output as text", async () => {
    render(wrap(<ChecksPanel />));
    fireEvent.click(within(await screen.findByTestId("confirmed-check")).getByRole("button", { name: "Run" }));
    expect(await screen.findByText("all green")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("code_check_run", { name: "lint", approved: false });
  });

  it("asks before running when a hunk changed what runs, and runs approved only after the click", async () => {
    overview = { ...overview, needsApproval: true };
    render(wrap(<ChecksPanel />));
    const row = await screen.findByTestId("confirmed-check");
    expect(within(row).getByText("A change since the last check altered what runs")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Approve and run" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("code_check_run", { name: "lint", approved: true }));
    expect(invoke).not.toHaveBeenCalledWith("code_check_run", { name: "lint", approved: false });
  });

  it("speaks French", async () => {
    render(wrap(<ChecksPanel />, "fr"));
    expect(await screen.findByRole("button", { name: "Confirmer cette commande" })).toBeInTheDocument();
  });
});
