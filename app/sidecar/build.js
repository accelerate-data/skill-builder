import { build } from "esbuild";
import { cpSync, mkdirSync, existsSync, writeFileSync, rmSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundle agent-runner with sdk.mjs inlined (no more external)
await build({
  entryPoints: ["agent-runner.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/agent-runner.js",
  banner: {
    js: "#!/usr/bin/env node",
  },
});

console.log("Built dist/agent-runner.js");

// Write a minimal package.json so Node.js treats .js files as ESM.
// In dev mode, Node.js walks up to sidecar/package.json which has "type": "module".
// In release builds, no parent package.json exists, so Node.js defaults to CommonJS
// and crashes with "SyntaxError: Cannot use import statement outside a module".
writeFileSync(
  resolve(__dirname, "dist/package.json"),
  JSON.stringify({ type: "module" }) + "\n",
);
console.log("Wrote dist/package.json (ESM marker)");

// Copy bootstrap.js (thin wrapper that catches module-load errors)
cpSync(
  resolve(__dirname, "bootstrap.js"),
  resolve(__dirname, "dist/bootstrap.js"),
);
console.log("Copied dist/bootstrap.js");

// Stage the PyInstaller-built OpenHands runner if it already exists.
// Normal JS sidecar builds must not require Python/PyInstaller; developers can
// build the native runner explicitly via app/sidecar/openhands/build.sh.
const openHandsRunner = locateOpenHandsRunner();
const outOpenHands = resolve(__dirname, "dist/openhands");
mkdirSync(outOpenHands, { recursive: true });
if (openHandsRunner) {
  const destName =
    process.platform === "win32" ? "openhands-runner.exe" : "openhands-runner";
  const dest = resolve(outOpenHands, destName);
  if (openHandsRunner !== dest) {
    cpSync(openHandsRunner, dest);
  }
  console.log(`Staged OpenHands runner to dist/openhands/${destName}`);
} else {
  console.warn(
    "OpenHands runner binary not found — skipping. Run app/sidecar/openhands/build.sh to build it.",
  );
}

function locateOpenHandsRunner() {
  const destName =
    process.platform === "win32" ? "openhands-runner.exe" : "openhands-runner";
  const candidates = [
    resolve(__dirname, "dist", "openhands", destName),
    resolve(__dirname, "openhands", "dist", destName),
    resolve(__dirname, "openhands", destName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && basename(candidate) === destName)
      return candidate;
  }
  return null;
}

// Copy mock-templates directory for MOCK_AGENTS mode.
// These are JSONL replay files and output file templates used when
// MOCK_AGENTS=true to skip real SDK calls during UI development.
const mockSrc = resolve(__dirname, "mock-templates");
const mockDest = resolve(__dirname, "dist/mock-templates");
if (existsSync(mockSrc)) {
  if (existsSync(mockDest)) rmSync(mockDest, { recursive: true });
  cpSync(mockSrc, mockDest, { recursive: true });
  console.log("Copied mock-templates to dist/mock-templates/");
} else {
  console.warn("mock-templates not found — skipping");
}
