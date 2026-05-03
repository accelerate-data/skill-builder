const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const EVAL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(EVAL_ROOT, '..', '..');

function readRepo(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readEval(relativePath) {
  return fs.readFileSync(path.join(EVAL_ROOT, relativePath), 'utf8');
}

test('active workflow prompt surfaces stay OpenHands-native', () => {
  const activeWorkflowFiles = [
    'agent-sources/prompts/research.txt',
    'agent-sources/prompts/detailed-research.txt',
    'agent-sources/prompts/confirm_decisions.txt',
    'agent-sources/prompts/skill-generation.txt',
    'agent-sources/prompts/workflow-step.txt',
    'agent-sources/prompts/answer-evaluator.txt',
    'app/src-tauri/src/commands/workflow/prompt.rs',
    'app/src-tauri/src/commands/workflow/runtime.rs',
    'app/src-tauri/src/commands/workflow/step_config.rs',
  ];
  const forbidden = [
    'pathToClaudeCodeExecutable',
    'permissionMode',
    'subagent_directive',
    '.claude/plugins',
    'AskUserQuestion',
    'Agent tool',
    'Skill tool',
    'skill-content-researcher:',
    'skill-creator:',
    'research-orchestrator',
    'confirm-decisions',
    'generate-skill',
  ];

  for (const relativePath of activeWorkflowFiles) {
    const contents = readRepo(relativePath);
    for (const token of forbidden) {
      assert.equal(
        contents.includes(token),
        false,
        `${relativePath} contains stale workflow routing token: ${token}`,
      );
    }
  }

  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'agent-sources/workspace/prompts')),
    false,
    'app-owned workflow prompts must not live under agent-sources/workspace/prompts',
  );
});
test('deterministic eval packages cover OpenHands workflow agent topology', () => {
  const activeAgentFiles = ['agent-sources/workspace/agents/skill-creator.md'];
  const activeSkillFiles = ['agent-sources/skills/creating-skills/SKILL.md'];
  for (const relativePath of activeAgentFiles) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `${relativePath} must exist`);
  }
  for (const relativePath of activeSkillFiles) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `${relativePath} must exist`);
  }

  const packageEvidence = [
    readEval('packages/skill-content-researcher-research/prompt.txt'),
    readEval('packages/skill-content-researcher-research/promptfooconfig.json'),
    readEval('packages/skill-content-researcher-detailed-research/prompt.txt'),
    readEval('packages/skill-content-researcher-detailed-research/promptfooconfig.json'),
    readEval('packages/skill-content-researcher-confirm-decisions/prompt.txt'),
    readEval('packages/skill-content-researcher-confirm-decisions/promptfooconfig.json'),
    readEval('packages/skill-content-researcher-answer-evaluator/prompt.txt'),
    readEval('packages/skill-content-researcher-answer-evaluator/promptfooconfig.json'),
    readEval('packages/skill-creator-generate-skill/prompt.txt'),
    readEval('packages/skill-creator-generate-skill/promptfooconfig.json'),
    readEval('packages/workspace-workflow-step-prompt/prompt.txt'),
    readEval('packages/workspace-workflow-step-prompt/promptfooconfig.json'),
  ].join('\n');

  for (const token of [
    'skill-creator',
    'workflow.research',
    'workflow.detailed_research',
    'workflow.confirm_decisions',
    'workflow.skill_generation',
    'workflow.answer_evaluator',
    'answer-evaluator',
    'creating-skills',
    'fresh-context-verifier',
    'version_bump',
    '1.0.0',
    'agent-sources/prompts/research.txt',
    'agent-sources/prompts/detailed-research.txt',
    'agent-sources/prompts/confirm_decisions.txt',
  ]) {
    assert.ok(
      packageEvidence.includes(token),
      `eval prompt/config coverage must mention ${token}`,
    );
  }

  assert.equal(packageEvidence.includes('agent-sources/workspace/prompts'), false);
  assert.equal(packageEvidence.includes('research-agent'), false);
  assert.equal(packageEvidence.includes('skill-writer-agent'), false);
  assert.equal(packageEvidence.includes('skill-validator'), false);
  assert.equal(packageEvidence.includes('bundled `answer-evaluator` skill'), false);
});

test('answer evaluator gate is prompt-owned, not a bundled skill', () => {
  const prompt = readRepo('agent-sources/prompts/answer-evaluator.txt');
  const agent = readRepo('agent-sources/workspace/agents/skill-creator.md');

  assert.ok(prompt.includes('answer-evaluator workflow gate'));
  assert.ok(prompt.includes('Do not invoke'));
  assert.ok(prompt.includes('answer-evaluator skill'));
  assert.ok(prompt.includes('"gate_decision"'));
  assert.equal(/^\s+-\s+answer-evaluator\s*$/m.test(agent), false);
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, 'agent-sources/workspace/skills/answer-evaluator/SKILL.md')),
    false,
  );
});

test('step 3 skill generation has no legacy writer or validator runtime dependency', () => {
  const step3RuntimeEvidence = [
    readRepo('agent-sources/workspace/agents/skill-creator.md'),
    readRepo('agent-sources/skills/creating-skills/SKILL.md'),
    readRepo('agent-sources/prompts/skill-generation.txt'),
    readRepo('app/src-tauri/src/commands/workflow/runtime.rs'),
    readRepo('app/src-tauri/src/commands/workflow/step_config.rs'),
  ].join('\n');

  for (const token of [
    'task_kind: "workflow.skill_generation"',
    'agent_name: "skill-creator"',
    'creating-skills',
    'fresh-context verification',
  ]) {
    assert.ok(step3RuntimeEvidence.includes(token), `step 3 runtime evidence must mention ${token}`);
  }

  for (const token of [
    'tools_for_agent("skill-writer-agent")',
    'one_shot_tools_for_agent("skill-writer-agent")',
  ]) {
    assert.equal(
      step3RuntimeEvidence.includes(token),
      false,
      `step 3 runtime evidence must not depend on ${token}`,
    );
  }
});
