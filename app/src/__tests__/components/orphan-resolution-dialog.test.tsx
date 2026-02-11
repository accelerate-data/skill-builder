import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";
import type { OrphanSkill } from "@/lib/types";

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

import OrphanResolutionDialog from "@/components/orphan-resolution-dialog";

const sampleOrphans: OrphanSkill[] = [
  { skill_name: "sales-pipeline", domain: "sales", skill_type: "platform" },
  { skill_name: "hr-analytics", domain: "HR", skill_type: "domain" },
];

describe("OrphanResolutionDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders dialog with orphan list when open", () => {
    render(
      <OrphanResolutionDialog
        orphans={sampleOrphans}
        open={true}
        onResolved={vi.fn()}
      />
    );

    expect(screen.getByText("Orphaned Skills Found")).toBeInTheDocument();
    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    expect(screen.getByText("hr-analytics")).toBeInTheDocument();
  });

  it("displays orphan metadata (domain and type)", () => {
    render(
      <OrphanResolutionDialog
        orphans={[sampleOrphans[0]]}
        open={true}
        onResolved={vi.fn()}
      />
    );

    // domain and type label are rendered together in a single metadata span
    expect(screen.getByText(/sales.*Platform/)).toBeInTheDocument();
  });

  it("shows Delete and Keep buttons for each orphan", () => {
    render(
      <OrphanResolutionDialog
        orphans={sampleOrphans}
        open={true}
        onResolved={vi.fn()}
      />
    );

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    const keepButtons = screen.getAllByRole("button", { name: /Keep/i });

    expect(deleteButtons).toHaveLength(2);
    expect(keepButtons).toHaveLength(2);
  });

  it("calls resolve_orphan with 'delete' action when Delete is clicked", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <OrphanResolutionDialog
        orphans={[sampleOrphans[0]]}
        open={true}
        onResolved={vi.fn()}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("resolve_orphan", {
        skillName: "sales-pipeline",
        action: "delete",
      });
    });

    expect(toast.success).toHaveBeenCalledWith(
      'Orphaned skill "sales-pipeline" deleted'
    );
  });

  it("calls resolve_orphan with 'keep' action when Keep is clicked", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <OrphanResolutionDialog
        orphans={[sampleOrphans[0]]}
        open={true}
        onResolved={vi.fn()}
      />
    );

    const keepButton = screen.getByRole("button", { name: /Keep/i });
    await user.click(keepButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("resolve_orphan", {
        skillName: "sales-pipeline",
        action: "keep",
      });
    });

    expect(toast.success).toHaveBeenCalledWith(
      'Orphaned skill "sales-pipeline" kept and reset'
    );
  });

  it("removes resolved orphan from the list", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <OrphanResolutionDialog
        orphans={sampleOrphans}
        open={true}
        onResolved={vi.fn()}
      />
    );

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
    expect(screen.getByText("hr-analytics")).toBeInTheDocument();

    // Delete the first orphan
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText("sales-pipeline")).not.toBeInTheDocument();
    });

    // Second orphan should still be visible
    expect(screen.getByText("hr-analytics")).toBeInTheDocument();
  });

  it("calls onResolved when all orphans are resolved", async () => {
    const user = userEvent.setup();
    const onResolved = vi.fn();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <OrphanResolutionDialog
        orphans={[sampleOrphans[0]]}
        open={true}
        onResolved={onResolved}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it("shows error toast on failed resolution", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("DB locked"));

    render(
      <OrphanResolutionDialog
        orphans={[sampleOrphans[0]]}
        open={true}
        onResolved={vi.fn()}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /Delete/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to resolve "sales-pipeline": DB locked',
        { duration: Infinity },
      );
    });

    // Orphan should still be visible after failure
    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("shows remaining orphan count", () => {
    render(
      <OrphanResolutionDialog
        orphans={sampleOrphans}
        open={true}
        onResolved={vi.fn()}
      />
    );

    expect(screen.getByText("2 orphans remaining")).toBeInTheDocument();
  });

  it("uses singular text for 1 orphan", () => {
    render(
      <OrphanResolutionDialog
        orphans={[sampleOrphans[0]]}
        open={true}
        onResolved={vi.fn()}
      />
    );

    expect(screen.getByText("1 orphan remaining")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(
      <OrphanResolutionDialog
        orphans={sampleOrphans}
        open={false}
        onResolved={vi.fn()}
      />
    );

    expect(
      screen.queryByText("Orphaned Skills Found")
    ).not.toBeInTheDocument();
  });
});
