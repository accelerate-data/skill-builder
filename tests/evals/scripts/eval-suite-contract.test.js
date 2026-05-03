const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const EVAL_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON = 'package.json';
const EVAL_MAP = 'eval-map.json';
const OPENCODE_CONFIG = 'opencode.json';
const PACKAGE_ROOT = path.join(EVAL_ROOT, 'packages');
const SCRIPT_ROOT = path.join(EVAL_ROOT, 'scripts');
const FRAMEWORK_ROOT = path.join(SCRIPT_ROOT, 'framework');
const LIVE_CONFIGS = [];
const ALLOWED_TIERS = new Set(['light', 'standard', 'high', 'x_high']);
const EXPECTED_AGENT_STEPS = {
  eval_light: 60,
  eval_standard: 100,
  eval_high: 120,
  eval_x_high: 200,
};
const FORBIDDEN_REFERENCES = [
  'file://../../providers/',
  'file://../providers/',
  'anthropic:claude-agent-sdk',
  'max_turns',
  'runtime.tools',
  'model_provider_id',
  'working_dir',
];

function collectPackageConfigs(rootDir) {
  const configs = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      configs.push(...collectPackageConfigs(entryPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.json'))) {
      configs.push(path.relative(EVAL_ROOT, entryPath));
    }
  }

  return configs.sort();
}

function readYaml(relativePath) {
  return yaml.load(fs.readFileSync(path.join(EVAL_ROOT, relativePath), 'utf8'));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(EVAL_ROOT, relativePath), 'utf8'));
}

function collectTextFiles(rootDir) {
  const textFiles = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.tmp') {
        continue;
      }
      textFiles.push(...collectTextFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      textFiles.push(path.relative(EVAL_ROOT, entryPath));
    }
  }

  return textFiles.sort();
}

function toUtf8(value) {
  return Buffer.from(value, 'utf8').toString('utf8');
}

test('all eval package configs declare a valid metadata.eval_tier', () => {
  const packageConfigs = collectPackageConfigs(PACKAGE_ROOT);
  const configPaths = [...packageConfigs, ...LIVE_CONFIGS];

  assert.ok(packageConfigs.length > 0, 'expected at least one package config');
  for (const relativePath of configPaths) {
    const parsed = readYaml(relativePath);
    assert.ok(parsed?.metadata, `${relativePath} must define metadata`);
    assert.ok(parsed.metadata.eval_tier, `${relativePath} must define metadata.eval_tier`);
    assert.ok(
      ALLOWED_TIERS.has(parsed.metadata.eval_tier),
      `${relativePath} has unsupported eval tier: ${parsed.metadata.eval_tier}`,
    );
  }
});

test('every eval package has exactly one smoke scenario', () => {
  const packageConfigs = collectPackageConfigs(PACKAGE_ROOT);

  for (const relativePath of packageConfigs) {
    const parsed = readYaml(relativePath);
    const smokeTests = (parsed.tests || []).filter((entry) => (
      typeof entry.description === 'string' && entry.description.startsWith('[smoke]')
    ));

    assert.equal(
      smokeTests.length,
      1,
      `${relativePath} must define exactly one [smoke] scenario`,
    );
  }

});

test('eval:smoke delegates smoke package discovery to the framework CLI', () => {
  const packageJson = readJson(PACKAGE_JSON);
  const smokeScript = packageJson.scripts?.['eval:smoke'];

  assert.equal(smokeScript, 'node bin/ad-evals.js smoke');
});

test('eval:regression delegates package discovery to the framework CLI', () => {
  const packageJson = readJson(PACKAGE_JSON);

  assert.equal(packageJson.scripts?.['eval:regression'], 'node bin/ad-evals.js regression');
});

test('scenario inventory records a decision for every eval package', () => {
  const inventory = fs.readFileSync(path.join(EVAL_ROOT, 'docs', 'scenario-inventory.md'), 'utf8');
  const packageNames = collectPackageConfigs(PACKAGE_ROOT)
    .map((relativePath) => relativePath.split(path.sep).join('/').split('/')[1]);

  for (const packageName of packageNames) {
    assert.ok(
      inventory.includes(`\`${packageName}\``),
      `scenario inventory must mention ${packageName}`,
    );
  }

  assert.match(inventory, /Model-Change Validation Order/);
  assert.match(inventory, /No manual validation is required/);
  assert.match(inventory, /Live eval scripts are automated/);
});

test('eval map gives coding agents navigation for every eval package', () => {
  const evalMap = readJson(EVAL_MAP);
  const packageConfigs = collectPackageConfigs(PACKAGE_ROOT);

  assert.equal(evalMap.eval_root, 'tests/evals');
  assert.ok(evalMap.agent_guidance.length > 0, 'eval map must include agent guidance');
  assert.ok(evalMap.commands.deterministic_contracts, 'eval map must include deterministic test command');
  assert.ok(evalMap.directories['packages/'], 'eval map must describe package ownership');
  assert.ok(evalMap.framework_files['bin/ad-evals.js'], 'eval map must describe shared CLI');

  for (const relativePath of packageConfigs) {
    const parts = relativePath.split(path.sep).join('/').split('/');
    const packageName = parts[1];
    assert.ok(evalMap.packages[packageName], `eval map must include package ${packageName}`);
    assert.equal(
      evalMap.packages[packageName].config,
      relativePath.split(path.sep).join('/'),
      `eval map config mismatch for ${packageName}`,
    );
  }

  const discoveredConfigSet = new Set(packageConfigs.map((relativePath) => (
    relativePath.split(path.sep).join('/')
  )));
  for (const [packageName, packageEntry] of Object.entries(evalMap.packages)) {
    assert.ok(
      discoveredConfigSet.has(packageEntry.config),
      `eval map package ${packageName} points to missing config ${packageEntry.config}`,
    );
  }
});

test('eval suite no longer references provider files or the Claude agent sdk', () => {
  const textFiles = [
    ...collectTextFiles(PACKAGE_ROOT),
    ...LIVE_CONFIGS,
    path.relative(EVAL_ROOT, path.join(SCRIPT_ROOT, 'promptfoo.sh')),
    path.relative(EVAL_ROOT, path.join(FRAMEWORK_ROOT, 'run-promptfoo-with-guard.js')),
    path.relative(EVAL_ROOT, path.join(FRAMEWORK_ROOT, 'resolve-promptfoo-config.js')),
    'package.json',
  ].sort();

  for (const relativePath of textFiles) {
    const contents = fs.readFileSync(path.join(EVAL_ROOT, relativePath), 'utf8');
    for (const forbiddenReference of FORBIDDEN_REFERENCES) {
      assert.ok(
        !contents.includes(toUtf8(forbiddenReference)),
        `${relativePath} still references ${forbiddenReference}`,
      );
    }
  }
});

test('package configs do not declare package-local providers', () => {
  const packageConfigs = collectPackageConfigs(PACKAGE_ROOT);

  for (const relativePath of packageConfigs) {
    const parsed = readYaml(relativePath);
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed, 'providers'),
      false,
      `${relativePath} must receive providers from scripts/framework/resolve-promptfoo-config.js`,
    );
  }
});

test('package prompts use app-shaped scenarios instead of meta file inspection', () => {
  const packageConfigs = collectPackageConfigs(PACKAGE_ROOT);
  const forbiddenPromptPatterns = [
    /\bInspect\b/,
    /Do not edit files/i,
    /Return JSON only:\s*\{\\"package\\".*\\"checks\\"/i,
    /\\"evidence\\":\[/,
  ];

  for (const relativePath of packageConfigs) {
    const parsed = readYaml(relativePath);
    const promptText = JSON.stringify(parsed.prompts || []);
    for (const pattern of forbiddenPromptPatterns) {
      assert.equal(
        pattern.test(promptText),
        false,
        `${relativePath} uses meta-inspection prompt wording: ${pattern}`,
      );
    }
  }
});

test('suite OpenCode config disables provider timeouts for long-running evals', () => {
  const config = readJson(OPENCODE_CONFIG);

  assert.equal(config.provider?.opencode?.options?.timeout, false);
  assert.equal('chunkTimeout' in config.provider.opencode.options, false);
});

test('suite OpenCode config defines primary eval agents with enforceable fields', () => {
  const config = readJson(OPENCODE_CONFIG);

  for (const [agentName, steps] of Object.entries(EXPECTED_AGENT_STEPS)) {
    const agent = config.agent?.[agentName];
    assert.ok(agent, `missing OpenCode eval agent: ${agentName}`);
    assert.equal(agent.description.length > 0, true);
    assert.equal(agent.mode, 'primary');
    assert.equal(agent.model, 'opencode-go/minimax-m2.7');
    if (agent.temperature !== undefined) {
      assert.equal(agent.temperature, 0.1);
    }
    assert.equal(agent.steps, steps);
    assert.deepEqual(agent.permission, {
      read: 'allow',
      write: 'allow',
      edit: 'allow',
      bash: 'allow',
      grep: 'allow',
      glob: 'allow',
      list: 'allow',
      webfetch: 'deny',
    });
    assert.equal('tools' in agent, false, `${agentName} must use permission, not tools`);
  }
});
