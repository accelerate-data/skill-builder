import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AboutDialog } from "@/components/about-dialog";
import { mockGetVersion } from "@/test/mocks/tauri";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

describe("AboutDialog", () => {
  it("renders dialog content when open", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Skill Builder")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(<AboutDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Skill Builder")).not.toBeInTheDocument();
  });

  it("shows version number from getVersion", async () => {
    mockGetVersion.mockResolvedValue("1.5.0");
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Version 1.5.0")).toBeInTheDocument();
    });
  });

  it("shows Accelerate Data attribution", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Website")).toBeInTheDocument();
  });

  it("shows app icon images for light and dark themes", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    const imgs = screen.getAllByAltText("Skill Builder");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "/icon-dark-256.png");
    expect(imgs[1]).toHaveAttribute("src", "/icon-256.png");
  });

  it("shows Powered by Claude from Anthropic", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Anthropic")).toBeInTheDocument();
  });

  it("shows disclaimer text", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Experimental Software/)).toBeInTheDocument();
    expect(screen.getByText(/without warranty/)).toBeInTheDocument();
  });

  it("shows copyright notice", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(`${year} Accelerate Data`))).toBeInTheDocument();
  });

  it("shows built-with credits", () => {
    render(<AboutDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Tauri")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Claude Agent SDK")).toBeInTheDocument();
  });
});
