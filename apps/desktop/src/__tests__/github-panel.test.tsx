import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, QueryClientProvider } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";
import type { GithubStatus } from "../lib/api";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import { I18nProvider } from "../lib/i18n";
import { GithubPanel } from "../components/code/GithubPanel";

const code = { user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };
let status: GithubStatus;
const wrap = (locale: "en" | "fr" = "en") => (
  <QueryClientProvider client={createQueryClient({ maxRetries: 0 })}>
    <ThemeProvider defaultMode="dark"><I18nProvider locale={locale}><GithubPanel /></I18nProvider></ThemeProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  status = { connected: false, pending: null, failure: null };
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "github_status") return status;
    if (cmd === "github_sign_in") { status = { connected: false, pending: code, failure: null }; return code; }
    if (cmd === "github_sign_out") { status = { connected: false, pending: null, failure: null }; return null; }
    throw new Error(`unexpected ${cmd}`);
  });
});

describe("GithubPanel", () => {
  it("shows the code to type and where after Connect, and never asks for a token", async () => {
    render(wrap());
    fireEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    expect((await screen.findByTestId("github-user-code")).textContent).toBe("ABCD-1234");
    expect(screen.getByRole("link", { name: "Open GitHub" }).getAttribute("href")).toBe("https://github.com/login/device");
    expect(invoke.mock.calls.every(([cmd]) => ["github_status", "github_sign_in"].includes(cmd as string))).toBe(true);
  });

  it("shows a connected state and disconnects", async () => {
    status = { connected: true, pending: null, failure: null };
    render(wrap());
    expect(await screen.findByText("GitHub is connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("github_sign_out"));
    expect(await screen.findByRole("button", { name: "Connect GitHub" })).toBeTruthy();
  });

  it("says why a sign-in failed, in French too", async () => {
    status = { connected: false, pending: null, failure: "the request was denied" };
    render(wrap("fr"));
    expect(await screen.findByText("the request was denied")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connecter GitHub" })).toBeTruthy();
  });
});
