import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CloseGuard } from "@/components/close-guard";
import { mockInvoke, mockListen, mockGetCurrentWindow, resetTauriMocks } from "@/test/mocks/tauri";

describe("CloseGuard", () => {
  let closeRequestedCallback: (() => void) | null = null;

  beforeEach(() => {
    resetTauriMocks();
    closeRequestedCallback = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockListen as any).mockImplementation((eventName: string, callback: () => void) => {
      if (eventName === "close-requested") {
        closeRequestedCallback = callback;
      }
      return Promise.resolve(() => {});
    });
  });

  it("renders nothing initially", () => {
    const { container } = render(<CloseGuard />);
    expect(container.innerHTML).toBe("");
  });

  it("registers close-requested listener on mount", () => {
    render(<CloseGuard />);
    expect(mockListen).toHaveBeenCalledWith(
      "close-requested",
      expect.any(Function)
    );
  });

  it("shows dialog with Stay and Close Anyway when agents are running", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(true);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(screen.getByText("Agents Still Running")).toBeInTheDocument();
    });

    expect(screen.getByText("Stay")).toBeInTheDocument();
    expect(screen.getByText("Close Anyway")).toBeInTheDocument();
  });

  it("closes immediately when no agents running", async () => {
    const destroyFn = vi.fn(() => Promise.resolve());
    mockGetCurrentWindow.mockReturnValue({
      close: vi.fn(() => Promise.resolve()),
      destroy: destroyFn,
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(false);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(destroyFn).toHaveBeenCalled();
    });
  });

  it("Stay button dismisses dialog", async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(true);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(screen.getByText("Agents Still Running")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Stay"));

    await waitFor(() => {
      expect(screen.queryByText("Agents Still Running")).not.toBeInTheDocument();
    });
  });

  it("Close Anyway calls cancelAllAgents then destroys window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const destroyFn = vi.fn(() => Promise.resolve());
    mockGetCurrentWindow.mockReturnValue({
      close: vi.fn(() => Promise.resolve()),
      destroy: destroyFn,
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(true);
      if (cmd === "cancel_all_agents") return Promise.resolve(null);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(screen.getByText("Close Anyway")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Close Anyway"));

    // Button should show "Closing..." state
    await waitFor(() => {
      expect(screen.getByText("Closing...")).toBeInTheDocument();
    });

    // cancel_all_agents should have been called
    expect(mockInvoke).toHaveBeenCalledWith("cancel_all_agents");

    // Advance past the 500ms delay
    await vi.advanceTimersByTimeAsync(600);

    await waitFor(() => {
      expect(destroyFn).toHaveBeenCalled();
    });

    vi.useRealTimers();
  });
});
