import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, QueryClientProvider } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));

import { NewAutomationForm } from "../components/automations/NewAutomationForm";
import { I18nProvider } from "../lib/i18n";

const defaults = { version: 1, policy: { maxFilesPerRun: 10, maxTokensPerRun: 60000, maxRunsPerDay: 3, maxCharsPerDocument: 24000 }, model: { baseUrl: "http://a.test/v1", model: "none" }, time: "08:00", dryRun: false };

beforeEach(() => invoke.mockReset());

describe("NewAutomationForm — the models of the server in the field", () => {
  it("never shows the models of an address since replaced, even when its answer comes last", async () => {
    let answerA!: (models: string[]) => void;
    const late = new Promise<string[]>((resolve) => (answerA = resolve));
    invoke.mockImplementation(async (cmd: string, args?: { baseUrl?: string }) => {
      if (cmd !== "models_list") return undefined;
      return args?.baseUrl === "http://a.test/v1" ? late : ["model-from-b"];
    });
    render(
      <QueryClientProvider client={createQueryClient({ maxRetries: 0 })}>
        <ThemeProvider defaultMode="dark">
          <I18nProvider locale="en">
            <NewAutomationForm roots={["/w"]} defaults={defaults} onCancel={() => undefined} onCreated={() => undefined} />
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(document.getElementById("auto-base") as HTMLInputElement, { target: { value: "http://b.test/v1" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "model-from-b" })).toBeInTheDocument());
    answerA(["model-from-a"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("option", { name: "model-from-a" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "model-from-b" })).toBeInTheDocument();
  });
});
