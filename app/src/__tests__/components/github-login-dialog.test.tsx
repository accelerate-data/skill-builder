import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuthStore } from "@/stores/auth-store";
import type { DeviceFlowResponse } from "@/lib/types";

// Mock Tauri commands — vi.hoisted ensures these are available during vi.mock hoisting
const {
  mockGithubStartDeviceFlow,
  mockGithubPollForToken,
} = vi.hoisted(() => ({
  mockGithubStartDeviceFlow: vi.fn<() => Promise<DeviceFlowResponse>>(),
  mockGithubPollForToken: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  githubStartDeviceFlow: mockGithubStartDeviceFlow,
  githubPollForToken: mockGithubPollForToken,
  githubGetUser: vi.fn(() => Promise.resolve(null)),
  githubLogout: vi.fn(() => Promise.resolve()),
}));

// Mock @tauri-apps/plugin-opener (used by handleOpenGitHub)
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { GitHubLoginDialog } from "@/components/github-login-dialog";

const MOCK_DEVICE_RESPONSE: DeviceFlowResponse = {
  device_code: "test-device-code",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

describe("GitHubLoginDialog", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    mockGithubStartDeviceFlow.mockReset().mockResolvedValue(MOCK_DEVICE_RESPONSE);
    mockGithubPollForToken.mockReset().mockResolvedValue({ status: "pending" });
  });

  it("renders dialog content when open", async () => {
    render(<GitHubLoginDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Sign in with GitHub")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(<GitHubLoginDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Sign in with GitHub")).not.toBeInTheDocument();
  });

  it("shows loading state initially before device flow response", () => {
    // Make device flow hang (never resolve)
    mockGithubStartDeviceFlow.mockReturnValue(new Promise(() => {}));
    render(<GitHubLoginDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText("Starting authentication...")).toBeInTheDocument();
  });

  it("calls githubStartDeviceFlow when dialog opens", () => {
    render(<GitHubLoginDialog open={true} onOpenChange={vi.fn()} />);
    expect(mockGithubStartDeviceFlow).toHaveBeenCalledTimes(1);
  });

  it("shows device code after starting flow", async () => {
    render(<GitHubLoginDialog open={true} onOpenChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    });
    expect(screen.getByText("Open GitHub")).toBeInTheDocument();
  });

  it("shows error state when device flow fails", async () => {
    mockGithubStartDeviceFlow.mockRejectedValue(new Error("Network error"));
    render(<GitHubLoginDialog open={true} onOpenChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });

  it("starts polling after clicking Open GitHub", async () => {
    const user = userEvent.setup();
    render(<GitHubLoginDialog open={true} onOpenChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Open GitHub")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Open GitHub"));

    await waitFor(() => {
      expect(screen.getByText("Waiting for authorization...")).toBeInTheDocument();
    });
  });
});
