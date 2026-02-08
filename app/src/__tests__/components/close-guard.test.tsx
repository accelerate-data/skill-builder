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

  it("shows agents-running dialog when agents are active", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(true);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(screen.getByText("Agents Still Running")).toBeInTheDocument();
    });
  });

  it("shows dirty-worktree dialog when workspace has changes", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(false);
      if (cmd === "get_settings")
        return Promise.resolve({
          workspace_path: "/some/path",
          github_token: "token",
          anthropic_api_key: null,
          github_repo: null,
          auto_commit: true,
          auto_push: false,
        });
      if (cmd === "git_file_status")
        return Promise.resolve([{ path: "file.txt", status: "modified" }]);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(screen.getByText("Uncommitted Changes")).toBeInTheDocument();
    });
  });

  it("closes immediately when no agents and clean worktree", async () => {
    const destroyFn = vi.fn(() => Promise.resolve());
    mockGetCurrentWindow.mockReturnValue({
      close: vi.fn(() => Promise.resolve()),
      destroy: destroyFn,
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(false);
      if (cmd === "get_settings")
        return Promise.resolve({
          workspace_path: "/some/path",
          github_token: "token",
          anthropic_api_key: null,
          github_repo: null,
          auto_commit: true,
          auto_push: false,
        });
      if (cmd === "git_file_status") return Promise.resolve([]);
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(destroyFn).toHaveBeenCalled();
    });
  });

  it("closes immediately when no workspace path configured", async () => {
    const destroyFn = vi.fn(() => Promise.resolve());
    mockGetCurrentWindow.mockReturnValue({
      close: vi.fn(() => Promise.resolve()),
      destroy: destroyFn,
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "has_running_agents") return Promise.resolve(false);
      if (cmd === "get_settings")
        return Promise.resolve({
          workspace_path: null,
          github_token: null,
          anthropic_api_key: null,
          github_repo: null,
          auto_commit: true,
          auto_push: false,
        });
      return Promise.reject(new Error(`Unmocked: ${cmd}`));
    });

    render(<CloseGuard />);
    closeRequestedCallback?.();

    await waitFor(() => {
      expect(destroyFn).toHaveBeenCalled();
    });
  });

  it("Go Back button dismisses agents-running dialog", async () => {
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

    await user.click(screen.getByText("Go Back"));

    await waitFor(() => {
      expect(screen.queryByText("Agents Still Running")).not.toBeInTheDocument();
    });
  });
});
