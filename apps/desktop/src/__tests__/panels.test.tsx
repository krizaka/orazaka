import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@krizaka/ui/theme";
import type { Snapshot } from "../lib/api";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import { I18nProvider } from "../lib/i18n";
import { FilesPanel } from "../components/FilesPanel";
import { StackPanel } from "../components/StackPanel";

const base: Snapshot = {
  settings: { mode: "remote", remoteUrl: "https://dev.orazaka.com", workspaceDir: "/w", watched: [], locale: "en" },
  roots: [],
  sidecar: true,
  autostart: false,
  probe: { web: false, edge: false, state: "stopped" },
  appVersion: "0.1.0",
};

const wrap = (ui: React.ReactNode, locale: "en" | "fr" = "en") => (
  <ThemeProvider defaultMode="dark"><I18nProvider locale={locale}>{ui}</I18nProvider></ThemeProvider>
);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: { call?: { command: string } }) => {
    if (cmd === "cli_run") {
      const c = args?.call?.command;
      if (c === "version") return { ok: true, code: 0, timedOut: false, lines: ["1.1.0"] };
      if (c === "status") return { ok: true, code: 0, timedOut: false, lines: ['[{"name":"Edge","port":8088,"status":"running","pid":null,"category":"app"}]'] };
      return { ok: true, code: 0, timedOut: false, lines: [] };
    }
    return undefined;
  });
});

describe("StackPanel", () => {
  it("shows the CLI version and the services read from `status --json`", async () => {
    render(wrap(<StackPanel snap={base} goSettings={() => undefined} />));
    expect(await screen.findByText("Edge")).toBeInTheDocument();
    expect(await screen.findByText(/CLI 1\.1\.0/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("cli_run", { call: { command: "status" } });
  });

  it("shows the header state from the services, not from the probe", async () => {
    render(wrap(<StackPanel snap={base} goSettings={() => undefined} />));
    // the mocked status reports one running service while the probe says stopped
    expect(await screen.findByText("Running")).toBeInTheDocument();
  });

  it("only ever asks for allow-listed commands", async () => {
    render(wrap(<StackPanel snap={base} goSettings={() => undefined} />));
    await screen.findByText("Edge");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("cli_run", { call: { command: "stop" } }));
    const commands = invoke.mock.calls.filter((c) => c[0] === "cli_run").map((c) => c[1].call.command);
    expect(new Set(commands)).toEqual(new Set(["version", "status", "stop"]));
  });

  it("explains the missing workspace and disables start", async () => {
    render(wrap(<StackPanel snap={{ ...base, settings: { ...base.settings, workspaceDir: null } }} goSettings={() => undefined} />));
    expect(await screen.findByText(/Choose the Orazaka workspace folder/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("is translated", async () => {
    render(wrap(<StackPanel snap={base} goSettings={() => undefined} />, "fr"));
    expect(await screen.findByText("Pile locale")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrêter" })).toBeInTheDocument();
  });
});

describe("FilesPanel", () => {
  it("says plainly that no file is readable when nothing is shared", () => {
    render(wrap(<FilesPanel snap={base} refresh={async () => undefined} />));
    expect(screen.getByText(/Orazaka cannot read any file on this Mac/)).toBeInTheDocument();
    expect(screen.getByText("0 folder(s) shared")).toBeInTheDocument();
  });

  it("lists the shared folders with a revoke button that calls the backend", async () => {
    const refresh = vi.fn(async () => undefined);
    render(wrap(<FilesPanel snap={{ ...base, roots: ["/Users/a/Clients"] }} refresh={refresh} />));
    expect(screen.getByText("/Users/a/Clients")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("revoke_folder", { path: "/Users/a/Clients" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("opens a folder through the scoped listing command", async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === "list_dir" ? { truncated: false, entries: [{ name: "contract.pdf", path: "/Users/a/Clients/contract.pdf", isDir: false, size: 2048, modified: 0, kind: "pdf" }] } : undefined,
    );
    render(wrap(<FilesPanel snap={{ ...base, roots: ["/Users/a/Clients"] }} refresh={async () => undefined} />));
    fireEvent.click(screen.getByText("/Users/a/Clients"));
    expect(await screen.findByText("contract.pdf")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_dir", { path: "/Users/a/Clients" });
  });
});
