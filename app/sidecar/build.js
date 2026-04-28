import { build } from "esbuild";
import { cpSync, mkdirSync, existsSync, writeFileSync, rmSync } from "fs";
import { resolve, dirname } from "path";
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
cpSync(resolve(__dirname, "bootstrap.js"), resolve(__dirname, "dist/bootstrap.js"));
console.log("Copied dist/bootstrap.js");

// Copy the SDK's native `claude` binary to dist/sdk/.
// As of @anthropic-ai/claude-agent-sdk 0.2.116+, the runtime ships as a
// platform-specific native executable in a sibling optional dependency
// (e.g. @anthropic-ai/claude-agent-sdk-darwin-arm64), not as cli.js.
// We pass the copied path to the SDK via `pathToClaudeCodeExecutable`.
const outSdk = resolve(__dirname, "dist/sdk");
const sdkBinary = locateSdkBinary();
if (sdkBinary) {
  mkdirSync(outSdk, { recursive: true });
  const destName = process.platform === "win32" ? "claude.exe" : "claude";
  cpSync(sdkBinary, resolve(outSdk, destName));
  console.log(`Copied SDK binary to dist/sdk/${destName}`);
} else {
  console.warn("SDK native binary not found — skipping");
}

function locateSdkBinary() {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === "win32" ? ".exe" : "";
  // On Linux, npm may install either the glibc or musl variant depending on host.
  const candidates =
    platform === "linux"
      ? [
          `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
          `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
        ]
      : [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`];
  for (const pkg of candidates) {
    const candidate = resolve(__dirname, "node_modules", pkg, `claude${ext}`);
    if (existsSync(candidate)) return candidate;
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
