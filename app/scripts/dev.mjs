#!/usr/bin/env node
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let port = process.env.DEV_PORT;

if (!port) {
  // Auto-assign an available port
  try {
    port = execSync('node scripts/find-port.mjs', { cwd: root, encoding: 'utf-8' }).trim();
    console.log(`\x1b[36m[dev]\x1b[0m Auto-assigned port: ${port}`);
  } catch {
    port = '1420';
    console.warn(`\x1b[33m[dev]\x1b[0m Port auto-assignment failed, using default: ${port}`);
  }
} else {
  console.log(`\x1b[36m[dev]\x1b[0m Using DEV_PORT: ${port}`);
}

const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });
const env = { ...process.env, DEV_PORT: port };

try {
  execSync('npm run sidecar:build', { stdio: 'inherit', cwd: root });
  const quote = process.platform === 'win32' ? `"` : `'`;
  const escapedConfig = process.platform === 'win32' ? config.replace(/"/g, '\\"') : config;
  execSync(`npx tauri dev --config ${quote}${escapedConfig}${quote}`, { stdio: 'inherit', cwd: root, env });
} catch (e) {
  process.exit(e.status || 1);
}
