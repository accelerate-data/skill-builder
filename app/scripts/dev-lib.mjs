import { execSync as defaultExecSync } from 'child_process';
import { existsSync as defaultExistsSync } from 'fs';
import { join } from 'path';

export function ensureDevPrerequisites(
  root,
  {
    existsSync = defaultExistsSync,
    execSync = defaultExecSync,
    log = console.log,
  } = {},
) {
  const requiredAppDependency = join(root, 'node_modules', '@tanstack', 'react-query');
  if (!existsSync(requiredAppDependency)) {
    log('\x1b[36m[dev]\x1b[0m Installing missing app dependencies');
    execSync('npm install', {
      stdio: 'inherit',
      cwd: root,
    });
  }
}
