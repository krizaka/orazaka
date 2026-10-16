import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@krizaka/ui/theme";
import type { Snapshot } from "../lib/api";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import { I18nProvider } from "../lib/i18n";
import { App } from "../App";
import { GenerationPanel } from "../components/GenerationPanel";
import { PacksPanel } from "../components/PacksPanel";
import { StudioPanel } from "../components/StudioPanel";

const localSnap: Snapshot = {
  settings: {
    mode: "local",
    remoteUrl: "https://dev.orazaka.com",
    workspaceDir: "/Users/test/workspace",
    watched: [],
    locale: "en",
  },
  roots: ["/Users/test/Documents"],
  sidecar: true,
  autostart: false,
  probe: { web: true, edge: true, state: "running" },
  appVersion: "0.2.0",
};

const remoteSnap: Snapshot = {
  ...localSnap,
  settings: {
    ...localSnap.settings,
    mode: "remote",
  },
};

const wrap = (ui: React.ReactNode, locale: "en" | "fr" = "en") => (
  <ThemeProvider defaultMode="dark">
    <I18nProvider locale={locale}>{ui}</I18nProvider>
  </ThemeProvider>
);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "get_snapshot") return localSnap;
    if (cmd === "probe_remote") return { reachable: true, latencyMs: 24, host: "dev.orazaka.com", status: 200 };
    if (cmd === "save_settings") return args?.settings ?? localSnap.settings;
    if (cmd === "list_dir") {
      return {
        truncated: false,
        entries: [
          { name: "lease-contract.pdf", path: "/Users/test/Documents/lease-contract.pdf", isDir: false, size: 2048, modified: 0, kind: "pdf" },
          { name: "site-photo.jpg", path: "/Users/test/Documents/site-photo.jpg", isDir: false, size: 4096, modified: 0, kind: "image" },
        ],
      };
    }
    if (cmd === "auth_status") return { signedIn: false, username: null, email: null, authorities: [], server: null };
    return undefined;
  });
});

describe("GenerationPanel", () => {
  it("renders with local Apple Silicon Metal models and welcome message", async () => {
    render(wrap(<GenerationPanel snap={localSnap} />));
    expect(await screen.findByText(/Apple Silicon Metal engine/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  it("renders with Orazaka Cloud API models when in remote mode", async () => {
    render(wrap(<GenerationPanel snap={remoteSnap} />));
    expect(await screen.findByText(/Connected to Orazaka Cloud API/)).toBeInTheDocument();
  });

  it("submits prompt and renders reasoning pipeline with metrics", async () => {
    render(wrap(<GenerationPanel snap={localSnap} />));
    const textarea = screen.getByPlaceholderText(/Ask a question/i);
    fireEvent.change(textarea, { target: { value: "Audit this lease agreement clause" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText(/Audit this lease agreement clause/)).toBeInTheDocument();
    expect(await screen.findByText(/Processed your prompt entirely on your Mac/)).toBeInTheDocument();
    expect(screen.getAllByText(/Thinking Pipeline/).length).toBeGreaterThan(0);
  });

  it("attaches granted Mac file to prompt", async () => {
    render(wrap(<GenerationPanel snap={localSnap} />));
    const attachBtn = await screen.findByRole("button", { name: "Attach from Mac" });
    fireEvent.click(attachBtn);
    const fileOption = await screen.findByText("lease-contract.pdf");
    fireEvent.click(fileOption);
    expect(screen.getByText("lease-contract.pdf")).toBeInTheDocument();
  });
});

describe("PacksPanel", () => {
  it("renders sovereign packs catalogue with regulatory classes", async () => {
    render(wrap(<PacksPanel snap={localSnap} />));
    expect(await screen.findByText("Document & Lease Validation")).toBeInTheDocument();
    expect(screen.getByText("Orazaka Media Toolkit")).toBeInTheDocument();
    expect(screen.getAllByText("🛡 SENSITIVE").length).toBeGreaterThan(0);
  });

  it("filters packs by category", async () => {
    render(wrap(<PacksPanel snap={localSnap} />));
    await screen.findByText("Document & Lease Validation");
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    expect(screen.getByText("Orazaka Media Toolkit")).toBeInTheDocument();
    expect(screen.queryByText("Document & Lease Validation")).toBeNull();
  });

  it("opens details modal and displays scope guard refusal terms", async () => {
    render(wrap(<PacksPanel snap={localSnap} />));
    const inspectButtons = await screen.findAllByRole("button", { name: "Inspect" });
    fireEvent.click(inspectButtons[0]);
    expect(await screen.findByText(/Statutorily Refused Terms/)).toBeInTheDocument();
    expect(screen.getAllByText(/conseil juridique/).length).toBeGreaterThan(0);
  });
});

describe("StudioPanel", () => {
  it("renders blueprints catalogue", async () => {
    render(wrap(<StudioPanel snap={localSnap} />));
    expect(await screen.findByText("Quebec Residential Lease Compliance Audit")).toBeInTheDocument();
    expect(screen.getByText("Artisan Project Storefront Creator")).toBeInTheDocument();
  });

  it("launches a blueprint saga and tracks execution steps", async () => {
    render(wrap(<StudioPanel snap={localSnap} />));
    const runButtons = await screen.findAllByRole("button", { name: "Configure & Run" });
    fireEvent.click(runButtons[0]);

    expect(await screen.findByText("Launch Saga")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch Saga" }));

    expect(await screen.findByText("Saga Execution Timeline")).toBeInTheDocument();
    expect(screen.getByText("RUNNING")).toBeInTheDocument();

    const advanceBtn = screen.getByRole("button", { name: "Advance Step" });
    fireEvent.click(advanceBtn);
    fireEvent.click(advanceBtn);
    fireEvent.click(advanceBtn);
    fireEvent.click(advanceBtn);

    expect(await screen.findByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText(/Execution Certificate/)).toBeInTheDocument();
  });
});

describe("Mode Switcher in App Header", () => {
  it("switches from local to remote cloud mode when clicking header switcher", async () => {
    render(wrap(<App />));
    const switcher = await screen.findByTestId("mode-switcher");
    expect(switcher).toHaveTextContent("Local (Apple Silicon)");

    fireEvent.click(switcher);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({ mode: "remote" }),
      });
    });
  });
});
