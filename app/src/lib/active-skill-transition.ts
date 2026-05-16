import { hydrateSelectedSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import {
  pauseOpenHandsSession,
  selectSkillOpenHandsSession,
} from "@/lib/tauri";
import type { EditableSkill } from "@/lib/types";
import { teardownWorkflowSession } from "@/lib/workflow-teardown";
import { useAgentStore } from "@/stores/agent-store";
import { useSkillStore } from "@/stores/skill-store";

interface ActiveSkillSession {
  skillId: number | null;
  skillName: string;
  pluginSlug: string;
  conversationId: string | null;
  agentId: string | null;
}

interface LeaveCurrentSkillOptions {
  expectedSkillName?: string;
}

function getActiveSkillSession(): ActiveSkillSession | null {
  const skillStore = useSkillStore.getState();
  const selectedSkill = skillStore.selectedSkill;
  if (!selectedSkill) {
    return null;
  }

  const runningWorkflow = Object.values(useAgentStore.getState().runs).find(
    (run): run is typeof run & { skillName: string } =>
      run.status === "running" &&
      run.runSource === "workflow" &&
      !!run.skillName,
  );

  return {
    skillId: selectedSkill.id ?? null,
    skillName: selectedSkill.name,
    pluginSlug: selectedSkill.plugin_slug,
    conversationId: skillStore.conversationId,
    agentId: runningWorkflow?.agentId ?? skillStore.activeAgentId,
  };
}

function clearActiveSkillUiState(): void {
  teardownWorkflowSession({
    logPrefix: "active-skill-transition",
    clearSessionId: true,
  });
  useSkillStore.getState().clearSelectedSkillSession();
  useSkillStore.getState().setActiveSkill(null);
}

export async function leaveCurrentSkill(
  options: LeaveCurrentSkillOptions = {},
): Promise<void> {
  const session = getActiveSkillSession();

  if (options.expectedSkillName && session?.skillName !== options.expectedSkillName) {
    return;
  }

  if (session?.conversationId) {
    await pauseOpenHandsSession(
      session.skillName,
      session.pluginSlug,
      session.conversationId,
      session.agentId,
      session.skillId,
    );
  }

  clearActiveSkillUiState();
}

export async function enterSkill(
  skill: EditableSkill,
): Promise<void> {
  if (skill.id == null) {
    throw new Error(`Missing DB skill ID for '${skill.name}'`);
  }
  const session = await selectSkillOpenHandsSession(skill.id);
  hydrateSelectedSkillOpenHandsSession(skill, session);
}
