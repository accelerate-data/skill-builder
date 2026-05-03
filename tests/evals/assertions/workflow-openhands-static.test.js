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
  for (const relativePath of activeAgentFiles) {
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
    readEval('packages/workspace-workflow-step-prompt/prompt.txt'),
    readEval('packages/workspace-workflow-step-prompt/promptfooconfig.json'),
  ].join('\n');

  for (const token of [
    'skill-creator',
    'workflow.research',
    'workflow.detailed_research',
    'workflow.confirm_decisions',
    'workflow.answer_evaluator',
    'answer-evaluator',
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
});
