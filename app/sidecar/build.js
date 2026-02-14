import { build } from "esbuild";
import { cpSync, mkdirSync, existsSync, writeFileSync } from "fs";
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

// Copy SDK runtime files needed by cli.js at runtime.
// The SDK's query() spawns cli.js as a child process, and cli.js
// needs its sibling wasm files and vendor/ directory.
const sdkDir = resolve(__dirname, "node_modules/@anthropic-ai/claude-agent-sdk");
const outSdk = resolve(__dirname, "dist/sdk");

if (existsSync(sdkDir)) {
  mkdirSync(outSdk, { recursive: true });

  // Copy cli.js (the actual Claude Code runtime)
  cpSync(resolve(sdkDir, "cli.js"), resolve(outSdk, "cli.js"));

  // Copy wasm files (tree-sitter, resvg)
  for (const f of ["resvg.wasm", "tree-sitter-bash.wasm", "tree-sitter.wasm"]) {
    const src = resolve(sdkDir, f);
    if (existsSync(src)) cpSync(src, resolve(outSdk, f));
  }

  // Copy vendor directory (contains ripgrep binaries)
  const vendorSrc = resolve(sdkDir, "vendor");
  if (existsSync(vendorSrc)) {
    cpSync(vendorSrc, resolve(outSdk, "vendor"), { recursive: true });
  }

  // Copy manifest.json (SDK metadata)
  const manifestSrc = resolve(sdkDir, "manifest.json");
  if (existsSync(manifestSrc)) cpSync(manifestSrc, resolve(outSdk, "manifest.json"));

  console.log("Copied SDK runtime files to dist/sdk/");
} else {
  console.warn("SDK not found — skipping runtime file copy");
}
