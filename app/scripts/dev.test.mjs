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

test('skips install when app dependencies already exist', () => {
  const commands = [];

  ensureDevPrerequisites('/repo/app', {
    existsSync: () => true,
    execSync: (command, options) => {
      commands.push({ command, options });
    },
    log: () => {},
  });

  assert.deepEqual(commands, [
    {
      command: 'npm ls --depth=0',
      options: { stdio: 'ignore', cwd: '/repo/app' },
    },
  ]);
});

test('installs app dependencies when the installed tree is invalid', () => {
  const commands = [];

  ensureDevPrerequisites('/repo/app', {
    existsSync: () => true,
    execSync: (command, options) => {
      commands.push({ command, options });
      if (command === 'npm ls --depth=0') {
        throw new Error('invalid dependency tree');
      }
    },
    log: () => {},
  });

  assert.deepEqual(commands, [
    {
      command: 'npm ls --depth=0',
      options: { stdio: 'ignore', cwd: '/repo/app' },
    },
    {
      command: 'npm install',
      options: { stdio: 'inherit', cwd: '/repo/app' },
    },
  ]);
});
