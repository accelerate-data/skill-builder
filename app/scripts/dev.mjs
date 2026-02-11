#!/usr/bin/env node
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const port = process.env.DEV_PORT || '1420';
const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });
const env = { ...process.env, DEV_PORT: port };

try {
  execSync('npm run sidecar:build', { stdio: 'inherit', cwd: root });
  execSync(`npx tauri dev --config '${config}'`, { stdio: 'inherit', cwd: root, env });
} catch (e) {
  process.exit(e.status || 1);
}
