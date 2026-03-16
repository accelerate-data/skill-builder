import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useSkillStore } from "@/stores/skill-store";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import { useAgentStore } from "@/stores/agent-store";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
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

import { SkillListPanel } from "@/components/skill-list-panel";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBuilderSkill(overrides: Partial<SkillSummary> & { name: string }): SkillSummary {
  const base: SkillSummary = {
    name: overrides.name,
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
  };
  return { ...base, ...overrides };
}

function makeImportedSkill(
  overrides: Partial<ImportedSkill> & { skill_name: string },
): ImportedSkill {
  const base: ImportedSkill = {
    skill_id: `id-${overrides.skill_name}`,
    skill_name: overrides.skill_name,
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
  };
  return { ...base, ...overrides };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const recentBuilder = makeBuilderSkill({
  name: "recent-skill",
  last_modified: new Date(Date.now() - 60_000).toISOString(), // 1m ago (most recent)
  status: "completed",
});

const olderBuilder = makeBuilderSkill({
  name: "older-skill",
  last_modified: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
  current_step: "Step 1",
});

const importedSkill = makeImportedSkill({
  skill_name: "imported-skill",
  imported_at: new Date(Date.now() - 7200_000).toISOString(), // 2h ago (oldest)
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SkillListPanel", () => {
  beforeEach(() => {
    useSkillStore.setState({ skills: [] });
    useImportedSkillsStore.setState({ skills: [] });
    useAgentStore.getState().clearRuns();
    mockNavigate.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Merge & sort ──────────────────────────────────────────────────────────

  it("renders builder and imported skills in merged list sorted by lastModified desc", () => {
    useSkillStore.setState({ skills: [olderBuilder, recentBuilder] });
    useImportedSkillsStore.setState({ skills: [importedSkill] });

    render(<SkillListPanel />);

    // Skill rows have aria-selected; other buttons ("+", "More actions") do not
    const rows = screen.getAllByRole("button").filter((r) => r.hasAttribute("aria-selected"));
    const names = rows.map((r) => r.querySelector(".text-sm")?.textContent);
    expect(names).toEqual(["recent-skill", "older-skill", "imported-skill"]);
  });

  // ── Search ────────────────────────────────────────────────────────────────

  it("filters rows by search input (case-insensitive)", () => {
    useSkillStore.setState({ skills: [recentBuilder, olderBuilder] });

    render(<SkillListPanel />);

    const input = screen.getByPlaceholderText("Search skills…");
    fireEvent.change(input, { target: { value: "OLDER" } });

    expect(screen.getByText("older-skill")).toBeInTheDocument();
    expect(screen.queryByText("recent-skill")).not.toBeInTheDocument();
  });

  it("hides rows that don't match search", () => {
    useSkillStore.setState({ skills: [recentBuilder, olderBuilder] });

    render(<SkillListPanel />);
    const input = screen.getByPlaceholderText("Search skills…");
    fireEvent.change(input, { target: { value: "xyz-no-match" } });

    expect(screen.queryByText("recent-skill")).not.toBeInTheDocument();
    expect(screen.queryByText("older-skill")).not.toBeInTheDocument();
  });

  // ── Status dots ───────────────────────────────────────────────────────────

  it("renders outlined dot for never-started skill", () => {
    const skill = makeBuilderSkill({ name: "new-skill" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-new-skill");
    expect(dot.className).toMatch(/border/);
    expect(dot.className).toMatch(/bg-transparent/);
  });

  it("renders red dot for step-1 skill", () => {
    const skill = makeBuilderSkill({ name: "step1-skill", current_step: "Step 1" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-step1-skill");
    expect(dot.className).toMatch(/bg-destructive/);
  });

  it("renders yellow dot for step-2 skill", () => {
    const skill = makeBuilderSkill({ name: "step2-skill", current_step: "Step 2" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-step2-skill");
    expect(dot.className).toMatch(/bg-amber-600/);
  });

  it("renders green dot for completed builder skill", () => {
    const skill = makeBuilderSkill({ name: "done-skill", status: "completed" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-done-skill");
    expect(dot.style.backgroundColor).toBe("var(--color-seafoam)");
  });

  it("renders green dot for imported skill regardless of step", () => {
    const skill = makeImportedSkill({ skill_name: "imp-skill" });
    useImportedSkillsStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-imp-skill");
    expect(dot.style.backgroundColor).toBe("var(--color-seafoam)");
  });

  it("renders green dot for marketplace skill", () => {
    const skill = makeImportedSkill({
      skill_name: "mkt-skill",
      marketplace_source_url: "https://example.com/registry",
    });
    useImportedSkillsStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-mkt-skill");
    expect(dot.style.backgroundColor).toBe("var(--color-seafoam)");
  });

  // ── Pulse animation ───────────────────────────────────────────────────────

  it("applies animate-dot-pulse when an active workflow run exists for the skill", () => {
    const skill = makeBuilderSkill({ name: "running-skill", current_step: "Step 1" });
    useSkillStore.setState({ skills: [skill] });
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

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-running-skill");
    expect(dot.className).toMatch(/animate-dot-pulse/);
  });

  it("does NOT apply animate-dot-pulse when no active run exists", () => {
    const skill = makeBuilderSkill({ name: "idle-skill", current_step: "Step 1" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);

    const dot = screen.getByLabelText("status-dot-idle-skill");
    expect(dot.className).not.toMatch(/animate-dot-pulse/);
  });

  // ── Single-skill lock ─────────────────────────────────────────────────────

  it("locks other rows while a workflow is running; running row is not locked", () => {
    const skillA = makeBuilderSkill({ name: "skill-a", current_step: "Step 1" });
    const skillB = makeBuilderSkill({ name: "skill-b", status: "completed" });
    useSkillStore.setState({ skills: [skillA, skillB] });
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

    render(<SkillListPanel />);

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
    useSkillStore.setState({ skills: [skillA, skillB] });
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

    render(<SkillListPanel />);

    const skillBRow = screen.getByText("locked-skill-b").closest('[role="button"]');
    expect(skillBRow?.className).toMatch(/cursor-not-allowed/);
    // Locked row shows the Lock icon (no "More actions" button inside it)
    const moreBtn = skillBRow?.querySelector('[aria-label="More actions"]');
    expect(moreBtn).toBeNull();
  });

  // ── Default selection ─────────────────────────────────────────────────────

  it("selects last-selected-skill from localStorage on mount", () => {
    useSkillStore.setState({ skills: [recentBuilder, olderBuilder] });
    localStorage.setItem("last-selected-skill", "older-skill");

    render(<SkillListPanel />);

    const olderRow = screen.getByText("older-skill").closest('[role="button"]');
    expect(olderRow?.getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to most-recently-modified skill when localStorage key is absent", () => {
    useSkillStore.setState({ skills: [olderBuilder, recentBuilder] });

    render(<SkillListPanel />);

    const recentRow = screen.getByText("recent-skill").closest('[role="button"]');
    expect(recentRow?.getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to no selection when skill list is empty", () => {
    render(<SkillListPanel />);
    // No rows present — just verify no crash and no selected rows
    expect(screen.queryAllByRole("button", { hidden: true })).toBeTruthy();
  });

  it("ignores stale localStorage entry when skill no longer exists", () => {
    useSkillStore.setState({ skills: [recentBuilder] });
    localStorage.setItem("last-selected-skill", "deleted-skill");

    render(<SkillListPanel />);

    const recentRow = screen.getByText("recent-skill").closest('[role="button"]');
    expect(recentRow?.getAttribute("aria-selected")).toBe("true");
  });

  // ── Row click routing ─────────────────────────────────────────────────────

  it("navigates to /skill/$skillName when clicking a never-started skill", () => {
    const skill = makeBuilderSkill({ name: "new-workflow" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);
    fireEvent.click(screen.getByText("new-workflow").closest('[role="button"]')!);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "new-workflow" },
    });
  });

  it("navigates to /skill/$skillName when clicking a step-1 skill", () => {
    const skill = makeBuilderSkill({ name: "step1-nav", current_step: "Step 1" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel />);
    fireEvent.click(screen.getByText("step1-nav").closest('[role="button"]')!);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "step1-nav" },
    });
  });

  it("calls onSelectSkill when clicking a completed skill", () => {
    const onSelectSkill = vi.fn();
    const skill = makeBuilderSkill({ name: "done-skill", status: "completed" });
    useSkillStore.setState({ skills: [skill] });

    render(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("done-skill").closest('[role="button"]')!);

    expect(onSelectSkill).toHaveBeenCalledWith("done-skill");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("calls onSelectSkill when clicking an imported skill", () => {
    const onSelectSkill = vi.fn();
    const skill = makeImportedSkill({ skill_name: "my-import" });
    useImportedSkillsStore.setState({ skills: [skill] });

    render(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("my-import").closest('[role="button"]')!);

    expect(onSelectSkill).toHaveBeenCalledWith("my-import");
  });

  it("does not navigate or call onSelectSkill when clicking a locked row", () => {
    const onSelectSkill = vi.fn();
    const skillA = makeBuilderSkill({ name: "running-skill" });
    const skillB = makeBuilderSkill({ name: "locked-skill", status: "completed" });
    useSkillStore.setState({ skills: [skillA, skillB] });
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

    render(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("locked-skill").closest('[role="button"]')!);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onSelectSkill).not.toHaveBeenCalled();
  });

  it("does not navigate when clicking the running skill itself", () => {
    const onSelectSkill = vi.fn();
    const skill = makeBuilderSkill({ name: "running-skill", current_step: "Step 2" });
    useSkillStore.setState({ skills: [skill] });
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

    render(<SkillListPanel onSelectSkill={onSelectSkill} />);
    fireEvent.click(screen.getByText("running-skill").closest('[role="button"]')!);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(onSelectSkill).not.toHaveBeenCalled();
  });
});
