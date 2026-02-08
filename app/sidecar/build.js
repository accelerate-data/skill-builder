import { build } from "esbuild";

await build({
  entryPoints: ["agent-runner.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/agent-runner.js",
  // Keep the SDK external — it needs to resolve cli.js relative to its own location
  external: ["@anthropic-ai/claude-code"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});

console.log("Built dist/agent-runner.js");
