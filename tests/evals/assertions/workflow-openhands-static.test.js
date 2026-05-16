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
  const activeSkillFiles = ['agent-sources/workspace/skills/creating-skills/SKILL.md'];
  for (const relativePath of activeAgentFiles) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `${relativePath} must exist`);
  }
  for (const relativePath of activeSkillFiles) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `${relativePath} must exist`);
  }

  const packageEvidence = [
    readEval('packages/skill-content-researcher-research/promptfooconfig.json'),
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

  const researchPromptLink = path.join(
    EVAL_ROOT,
    'packages/skill-content-researcher-research/prompt.txt',
  );
  const detailedPromptLink = path.join(
    EVAL_ROOT,
    'packages/skill-content-researcher-detailed-research/prompt.txt',
  );
  assert.ok(fs.existsSync(researchPromptLink), 'step 0 research eval prompt link must exist');
  assert.ok(
    fs.existsSync(detailedPromptLink),
    'step 1 detailed research eval prompt link must exist',
  );
  assert.ok(fs.lstatSync(researchPromptLink).isSymbolicLink());
  assert.ok(fs.lstatSync(detailedPromptLink).isSymbolicLink());
  assert.equal(
    fs.realpathSync(researchPromptLink),
    path.join(REPO_ROOT, 'agent-sources/prompts/research.txt'),
  );
  assert.equal(
    fs.realpathSync(detailedPromptLink),
    path.join(REPO_ROOT, 'agent-sources/prompts/detailed-research.txt'),
  );

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
    'verifier_result',
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

test('step 2 decision prompt normalizes exploratory answers by purpose', () => {
  const prompt = readRepo('agent-sources/prompts/confirm_decisions.txt');
  const evalPackage = [
    readEval('packages/skill-content-researcher-confirm-decisions/prompt.txt'),
    readEval('packages/skill-content-researcher-confirm-decisions/promptfooconfig.json'),
  ].join('\n');

  for (const token of [
    'Purpose-aware decision normalization',
    'Step 2 as the normalization boundary',
    'business-process purpose',
    'data-engineering purpose',
    'source-system-semantics purpose',
    'Fabric Lakehouse',
    'dbt model grain',
    'business measures',
    'The skill accepts Salesforce',
  ]) {
    assert.ok(prompt.includes(token), `confirm decisions prompt must mention ${token}`);
  }
  assert.match(
    prompt,
    /Do not preserve CSV, JSON, SOQL, or file export as\s+the operating input contract/,
  );
  assert.match(
    prompt,
    /Salesforce\s+opportunity data is available in the Fabric Lakehouse and should define how\s+opportunity stages/,
  );

  for (const token of [
    '[positive] business-process pipeline export clarifications normalize to lakehouse/dbt decisions',
    '[negative] business-process decisions must not preserve Salesforce CSV JSON SOQL as operating contract',
    '[positive] source-system-semantics decisions preserve extraction mechanics when material',
    'Salesforce CSV exports',
    'Fabric Lakehouse',
    'dbt',
    'source-system-semantics',
    'SOQL',
    'CDC',
  ]) {
    assert.ok(evalPackage.includes(token), `confirm decisions eval coverage must mention ${token}`);
  }
});

test('step 3 skill generation has no legacy writer or validator runtime dependency', () => {
  const step3RuntimeEvidence = [
    readRepo('agent-sources/workspace/agents/skill-creator.md'),
    readRepo('agent-sources/workspace/skills/creating-skills/SKILL.md'),
    readRepo('agent-sources/prompts/skill-generation.txt'),
    readRepo('app/src-tauri/src/commands/workflow/runtime.rs'),
    readRepo('app/src-tauri/src/commands/workflow/step_config.rs'),
  ].join('\n');

  assert.match(
    step3RuntimeEvidence,
    /task kind\s+`workflow\.skill_generation`|task_kind:\s*"workflow\.skill_generation"/i,
    'step 3 runtime evidence must mention workflow.skill_generation',
  );
  assert.match(
    step3RuntimeEvidence,
    /`skill-creator` agent|agent name\s+`skill-creator`|agent_name:\s*"skill-creator"/i,
    'step 3 runtime evidence must mention skill-creator',
  );

  for (const token of [
    'creating-skills',
    'fresh-context verification',
    'app Eval Workbench owns durable prompt cases, assertions, runs, and',
    'Do not run benchmark aggregation',
  ]) {
    assert.ok(step3RuntimeEvidence.includes(token), `step 3 runtime evidence must mention ${token}`);
  }

  for (const token of [
    'tools_for_agent("skill-writer-agent")',
    'legacy_tools_for_agent("skill-writer-agent")',
    'evals/evals.json',
    'pending-eval.json',
    'write-evals',
    'description optimization',
  ]) {
    assert.equal(
      step3RuntimeEvidence.includes(token),
      false,
      `step 3 runtime evidence must not depend on ${token}`,
    );
  }
});

test('researching-skill-requirements separates invariants defaults and lenses for data-engineering skills', () => {
  const skill = readRepo('agent-sources/workspace/skills/researching-skill-requirements/SKILL.md');

  for (const token of [
    '## Invariants',
    '## Defaults',
    '## Purpose-Specific Lenses',
  ]) {
    assert.ok(skill.includes(token), `research skill must include ${token}`);
  }

  assert.match(
    skill,
    /Do not ask[^.\n]*output format|Do not ask[^.\n]*artifact contract|Do not ask[^.\n]*schema|Do not ask[^.\n]*naming contract|Do not ask[^.\n]*naming convention/i,
  );
  assert.match(
    skill,
    /Do not ask[^.\n]*test cases|Do not ask[^.\n]*design test cases|Do not ask[^.\n]*validation suites/i,
  );
  assert.match(
    skill,
    /workspace naming|lakehouse naming|security boundaries|deployment topology|monitoring|managed identity|endpoint behavior|environment promotion|model organization/i,
  );
  assert.match(skill, /medallion architecture/i);
  assert.match(skill, /business-process skills, default toward conceptual source entities/i);
  assert.match(skill, /source-system-semantics skills, default toward business rules/i);

  for (const token of [
    'What output format, artifact contract, schema, naming, or handoff should it produce?',
    'Should test cases verify the skill?',
    'Suggest the appropriate default for tests based on the skill type, but let the user decide.',
  ]) {
    assert.equal(
      skill.includes(token),
      false,
      `research skill must not preserve stale output/test prompting: ${token}`,
    );
  }
});
