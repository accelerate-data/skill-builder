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
    'agent-sources/workspace/prompts/workflow-step.txt',
    'agent-sources/workspace/prompts/answer-evaluator.txt',
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
    'detailed-research',
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
});

test('deterministic eval packages cover OpenHands workflow agent topology', () => {
  const activeAgentFiles = [
    'agent-sources/plugins/skill-content-researcher/agents/research-agent.md',
    'agent-sources/plugins/skill-content-researcher/agents/answer-evaluator.md',
    'agent-sources/plugins/skill-creator/agents/skill-writer-agent.md',
  ];
  for (const relativePath of activeAgentFiles) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `${relativePath} must exist`);
  }

  const packageEvidence = [
    readEval('packages/skill-content-researcher-research/prompt.txt'),
    readEval('packages/skill-content-researcher-answer-evaluator/promptfooconfig.json'),
    readEval('packages/skill-content-researcher-confirm-decisions/prompt.txt'),
    readEval('packages/skill-creator-generate-skill/prompt.txt'),
  ].join('\n');

  for (const agentName of ['research-agent', 'answer-evaluator', 'skill-writer-agent']) {
    assert.ok(
      packageEvidence.includes(agentName),
      `eval prompt/config coverage must mention ${agentName}`,
    );
  }
});

