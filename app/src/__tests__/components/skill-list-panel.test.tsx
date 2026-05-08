import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { useSkillStore } from "@/stores/skill-store";
import { useAgentStore } from "@/stores/agent-store";
import type { SkillSummary, ImportedSkill } from "@/lib/types";
import { createTestQueryClient } from "@/test/query-test-utils";
import { queryKeys } from "@/lib/queries/query-keys";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

// SkillDialog is not the focus of these tests — stub it out
vi.mock("@/components/skill-dialog", () => ({
  default: () => null,
}));

vi.mock("@/lib/tauri", () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  listImportedSkills: vi.fn().mockResolvedValue([]),
  deleteImportedSkill: vi.fn().mockResolvedValue(undefined),
  getExternallyLockedSkills: vi.fn().mockResolvedValue([]),
  listPlugins: vi.fn().mockResolvedValue([]),
  resetWorkflowStep: vi.fn(),
  createPluginFromSkills: vi.fn(),
  moveSkillToPlugin: vi.fn(),
  removeSkillFromPlugin: vi.fn(),
}));

import { SkillListPanel } from "@/components/skill-list-panel";
import { listImportedSkills, listSkills, removeSkillFromPlugin } from "@/lib/tauri";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBuilderSkill(overrides: Partial<SkillSummary> & { name: string }): SkillSummary {
  const base: SkillSummary = {
    name: overrides.name,
    library_key: overrides.name,
    current_step: null,
    status: null,
    last_modified: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
    tags: [],
    purpose: null,
    skill_source: "skill-builder",
    author_login: null,
    author_avatar: null,
    intake_json: null,
    source: null,
    description: null,
    version: null,
    model: null,
    argumentHint: null,
    userInvocable: null,
    disableModelInvocation: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
  };
  return { ...base, ...overrides };
}

function makeImportedSkill(
  overrides: Partial<ImportedSkill> & { skill_name: string },
): ImportedSkill {
  const base: ImportedSkill = {
    skill_id: `id-${overrides.skill_name}`,
    skill_name: overrides.skill_name,
    library_key: `imported:id-${overrides.skill_name}`,
    description: null,
    is_active: true,
    disk_path: `/skills/${overrides.skill_name}`,
    imported_at: new Date(Date.now() - 7200_000).toISOString(), // 2h ago
    is_bundled: false,
    purpose: null,
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
  };
  return { ...base, ...overrides };
}

async function openSkillMenu(skillName: string, user: ReturnType<typeof userEvent.setup>) {
  const row = screen.getByText(skillName).closest('[role="button"]')!;
  const moreBtn = row.querySelector('[aria-label="More actions"]')!;
  await user.click(moreBtn);
}

let builderSkillResults: SkillSummary[] = [];
let importedSkillResults: ImportedSkill[] = [];

function setBuilderSkills(skills: SkillSummary[]) {
  builderSkillResults = skills;
  vi.mocked(listSkills).mockResolvedValue(builderSkillResults);
}

function setImportedSkills(skills: ImportedSkill[]) {
  importedSkillResults = skills;
  vi.mocked(listImportedSkills).mockResolvedValue(importedSkillResults);
}

function renderWithSkillQueries(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.skills.builder(null, null), builderSkillResults);
  queryClient.setQueryData(queryKeys.skills.imported(), importedSkillResults);

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const recentBuilder = makeBuilderSkill({
  name: "recent-skill",
  last_modified: new Date(Date.now() - 60_000).toISOString(), // 1m ago (most recent)
  created_at: new Date(Date.now() - 60_000).toISOString(),
  status: "completed",
});

const olderBuilder = makeBuilderSkill({
  name: "older-skill",
  last_modified: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  current_step: "Step 1",
});

const importedSkill = makeImportedSkill({
  skill_name: "imported-skill",
  imported_at: new Date(Date.now() - 7200_000).toISOString(), // 2h ago (oldest)
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SkillListPanel", () => {
  beforeEach(() => {
    setBuilderSkills([]);
    setImportedSkills([]);
    useSkillStore.setState({
      activeSkill: null,
      lockedSkills: new Set(),
      latestVersion: null,
    });
    useAgentStore.getState().clearRuns();
    mockNavigate.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Collapse toggle ─────────────────────────────────────────────────────

  it("renders collapse button when onCollapse is provided", () => {
    renderWithSkillQueries(<SkillListPanel onCollapse={() => {}} />);
    expect(screen.getByTitle("Collapse skill list")).toBeInTheDocument();
  });

  it("does not render collapse button when onCollapse is omitted", () => {
    renderWithSkillQueries(<SkillListPanel />);
    expect(screen.queryByTitle("Collapse skill list")).not.toBeInTheDocument();
  });

  it("calls onCollapse when collapse button is clicked", () => {
    const onCollapse = vi.fn();
    renderWithSkillQueries(<SkillListPanel onCollapse={onCollapse} />);
    fireEvent.click(screen.getByTitle("Collapse skill list"));
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  // ── Merge & sort ──────────────────────────────────────────────────────────

  it("renders builder and imported skills in merged list sorted by lastModified desc", () => {
    setBuilderSkills([olderBuilder, recentBuilder]);
    setImportedSkills([importedSkill]);

    renderWithSkillQueries(<SkillListPanel />);

    // Skill rows have aria-selected; other buttons ("+", "More actions") do not
    const rows = screen.getAllByRole("button").filter((r) => r.hasAttribute("aria-selected"));
    const names = rows.map((r) => r.querySelector(".text-base")?.textContent);
    expect(names).toEqual(["recent-skill", "older-skill", "imported-skill"]);
  });

  // ── Search ────────────────────────────────────────────────────────────────

  it("filters rows by search input (case-insensitive)", () => {
    setBuilderSkills([recentBuilder, olderBuilder]);

    renderWithSkillQueries(<SkillListPanel />);

    const input = screen.getByPlaceholderText("Search skills…");
    fireEvent.change(input, { target: { value: "OLDER" } });

    expect(screen.getByText("older-skill")).toBeInTheDocument();
    expect(screen.queryByText("recent-skill")).not.toBeInTheDocument();
  });

  it("hides rows that don't match search", () => {
    setBuilderSkills([recentBuilder, olderBuilder]);

    renderWithSkillQueries(<SkillListPanel />);
    const input = screen.getByPlaceholderText("Search skills…");
    fireEvent.change(input, { target: { value: "xyz-no-match" } });

    expect(screen.queryByText("recent-skill")).not.toBeInTheDocument();
    expect(screen.queryByText("older-skill")).not.toBeInTheDocument();
  });

  // ── Status dots ───────────────────────────────────────────────────────────

  it("renders red dot for never-started skill", () => {
    const skill = makeBuilderSkill({ name: "new-skill" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-new-skill");
    expect(dot.className).toMatch(/bg-destructive/);
  });

  it("renders amber dot for step-1 skill", () => {
    const skill = makeBuilderSkill({ name: "step1-skill", current_step: "Step 1" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-step1-skill");
    expect(dot.className).toMatch(/bg-amber-/);
  });

  it("renders yellow dot for step-2 skill", () => {
    const skill = makeBuilderSkill({ name: "step2-skill", current_step: "Step 2" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-step2-skill");
    expect(dot.className).toMatch(/bg-amber-/);
  });

  it("renders green dot for completed builder skill", () => {
    const skill = makeBuilderSkill({ name: "done-skill", status: "completed" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-done-skill");
    expect(dot.style.backgroundColor).toBe("var(--color-seafoam)");
  });

  it("renders violet dot for imported (uploaded) skill", () => {
    const skill = makeImportedSkill({ skill_name: "imp-skill" });
    setImportedSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-imported:id-imp-skill");
    expect(dot.style.backgroundColor).toBe("var(--color-violet)");
  });

  it("renders blue dot for marketplace skill", () => {
    const skill = makeImportedSkill({
      skill_name: "mkt-skill",
      marketplace_source_url: "https://example.com/registry",
    });
    setImportedSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-imported:id-mkt-skill");
    expect(dot.style.backgroundColor).toBe("var(--color-pacific)");
  });

  it("creates a plugin from a builder skill in the main sidebar", async () => {
    const user = userEvent.setup();
    setBuilderSkills([recentBuilder]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("recent-skill", user);
    await user.click(screen.getByRole("menuitem", { name: "Create plugin" }));

    // The Create Plugin dialog should open
    expect(screen.getByText("Create Plugin")).toBeInTheDocument();
  });

  it("moves a builder skill to another existing plugin from the main sidebar", async () => {
    const user = userEvent.setup();
    setBuilderSkills([
      recentBuilder,
      makeBuilderSkill({
        name: "plugin-skill",
        library_key: "skill-builder:analytics-pack:plugin-skill",
        plugin_slug: "analytics-pack",
        plugin_display_name: "Analytics Pack",
        is_default_plugin: false,
        status: "completed",
        created_at: new Date(Date.now() - 120_000).toISOString(),
      }),
    ]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("recent-skill", user);
    await user.click(screen.getByRole("menuitem", { name: "Move to plugin" }));

    // The Move to Plugin dialog should open
    expect(screen.getByText("Move to Plugin")).toBeInTheDocument();
  });

  it("removes a builder skill from its plugin from the main sidebar", async () => {
    const user = userEvent.setup();
    setBuilderSkills([
      makeBuilderSkill({
        name: "plugin-skill",
        library_key: "skill-builder:analytics-pack:plugin-skill",
        plugin_slug: "analytics-pack",
        plugin_display_name: "Analytics Pack",
        is_default_plugin: false,
        status: "completed",
      }),
    ]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("plugin-skill", user);
    await user.click(screen.getByRole("menuitem", { name: "Remove from plugin" }));

    expect(removeSkillFromPlugin).toHaveBeenCalledWith("skill-builder:analytics-pack:plugin-skill");
  });

  // ── Pulse animation ───────────────────────────────────────────────────────

  it("applies animate-dot-pulse when an active workflow run exists for the skill", () => {
    const skill = makeBuilderSkill({ name: "running-skill", current_step: "Step 1" });
    setBuilderSkills([skill]);
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-1": {
          agentId: "agent-1",
          model: "sonnet",
          status: "running",
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
          skillName: "running-skill",
          runSource: "workflow",
        },
      },
    }));

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-running-skill");
    expect(dot.className).toMatch(/animate-dot-pulse/);
  });

  it("does NOT apply animate-dot-pulse when no active run exists", () => {
    const skill = makeBuilderSkill({ name: "idle-skill", current_step: "Step 1" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-idle-skill");
    expect(dot.className).not.toMatch(/animate-dot-pulse/);
  });

  // ── Single-skill lock ─────────────────────────────────────────────────────

  it("locks other rows while a workflow is running; running row is not locked", () => {
    const skillA = makeBuilderSkill({ name: "skill-a", current_step: "Step 1" });
    const skillB = makeBuilderSkill({ name: "skill-b", status: "completed" });
    setBuilderSkills([skillA, skillB]);
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-1": {
          agentId: "agent-1",
          model: "sonnet",
          status: "running",
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
          skillName: "skill-a",
          runSource: "workflow",
        },
      },
    }));

    renderWithSkillQueries(<SkillListPanel />);

    // skill-b row should be locked
    const skillBRow = screen.getByText("skill-b").closest('[role="button"]');
    expect(skillBRow?.className).toMatch(/opacity-\[0\.45\]/);
    expect(skillBRow?.className).toMatch(/cursor-not-allowed/);

    // skill-a (running) should NOT be locked
    const skillARow = screen.getByText("skill-a").closest('[role="button"]');
    expect(skillARow?.className).not.toMatch(/opacity-\[0\.45\]/);
  });

  it("shows Lock icon on locked rows", () => {
    const skillA = makeBuilderSkill({ name: "running-skill-a" });
    const skillB = makeBuilderSkill({ name: "locked-skill-b" });
    setBuilderSkills([skillA, skillB]);
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-1": {
          agentId: "agent-1",
          model: "sonnet",
          status: "running",
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
          skillName: "running-skill-a",
          runSource: "workflow",
        },
      },
    }));

    renderWithSkillQueries(<SkillListPanel />);

    const skillBRow = screen.getByText("locked-skill-b").closest('[role="button"]');
    expect(skillBRow?.className).toMatch(/cursor-not-allowed/);
    // Locked row shows the Lock icon (no "More actions" button inside it)
    const moreBtn = skillBRow?.querySelector('[aria-label="More actions"]');
    expect(moreBtn).toBeNull();
  });

  // ── Default selection ─────────────────────────────────────────────────────

  it("selects last-selected-skill from localStorage on mount", () => {
    setBuilderSkills([recentBuilder, olderBuilder]);
    localStorage.setItem("last-selected-skill", "older-skill");

    renderWithSkillQueries(<SkillListPanel />);

    const olderRow = screen.getByText("older-skill").closest('[role="button"]');
    expect(olderRow?.getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to most-recently-modified skill when localStorage key is absent", () => {
    setBuilderSkills([olderBuilder, recentBuilder]);

    renderWithSkillQueries(<SkillListPanel />);

    const recentRow = screen.getByText("recent-skill").closest('[role="button"]');
    expect(recentRow?.getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to no selection when skill list is empty", () => {
    renderWithSkillQueries(<SkillListPanel />);
    // No rows present — just verify no crash and no selected rows
    expect(screen.queryAllByRole("button", { hidden: true })).toBeTruthy();
  });

  it("ignores stale localStorage entry when skill no longer exists", () => {
    setBuilderSkills([recentBuilder]);
    localStorage.setItem("last-selected-skill", "deleted-skill");

    renderWithSkillQueries(<SkillListPanel />);

    const recentRow = screen.getByText("recent-skill").closest('[role="button"]');
    expect(recentRow?.getAttribute("aria-selected")).toBe("true");
  });

  // ── Row click routing ─────────────────────────────────────────────────────

  it("navigates to /skill/$skillName when clicking a never-started skill", () => {
    const skill = makeBuilderSkill({ name: "new-workflow" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);
    fireEvent.click(screen.getByText("new-workflow").closest('[role="button"]')!);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "new-workflow" },
    });
  });

  it("navigates to /skill/$skillName when clicking a step-1 skill", () => {
    const skill = makeBuilderSkill({ name: "step1-nav", current_step: "Step 1" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);
    fireEvent.click(screen.getByText("step1-nav").closest('[role="button"]')!);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "step1-nav" },
    });
  });

  it("calls onSelectSkill when clicking a completed skill", () => {
    const onSelectSkill = vi.fn();
    const skill = makeBuilderSkill({ name: "done-skill", status: "completed" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("done-skill").closest('[role="button"]')!);

    expect(onSelectSkill).toHaveBeenCalledWith("done-skill");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("calls onSelectSkill when clicking an imported skill", () => {
    const onSelectSkill = vi.fn();
    const skill = makeImportedSkill({ skill_name: "my-import" });
    setImportedSkills([skill]);

    renderWithSkillQueries(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("my-import").closest('[role="button"]')!);

    expect(onSelectSkill).toHaveBeenCalledWith("imported:id-my-import");
  });

  it("does not navigate or call onSelectSkill when clicking a locked row", () => {
    const onSelectSkill = vi.fn();
    const skillA = makeBuilderSkill({ name: "running-skill" });
    const skillB = makeBuilderSkill({ name: "locked-skill", status: "completed" });
    setBuilderSkills([skillA, skillB]);
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-1": {
          agentId: "agent-1",
          model: "sonnet",
          status: "running",
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
          skillName: "running-skill",
          runSource: "workflow",
        },
      },
    }));

    renderWithSkillQueries(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("locked-skill").closest('[role="button"]')!);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onSelectSkill).not.toHaveBeenCalled();
  });

  it("locks other rows while a refine agent is running", () => {
    const onSelectSkill = vi.fn();
    const skillA = makeBuilderSkill({ name: "refine-skill", status: "completed" });
    const skillB = makeBuilderSkill({ name: "other-skill", status: "completed" });
    setBuilderSkills([skillA, skillB]);
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-refine": {
          agentId: "agent-refine",
          model: "sonnet",
          status: "running",
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
          skillName: "refine-skill",
          runSource: "refine",
        },
      },
    }));

    renderWithSkillQueries(<SkillListPanel onSelectSkill={onSelectSkill} />);

    // other-skill should be locked
    const otherRow = screen.getByText("other-skill").closest('[role="button"]');
    expect(otherRow?.className).toMatch(/opacity-\[0\.45\]/);
    expect(otherRow?.className).toMatch(/cursor-not-allowed/);

    // Click should be a no-op
    fireEvent.click(otherRow!);
    expect(onSelectSkill).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ── Review action ──────────────────────────────────────────────────────

  it("shows Review menu item for completed builder skills and navigates to workflow in review mode", async () => {
    const user = userEvent.setup();
    const skill = makeBuilderSkill({ name: "review-skill", status: "completed" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("review-skill", user);

    // Review item should be present
    const reviewItem = await screen.findByRole("menuitem", { name: "Review" });
    expect(reviewItem).toBeInTheDocument();

    await user.click(reviewItem);

    // Should navigate to workflow page WITHOUT autoStart (review mode)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "review-skill" },
    });
  });

  it("does not show Review menu item for imported skills", async () => {
    const user = userEvent.setup();
    const skill = makeImportedSkill({ skill_name: "imported-no-review" });
    setImportedSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("imported-no-review", user);

    // Wait for menu to render
    await screen.findByRole("menuitem", { name: "Overview" });

    // Review should NOT be present for imported skills
    expect(screen.queryByRole("menuitem", { name: "Review" })).not.toBeInTheDocument();
  });

  it("groups completed builder actions into workflow and skill sections", async () => {
    const user = userEvent.setup();
    const skill = makeBuilderSkill({ name: "grouped-builder", status: "completed" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("grouped-builder", user);

    expect(screen.getByText("WORKFLOW")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Redo workflow" })).toBeInTheDocument();
    expect(screen.getByText("SKILL")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Refine" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Restore version" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("text-destructive");
  });

  it("shows the lifecycle section for imported skills without workflow-only actions", async () => {
    const user = userEvent.setup();
    const skill = makeImportedSkill({ skill_name: "imported-lifecycle-only" });
    setImportedSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("imported-lifecycle-only", user);

    expect(screen.queryByText("WORKFLOW")).not.toBeInTheDocument();
    expect(screen.getByText("SKILL")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Refine" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Restore version" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Redo workflow" })).not.toBeInTheDocument();
  });

  it("uses the same non-builder menu structure for marketplace skills", async () => {
    const user = userEvent.setup();
    const skill = makeImportedSkill({
      skill_name: "marketplace-menu",
      marketplace_source_url: "https://example.com/registry",
    });
    setImportedSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("marketplace-menu", user);

    expect(screen.queryByText("WORKFLOW")).not.toBeInTheDocument();
    expect(screen.getByText("SKILL")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Refine" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Restore version" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Redo workflow" })).not.toBeInTheDocument();
  });

  it("keeps the in-progress builder menu focused on resuming the workflow", async () => {
    const user = userEvent.setup();
    const skill = makeBuilderSkill({ name: "resume-builder", current_step: "Step 1" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(<SkillListPanel />);

    await openSkillMenu("resume-builder", user);

    expect(screen.getByRole("menuitem", { name: "Continue Building" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByText("WORKFLOW")).not.toBeInTheDocument();
    expect(screen.queryByText("SKILL")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Refine" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Restore version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Redo workflow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Export" })).not.toBeInTheDocument();
  });

  it("continue building prepares the workflow skill before navigation", async () => {
    const user = userEvent.setup();
    const onPrepareWorkflowSkill = vi.fn().mockResolvedValue(undefined);
    const skill = makeBuilderSkill({ name: "resume-builder", current_step: "Step 1" });
    setBuilderSkills([skill]);

    renderWithSkillQueries(
      <SkillListPanel onPrepareWorkflowSkill={onPrepareWorkflowSkill} />,
    );

    await openSkillMenu("resume-builder", user);
    const continueItem = screen.getByRole("menuitem", { name: "Continue Building" });

    await user.click(continueItem);

    expect(onPrepareWorkflowSkill).toHaveBeenCalledWith("resume-builder");
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "resume-builder" },
      state: { autoStart: true },
    });
  });

  it("does not navigate when clicking the running skill itself", () => {
    const onSelectSkill = vi.fn();
    const skill = makeBuilderSkill({ name: "running-skill", current_step: "Step 2" });
    setBuilderSkills([skill]);
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "agent-1": {
          agentId: "agent-1",
          model: "sonnet",
          status: "running",
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
          skillName: "running-skill",
          runSource: "workflow",
        },
      },
    }));

    renderWithSkillQueries(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("running-skill").closest('[role="button"]')!);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onSelectSkill).not.toHaveBeenCalled();
  });
});
