import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector) => selector({ preferredModel: "sonnet" })),
}));

vi.mock("@/lib/tauri", () => ({
  generateEvalQueries: vi.fn(),
  runOptimizationLoop: vi.fn(),
  applyDescription: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { WorkspaceDescription } from "@/components/workspace/workspace-description";
import { generateEvalQueries, runOptimizationLoop, applyDescription } from "@/lib/tauri";

const baseSkill: SkillSummary = {
  name: "support-tickets",
  description: "A skill for handling customer support tickets",
  current_step: null,
  status: "completed",
  last_modified: "2026-01-01T00:00:00Z",
  tags: [],
  purpose: "domain",
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  source: null,
  version: "1.0.0",
  model: null,
  argumentHint: null,
  userInvocable: null,
  disableModelInvocation: null,
};

const twoQueries = [
  { id: "1", query: "Customer wants a refund", should_trigger: true },
  { id: "2", query: "Write a Python script", should_trigger: false },
];

const optimizationResult = {
  ok: true,
  best_description: "Use when a customer needs help with returns or billing",
  original_description: "A skill for handling customer support tickets",
  best_score: "0.90",
  best_train_score: "0.90",
  best_test_score: "0.90",
  iterations_run: 2,
  history: [
    {
      iteration: 1,
      description: "...",
      train_passed: 5,
      train_total: 10,
      test_passed: 5,
      test_total: 10,
    },
    {
      iteration: 2,
      description: "...",
      train_passed: 9,
      train_total: 10,
      test_passed: 9,
      test_total: 10,
    },
  ],
};

function renderComponent() {
  return render(
    <WorkspaceDescription
      skill={baseSkill}
      workspacePath="/workspace/support-tickets"
    />,
  );
}

describe("WorkspaceDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders current description and disabled Proceed button on initial load", () => {
    renderComponent();

    expect(
      screen.getByText(/A skill for handling customer support tickets/i),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /generate 20 queries/i }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /proceed to optimize/i }),
    ).toBeDisabled();
  });

  it("generates queries and enables Proceed button", async () => {
    vi.mocked(generateEvalQueries).mockResolvedValue(twoQueries);

    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /generate 20 queries/i }));

    // Queries are rendered as Input elements — find by display value
    expect(await screen.findByDisplayValue("Customer wants a refund")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /proceed to optimize/i })).toBeEnabled();

    expect(screen.getByText("Should trigger")).toBeInTheDocument();
    expect(screen.getByText("Should not trigger")).toBeInTheDocument();
  });

  it("shows progress view (step 2) after clicking Proceed", async () => {
    vi.mocked(generateEvalQueries).mockResolvedValue(twoQueries);
    vi.mocked(runOptimizationLoop).mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /generate 20 queries/i }));
    await screen.findByDisplayValue("Customer wants a refund");

    await user.click(screen.getByRole("button", { name: /proceed to optimize/i }));

    // "Step 2: Optimization Loop" heading appears in step 2 content
    await waitFor(() => {
      expect(screen.getAllByText(/optimization loop/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/running up to 5 iterations/i)).toBeInTheDocument();
  });

  it("displays results table and diff after optimization completes", async () => {
    vi.mocked(generateEvalQueries).mockResolvedValue(twoQueries);
    vi.mocked(runOptimizationLoop).mockResolvedValue(optimizationResult);

    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /generate 20 queries/i }));
    await screen.findByDisplayValue("Customer wants a refund");

    await user.click(screen.getByRole("button", { name: /proceed to optimize/i }));

    expect(await screen.findByRole("button", { name: /apply best description/i })).toBeInTheDocument();

    // "Step 3: Apply Result" heading appears in step 3 content (the stepper also has "Apply Result")
    expect(screen.getAllByText(/apply result/i).length).toBeGreaterThan(0);

    expect(screen.getByRole("button", { name: /apply best description/i })).toBeEnabled();

    expect(screen.getByText("best")).toBeInTheDocument();
  });

  it("calls applyDescription and shows success toast", async () => {
    vi.mocked(generateEvalQueries).mockResolvedValue(twoQueries);
    vi.mocked(runOptimizationLoop).mockResolvedValue(optimizationResult);
    vi.mocked(applyDescription).mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /generate 20 queries/i }));
    await screen.findByDisplayValue("Customer wants a refund");

    await user.click(screen.getByRole("button", { name: /proceed to optimize/i }));

    const applyBtn = await screen.findByRole("button", { name: /apply best description/i });
    await user.click(applyBtn);

    expect(await screen.findByText(/description applied successfully/i)).toBeInTheDocument();

    expect(vi.mocked(applyDescription)).toHaveBeenCalledWith(
      "support-tickets",
      "/workspace/support-tickets",
      "Use when a customer needs help with returns or billing",
    );
  });

  it("Run again resets to step 1 and keeps queries", async () => {
    vi.mocked(generateEvalQueries).mockResolvedValue(twoQueries);
    vi.mocked(runOptimizationLoop).mockResolvedValue(optimizationResult);

    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole("button", { name: /generate 20 queries/i }));
    await screen.findByDisplayValue("Customer wants a refund");

    await user.click(screen.getByRole("button", { name: /proceed to optimize/i }));
    await screen.findByRole("button", { name: /apply best description/i });

    await user.click(screen.getByRole("button", { name: /run again/i }));

    await waitFor(() => {
      const generateBtn =
        screen.queryByRole("button", { name: /generate 20 queries/i }) ??
        screen.queryByRole("button", { name: /regenerate/i });
      expect(generateBtn).toBeInTheDocument();
    });

    expect(
      screen.getByText(/A skill for handling customer support tickets/i),
    ).toBeInTheDocument();
  });
});
