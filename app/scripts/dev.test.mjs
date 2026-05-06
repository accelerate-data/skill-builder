import test from 'node:test';
import assert from 'node:assert/strict';

import { ensurePromptfooSidecarDependencies } from './dev-lib.mjs';

test('installs promptfoo-sidecar dependencies when nested node_modules is missing', () => {
  const commands = [];

  ensurePromptfooSidecarDependencies('/repo/app', {
    existsSync: () => false,
    execSync: (command, options) => {
      commands.push({ command, options });
    },
    log: () => {},
  });

  assert.deepEqual(commands, [
    {
      command: 'npm run promptfoo-sidecar:install',
      options: { stdio: 'inherit', cwd: '/repo/app' },
    },
  ]);
});

test('skips install when promptfoo-sidecar dependencies already exist', () => {
  const commands = [];

  ensurePromptfooSidecarDependencies('/repo/app', {
    existsSync: () => true,
    execSync: (command, options) => {
      commands.push({ command, options });
    },
    log: () => {},
  });

  assert.deepEqual(commands, []);
});
