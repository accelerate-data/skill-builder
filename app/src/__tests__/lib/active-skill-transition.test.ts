import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditableSkill } from "@/lib/types";
import { enterSkill, leaveCurrentSkill } from "@/lib/active-skill-transition";

const tauriMocks = vi.hoisted(() => ({
  pauseOpenHandsSession: vi.fn().mockResolvedValue(undefined),
  selectSkillOpenHandsSession: vi.fn().mockResolvedValue({
    conversation_id: "conv-next",
    skill_name: "finance-skill",
    created_at: new Date().toISOString(),
    available_agents: ["skill-creator"],
    restored_messages: [],
    restored_transcript_events: [],
  }),
}));

vi.mock("@/lib/tauri", () => tauriMocks);

const hydrateSelectedSkillOpenHandsSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skill-openhands-session", () => ({
  hydrateSelectedSkillOpenHandsSession,
}));

const teardownWorkflowSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workflow-teardown", () => ({
  teardownWorkflowSession,
}));

const refineState = vi.hoisted(() => ({
  selectedSkill: {
    id: 7,
    name: "sales-skill",
    plugin_slug: "skills",
  },
  conversationId: "conv-current",
  activeAgentId: "refine-agent-1",
  selectSkill: vi.fn(),
}));

vi.mock("@/stores/refine-store", () => ({
  useRefineStore: {
    getState: () => refineState,
  },
}));

const skillStoreState = vi.hoisted(() => ({
  setActiveSkill: vi.fn(),
}));

vi.mock("@/stores/skill-store", () => ({
  useSkillStore: {
    getState: () => skillStoreState,
  },
}));

const agentRunsState = vi.hoisted(() => ({
  runs: {
    "workflow-agent-1": {
      agentId: "workflow-agent-1",
      status: "running",
      runSource: "workflow",
      skillName: "sales-skill",
    },
  },
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: {
    getState: () => agentRunsState,
  },
}));

function makeSkill(name: string): EditableSkill {
  return {
    id: 11,
    name,
    plugin_slug: "skills",
    skill_source: "skill-builder",
    purpose: null,
    description: null,
    tags: [],
    intake_json: null,
    version: null,
    userInvocable: null,
    disableModelInvocation: null,
    status: "completed",
    current_step: null,
  };
}

describe("active-skill-transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.pauseOpenHandsSession.mockResolvedValue(undefined);
    tauriMocks.selectSkillOpenHandsSession.mockResolvedValue({
      conversation_id: "conv-next",
      skill_name: "finance-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [],
    });
    refineState.selectedSkill = {
      id: 7,
      name: "sales-skill",
      plugin_slug: "skills",
    };
    refineState.conversationId = "conv-current";
    refineState.activeAgentId = "refine-agent-1";
    agentRunsState.runs = {
      "workflow-agent-1": {
        agentId: "workflow-agent-1",
        status: "running",
        runSource: "workflow",
        skillName: "sales-skill",
      },
    };
  });

  it("leaves the current skill in strict order", async () => {
    const calls: string[] = [];
    tauriMocks.pauseOpenHandsSession.mockImplementation(async () => {
      calls.push("pause");
    });
    refineState.selectSkill.mockImplementation(() => {
      calls.push("clear");
    });

    await leaveCurrentSkill();

    expect(calls).toEqual(["pause", "clear"]);
    expect(teardownWorkflowSession).toHaveBeenCalledWith({
      logPrefix: "active-skill-transition",
      clearSessionId: true,
    });
    expect(skillStoreState.setActiveSkill).toHaveBeenCalledWith(null);
  });

  it("does not clear UI state when pause fails", async () => {
    tauriMocks.pauseOpenHandsSession.mockRejectedValue(new Error("pause failed"));

    await expect(leaveCurrentSkill()).rejects.toThrow("pause failed");
    expect(refineState.selectSkill).not.toHaveBeenCalled();
  });

  it("ignores stale leave requests for a different skill", async () => {
    await leaveCurrentSkill({ expectedSkillName: "finance-skill" });

    expect(tauriMocks.pauseOpenHandsSession).not.toHaveBeenCalled();
    expect(refineState.selectSkill).not.toHaveBeenCalled();
  });

  it("enters the selected skill by bootstrapping and hydrating", async () => {
    const skill = makeSkill("finance-skill");

    await enterSkill(skill);

    expect(tauriMocks.selectSkillOpenHandsSession).toHaveBeenCalledWith(11);
    expect(hydrateSelectedSkillOpenHandsSession).toHaveBeenCalledWith(
      skill,
      expect.objectContaining({ conversation_id: "conv-next" }),
    );
  });

  it("propagates selectSkillOpenHandsSession errors without hydrating", async () => {
    tauriMocks.selectSkillOpenHandsSession.mockRejectedValue(
      new Error("bootstrap failed"),
    );
    const skill = makeSkill("finance-skill");

    await expect(enterSkill(skill)).rejects.toThrow(
      "bootstrap failed",
    );
    expect(hydrateSelectedSkillOpenHandsSession).not.toHaveBeenCalled();
  });

  it("throws when skill lacks a DB id", async () => {
    const skill = makeSkill("finance-skill");
    skill.id = null;

    await expect(enterSkill(skill)).rejects.toThrow(
      "Missing DB skill ID",
    );
    expect(tauriMocks.selectSkillOpenHandsSession).not.toHaveBeenCalled();
    expect(hydrateSelectedSkillOpenHandsSession).not.toHaveBeenCalled();
  });
});
