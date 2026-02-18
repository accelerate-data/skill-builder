import { describe, it, expect, beforeEach } from "vitest";
import { useRefineStore } from "@/stores/refine-store";
import type { SkillFile } from "@/stores/refine-store";
import { makeSkillSummary } from "@/test/fixtures";

const initialState = {
  selectedSkill: null,
  refinableSkills: [],
  isLoadingSkills: false,
  skillFiles: [],
  isLoadingFiles: false,
  activeFileTab: "SKILL.md",
  diffMode: false,
  baselineFiles: [],
  messages: [],
  activeAgentId: null,
  isRunning: false,
  sessionId: null,
};

describe("useRefineStore", () => {
  beforeEach(() => {
    useRefineStore.setState(initialState);
  });

  it("starts with correct defaults", () => {
    const state = useRefineStore.getState();
    expect(state.selectedSkill).toBeNull();
    expect(state.refinableSkills).toEqual([]);
    expect(state.isLoadingSkills).toBe(false);
    expect(state.skillFiles).toEqual([]);
    expect(state.isLoadingFiles).toBe(false);
    expect(state.activeFileTab).toBe("SKILL.md");
    expect(state.diffMode).toBe(false);
    expect(state.baselineFiles).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(state.activeAgentId).toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.sessionId).toBeNull();
  });

  it("setRefinableSkills sets the skills list", () => {
    const skills = [
      makeSkillSummary({ name: "skill-a" }),
      makeSkillSummary({ name: "skill-b", domain: "finance" }),
    ];
    useRefineStore.getState().setRefinableSkills(skills);

    const state = useRefineStore.getState();
    expect(state.refinableSkills).toHaveLength(2);
    expect(state.refinableSkills[0].name).toBe("skill-a");
    expect(state.refinableSkills[1].domain).toBe("finance");
  });

  it("selectSkill sets selectedSkill and clears session state", () => {
    // Pre-populate some state that should be cleared
    const files: SkillFile[] = [{ filename: "SKILL.md", content: "old" }];
    useRefineStore.setState({
      messages: [{ id: "m1", role: "user", userText: "hi", timestamp: 1 }],
      sessionId: "sess-1",
      diffMode: true,
      baselineFiles: files,
      skillFiles: files,
      activeFileTab: "references/glossary.md",
      activeAgentId: "agent-1",
      isRunning: true,
    });

    const skill = makeSkillSummary({ name: "my-skill" });
    useRefineStore.getState().selectSkill(skill);

    const state = useRefineStore.getState();
    expect(state.selectedSkill).toEqual(skill);
    expect(state.messages).toEqual([]);
    expect(state.sessionId).toBeNull();
    expect(state.diffMode).toBe(false);
    expect(state.baselineFiles).toEqual([]);
    expect(state.skillFiles).toEqual([]);
    expect(state.activeFileTab).toBe("SKILL.md");
    expect(state.activeAgentId).toBeNull();
    expect(state.isRunning).toBe(false);
  });

  it("selectSkill(null) resets to initial state", () => {
    useRefineStore.setState({
      selectedSkill: makeSkillSummary({ name: "some-skill" }),
      messages: [{ id: "m1", role: "user", userText: "hi", timestamp: 1 }],
      skillFiles: [{ filename: "SKILL.md", content: "content" }],
    });

    useRefineStore.getState().selectSkill(null);

    const state = useRefineStore.getState();
    expect(state.selectedSkill).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.skillFiles).toEqual([]);
    expect(state.activeFileTab).toBe("SKILL.md");
  });

  it("snapshotBaseline deep-copies current skillFiles to baselineFiles", () => {
    const files: SkillFile[] = [
      { filename: "SKILL.md", content: "# Skill" },
      { filename: "references/glossary.md", content: "glossary" },
    ];
    useRefineStore.setState({ skillFiles: files });

    useRefineStore.getState().snapshotBaseline();

    const state = useRefineStore.getState();
    expect(state.baselineFiles).toEqual(files);
    expect(state.baselineFiles).not.toBe(state.skillFiles);
    // Verify it's a deep copy — mutating skillFiles shouldn't affect baseline
    expect(state.baselineFiles[0]).not.toBe(state.skillFiles[0]);
  });

  it("addUserMessage appends a user message with id, role, userText, timestamp", () => {
    const msg = useRefineStore.getState().addUserMessage("Hello world");

    expect(msg.role).toBe("user");
    expect(msg.userText).toBe("Hello world");
    expect(msg.id).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.targetFiles).toBeUndefined();

    const state = useRefineStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(msg);
  });

  it("addUserMessage with targetFiles includes targetFiles in the message", () => {
    const targets = ["SKILL.md", "references/glossary.md"];
    const msg = useRefineStore.getState().addUserMessage("Fix these", targets);

    expect(msg.targetFiles).toEqual(targets);
    expect(msg.userText).toBe("Fix these");
    expect(useRefineStore.getState().messages).toHaveLength(1);
  });

  it("addUserMessage with command stores the command on the message", () => {
    const msg = useRefineStore.getState().addUserMessage("improve structure", undefined, "rewrite");

    expect(msg.command).toBe("rewrite");
    expect(msg.userText).toBe("improve structure");
    expect(msg.targetFiles).toBeUndefined();
  });

  it("addUserMessage with command and targetFiles stores both", () => {
    const targets = ["SKILL.md"];
    const msg = useRefineStore.getState().addUserMessage("check quality", targets, "validate");

    expect(msg.command).toBe("validate");
    expect(msg.targetFiles).toEqual(targets);
    expect(msg.userText).toBe("check quality");
  });

  it("addAgentTurn appends an agent message with id, role, agentId, timestamp", () => {
    const msg = useRefineStore.getState().addAgentTurn("agent-abc");

    expect(msg.role).toBe("agent");
    expect(msg.agentId).toBe("agent-abc");
    expect(msg.id).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);

    const state = useRefineStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(msg);
  });

  it("updateSkillFiles replaces skillFiles", () => {
    const initial: SkillFile[] = [{ filename: "SKILL.md", content: "old" }];
    useRefineStore.setState({ skillFiles: initial });

    const updated: SkillFile[] = [
      { filename: "SKILL.md", content: "new" },
      { filename: "references/api.md", content: "api docs" },
    ];
    useRefineStore.getState().updateSkillFiles(updated);

    const state = useRefineStore.getState();
    expect(state.skillFiles).toEqual(updated);
    expect(state.skillFiles).toHaveLength(2);
  });

  it("clearSession resets messages, agent state, diff state, but preserves refinableSkills", () => {
    const skills = [makeSkillSummary({ name: "skill-a" })];
    useRefineStore.setState({
      refinableSkills: skills,
      selectedSkill: skills[0],
      messages: [{ id: "m1", role: "user", userText: "hi", timestamp: 1 }],
      activeAgentId: "agent-1",
      isRunning: true,
      sessionId: "sess-1",
      diffMode: true,
      baselineFiles: [{ filename: "SKILL.md", content: "old" }],
      skillFiles: [{ filename: "SKILL.md", content: "new" }],
      activeFileTab: "references/foo.md",
    });

    useRefineStore.getState().clearSession();

    const state = useRefineStore.getState();
    // Preserved
    expect(state.refinableSkills).toEqual(skills);
    expect(state.selectedSkill).toEqual(skills[0]);
    // Cleared
    expect(state.messages).toEqual([]);
    expect(state.activeAgentId).toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.sessionId).toBeNull();
    expect(state.diffMode).toBe(false);
    expect(state.baselineFiles).toEqual([]);
    expect(state.skillFiles).toEqual([]);
    expect(state.activeFileTab).toBe("SKILL.md");
  });

  it("setDiffMode toggles diff mode", () => {
    useRefineStore.getState().setDiffMode(true);
    expect(useRefineStore.getState().diffMode).toBe(true);
    useRefineStore.getState().setDiffMode(false);
    expect(useRefineStore.getState().diffMode).toBe(false);
  });

  it("setActiveFileTab changes the active file tab", () => {
    useRefineStore.getState().setActiveFileTab("references/glossary.md");
    expect(useRefineStore.getState().activeFileTab).toBe("references/glossary.md");
  });

  it("setRunning toggles the running flag", () => {
    useRefineStore.getState().setRunning(true);
    expect(useRefineStore.getState().isRunning).toBe(true);
    useRefineStore.getState().setRunning(false);
    expect(useRefineStore.getState().isRunning).toBe(false);
  });

  it("setActiveAgentId sets and clears the active agent id", () => {
    useRefineStore.getState().setActiveAgentId("agent-xyz");
    expect(useRefineStore.getState().activeAgentId).toBe("agent-xyz");
    useRefineStore.getState().setActiveAgentId(null);
    expect(useRefineStore.getState().activeAgentId).toBeNull();
  });
});
