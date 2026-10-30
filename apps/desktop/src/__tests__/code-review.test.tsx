import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@krizaka/ui/theme";
import type { CodeFileProposal } from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { ReviewPanel } from "../components/code/ReviewPanel";

const hunk = (id: number, over: Partial<CodeFileProposal["hunks"][number]> = {}) => ({
  id, oldStart: id * 10, oldLines: [`old ${id}\n`], newLines: [`new ${id}\n`], execSurface: false, addsSecret: false, ...over,
});
const wrap = (ui: React.ReactNode) => <ThemeProvider defaultMode="dark"><I18nProvider locale="en">{ui}</I18nProvider></ThemeProvider>;

describe("ReviewPanel", () => {
  it("sends only the approved hunks: two of three approved, the third stays unwritten", () => {
    const file: CodeFileProposal = { path: "lines.txt", baseHash: "h", hunks: [hunk(0), hunk(1), hunk(2)] };
    const onApply = vi.fn();
    render(wrap(<ReviewPanel files={[file]} onApply={onApply} />));
    const hunks = screen.getAllByTestId("hunk");
    expect(hunks).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Write the approved changes" })).toBeDisabled();
    fireEvent.click(within(hunks[0]).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(hunks[1]).getByRole("button", { name: "Reject" }));
    fireEvent.click(within(hunks[2]).getByRole("button", { name: "Approve" }));
    expect(screen.getByText("2 of 3 changes approved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Write the approved changes" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual([{ file, approved: [0, 2] }]);
  });

  it("leaves an undecided hunk unwritten", () => {
    const file: CodeFileProposal = { path: "a.txt", baseHash: "h", hunks: [hunk(0), hunk(1)] };
    const onApply = vi.fn();
    render(wrap(<ReviewPanel files={[file]} onApply={onApply} />));
    fireEvent.click(within(screen.getAllByTestId("hunk")[1]).getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Write the approved changes" }));
    expect(onApply.mock.calls[0][0][0].approved).toEqual([1]);
  });

  it("badges a package.json scripts hunk « Changes what runs » and only that one", () => {
    const file: CodeFileProposal = { path: "package.json", baseHash: "h", hunks: [hunk(0, { execSurface: true }), hunk(1)] };
    render(wrap(<ReviewPanel files={[file]} onApply={vi.fn()} />));
    const hunks = screen.getAllByTestId("hunk");
    expect(within(hunks[0]).getByText("Changes what runs")).toBeInTheDocument();
    expect(within(hunks[1]).queryByText("Changes what runs")).toBeNull();
  });

  it("warns when a hunk adds a token-shaped string", () => {
    const file: CodeFileProposal = { path: "a.ts", baseHash: null, hunks: [hunk(0, { addsSecret: true })] };
    render(wrap(<ReviewPanel files={[file]} onApply={vi.fn()} />));
    expect(screen.getByText("Contains a token-shaped string")).toBeInTheDocument();
    expect(screen.getByText("New file")).toBeInTheDocument();
  });
});
