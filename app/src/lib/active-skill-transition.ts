import { hydrateSelectedSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import {
  pauseOpenHandsSession,
  releaseLock,
  selectSkillOpenHandsSession,
} from "@/lib/tauri";
import type { EditableSkill } from "@/lib/types";
import { teardownWorkflowSession } from "@/lib/workflow-teardown";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
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
  const refineStore = useRefineStore.getState();
  const selectedSkill = refineStore.selectedSkill;
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
    conversationId: refineStore.conversationId,
    agentId: runningWorkflow?.agentId ?? refineStore.activeAgentId,
  };
}

function clearActiveSkillUiState(): void {
  teardownWorkflowSession({
    logPrefix: "active-skill-transition",
    clearSessionId: true,
  });
  useRefineStore.getState().selectSkill(null);
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
    );
  }

  if (session) {
    if (session.skillId != null) {
      await releaseLock(session.skillId);
    }
  }

  clearActiveSkillUiState();
}

export async function enterSkill(
  skill: EditableSkill,
  workspacePath: string,
): Promise<void> {
  if (skill.id == null) {
    throw new Error(`Missing DB skill ID for '${skill.name}'`);
  }
  const session = await selectSkillOpenHandsSession(skill.id, workspacePath);
  hydrateSelectedSkillOpenHandsSession(skill, session);
}
