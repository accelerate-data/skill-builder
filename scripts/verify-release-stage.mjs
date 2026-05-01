#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_BY_PLATFORM = {
  windows: [
    "skill-builder.exe",
    "sidecar/dist/package.json",
    "sidecar/dist/bootstrap.js",
    "sidecar/dist/agent-runner.js",
    "sidecar/dist/openhands/openhands-runner.exe",
    "agent-sources/plugins/skill-creator/LICENSE.txt",
    "agent-sources/skills/skill-test/SKILL.md",
    "workspace/CLAUDE.md",
    "workspace/prompts/workflow-step.txt",
  ],
  macos: [
    "Skill Builder.app",
    "run.sh",
    "Skill Builder.app/Contents/Resources/sidecar/dist/package.json",
    "Skill Builder.app/Contents/Resources/sidecar/dist/bootstrap.js",
    "Skill Builder.app/Contents/Resources/sidecar/dist/agent-runner.js",
    "Skill Builder.app/Contents/Resources/sidecar/dist/openhands/openhands-runner",
    "Skill Builder.app/Contents/Resources/agent-sources/plugins/skill-creator/LICENSE.txt",
    "Skill Builder.app/Contents/Resources/agent-sources/skills/skill-test/SKILL.md",
    "Skill Builder.app/Contents/Resources/workspace/CLAUDE.md",
    "Skill Builder.app/Contents/Resources/workspace/prompts/workflow-step.txt",
  ],
};

export function verifyReleaseStage(stageDir, platform) {
  const requiredPaths = REQUIRED_BY_PLATFORM[platform];
  if (!requiredPaths) {
    throw new Error(`Unknown release platform: ${platform}`);
  }

  return requiredPaths.filter((relativePath) => {
    return !existsSync(resolve(stageDir, relativePath));
  });
}

function main() {
  const [stageDir, platform] = process.argv.slice(2);

  if (!stageDir || !platform) {
    console.error("Usage: node scripts/verify-release-stage.mjs <stage-dir> <windows|macos>");
    process.exit(2);
  }

  const missingPaths = verifyReleaseStage(stageDir, platform);
  if (missingPaths.length > 0) {
    console.error(`Release stage is missing ${missingPaths.length} required path(s):`);
    for (const relativePath of missingPaths) {
      console.error(`- ${relativePath}`);
    }
    process.exit(1);
  }

  console.log(`Release stage verified for ${platform}: ${stageDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
