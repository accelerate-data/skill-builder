import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditableSkill } from "@/lib/types";
import { enterSkill, leaveCurrentSkill } from "@/lib/active-skill-transition";

const tauriMocks = vi.hoisted(() => ({
  acquireLock: vi.fn().mockResolvedValue(undefined),
  pauseOpenHandsSession: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  selectSkillOpenHandsSession: vi.fn().mockResolvedValue({
    conversation_id: "conv-next",
    skill_name: "finance-skill",
    created_at: new Date().toISOString(),
    available_agents: ["skill-creator"],
    restored_messages: [],
    restored_transcript_events: [],
  }),
  stopOpenHandsServer: vi.fn().mockResolvedValue(undefined),
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
    tauriMocks.acquireLock.mockResolvedValue(undefined);
    tauriMocks.pauseOpenHandsSession.mockResolvedValue(undefined);
    tauriMocks.releaseLock.mockResolvedValue(undefined);
    tauriMocks.selectSkillOpenHandsSession.mockResolvedValue({
      conversation_id: "conv-next",
      skill_name: "finance-skill",
      created_at: new Date().toISOString(),
      available_agents: ["skill-creator"],
      restored_messages: [],
      restored_transcript_events: [],
    });
    tauriMocks.stopOpenHandsServer.mockResolvedValue(undefined);
    refineState.selectedSkill = {
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
    tauriMocks.releaseLock.mockImplementation(async () => {
      calls.push("release");
    });
    refineState.selectSkill.mockImplementation(() => {
      calls.push("clear");
    });
    tauriMocks.stopOpenHandsServer.mockImplementation(async () => {
      calls.push("stop");
    });

    await leaveCurrentSkill();

    expect(calls).toEqual(["pause", "release", "clear", "stop"]);
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
    expect(tauriMocks.stopOpenHandsServer).not.toHaveBeenCalled();
  });

  it("does not clear UI state when lock release fails", async () => {
    tauriMocks.releaseLock.mockRejectedValue(new Error("release failed"));

    await expect(leaveCurrentSkill()).rejects.toThrow("release failed");
    expect(refineState.selectSkill).not.toHaveBeenCalled();
    expect(tauriMocks.stopOpenHandsServer).not.toHaveBeenCalled();
  });

  it("surfaces stop-server failures after UI clear", async () => {
    tauriMocks.stopOpenHandsServer.mockRejectedValue(new Error("stop failed"));

    await expect(leaveCurrentSkill()).rejects.toThrow("stop failed");
    expect(refineState.selectSkill).toHaveBeenCalledWith(null);
  });

  it("ignores stale leave requests for a different skill", async () => {
    await leaveCurrentSkill({ expectedSkillName: "finance-skill" });

    expect(tauriMocks.pauseOpenHandsSession).not.toHaveBeenCalled();
    expect(tauriMocks.releaseLock).not.toHaveBeenCalled();
    expect(refineState.selectSkill).not.toHaveBeenCalled();
    expect(tauriMocks.stopOpenHandsServer).not.toHaveBeenCalled();
  });

  it("enters the selected skill by acquiring a lock, bootstrapping, and hydrating", async () => {
    const skill = makeSkill("finance-skill");

    await enterSkill(skill, "/workspace");

    expect(tauriMocks.acquireLock).toHaveBeenCalledWith("finance-skill");
    expect(tauriMocks.selectSkillOpenHandsSession).toHaveBeenCalledWith(
      "finance-skill",
      "/workspace",
      "skills",
    );
    expect(hydrateSelectedSkillOpenHandsSession).toHaveBeenCalledWith(
      skill,
      expect.objectContaining({ conversation_id: "conv-next" }),
    );
  });
});
