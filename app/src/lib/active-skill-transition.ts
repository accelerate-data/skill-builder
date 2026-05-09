import { hydrateSelectedSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import {
  acquireLock,
  pauseOpenHandsSession,
  releaseLock,
  selectSkillOpenHandsSession,
  stopOpenHandsServer,
} from "@/lib/tauri";
import type { EditableSkill } from "@/lib/types";
import { teardownWorkflowSession } from "@/lib/workflow-teardown";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useSkillStore } from "@/stores/skill-store";

interface ActiveSkillSession {
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
    await releaseLock(session.skillName);
  }

  clearActiveSkillUiState();
  await stopOpenHandsServer();
}

export async function enterSkill(
  skill: EditableSkill,
  workspacePath: string,
): Promise<void> {
  await acquireLock(skill.name);
  try {
    const session = await selectSkillOpenHandsSession(
      skill.name,
      workspacePath,
      skill.plugin_slug,
    );
    hydrateSelectedSkillOpenHandsSession(skill, session);
  } catch (error) {
    await releaseLock(skill.name).catch(() => {});
    throw error;
  }
}
