import { execSync as defaultExecSync } from 'child_process';
import { existsSync as defaultExistsSync } from 'fs';
import { join } from 'path';

export function ensurePromptfooSidecarDependencies(
  root,
  {
    existsSync = defaultExistsSync,
    execSync = defaultExecSync,
    log = console.log,
  } = {},
) {
  const nestedNodeModules = join(root, 'promptfoo-sidecar', 'node_modules');
  if (existsSync(nestedNodeModules)) {
    return;
  }

  log('\x1b[36m[dev]\x1b[0m Installing missing promptfoo-sidecar dependencies');
  execSync('npm run promptfoo-sidecar:install', {
    stdio: 'inherit',
    cwd: root,
  });
}
