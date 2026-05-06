import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureDevPrerequisites } from './dev-lib.mjs';

test('installs app dependencies when required root package is missing', () => {
  const commands = [];
  const existing = new Set();

  ensureDevPrerequisites('/repo/app', {
    existsSync: (path) => existing.has(path),
    execSync: (command, options) => {
      commands.push({ command, options });
      if (command === 'npm install') {
        existing.add('/repo/app/node_modules/@tanstack/react-query');
        existing.add('/repo/app/promptfoo-sidecar/node_modules');
        existing.add('/repo/app/promptfoo-sidecar/dist');
      }
    },
    log: () => {},
  });

  assert.deepEqual(commands, [
    {
      command: 'npm install',
      options: { stdio: 'inherit', cwd: '/repo/app' },
    },
  ]);
});

test('installs promptfoo-sidecar dependencies when nested node_modules is missing', () => {
  const commands = [];
  const existing = new Set(['/repo/app/node_modules/@tanstack/react-query']);

  ensureDevPrerequisites('/repo/app', {
    existsSync: (path) => existing.has(path),
    execSync: (command, options) => {
      commands.push({ command, options });
      if (command === 'npm run promptfoo-sidecar:install') {
        existing.add('/repo/app/promptfoo-sidecar/node_modules');
      }
    },
    log: () => {},
  });

  assert.deepEqual(commands, [
    {
      command: 'npm run promptfoo-sidecar:install',
      options: { stdio: 'inherit', cwd: '/repo/app' },
    },
    {
      command: 'npm run promptfoo-sidecar:build',
      options: { stdio: 'inherit', cwd: '/repo/app' },
    },
  ]);
});

test('builds promptfoo-sidecar when dist is missing', () => {
  const commands = [];
  const existing = new Set([
    '/repo/app/node_modules/@tanstack/react-query',
    '/repo/app/promptfoo-sidecar/node_modules',
  ]);

  ensureDevPrerequisites('/repo/app', {
    existsSync: (path) => existing.has(path),
    execSync: (command, options) => {
      commands.push({ command, options });
      if (command === 'npm run promptfoo-sidecar:build') {
        existing.add('/repo/app/promptfoo-sidecar/dist');
      }
    },
    log: () => {},
  });

  assert.deepEqual(commands, [
    {
      command: 'npm run promptfoo-sidecar:build',
      options: { stdio: 'inherit', cwd: '/repo/app' },
    },
  ]);
});

test('skips install when promptfoo-sidecar dependencies already exist', () => {
  const commands = [];

  ensureDevPrerequisites('/repo/app', {
    existsSync: () => true,
    execSync: (command, options) => {
      commands.push({ command, options });
    },
    log: () => {},
  });

  assert.deepEqual(commands, []);
});
