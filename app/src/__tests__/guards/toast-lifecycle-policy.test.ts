import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Severity = "info" | "warning" | "error";
type Duration = "Infinity" | number | "unknown" | undefined;

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      files.push(...walkSourceFiles(fullPath));
      continue;
    }
    if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function getDuration(optionsArg: ts.Expression | undefined): Duration {
  if (!optionsArg) return undefined;
  if (!ts.isObjectLiteralExpression(optionsArg)) return "unknown";

  for (const property of optionsArg.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (!ts.isIdentifier(property.name) || property.name.text !== "duration") continue;

    const value = property.initializer;
    if (ts.isIdentifier(value) && value.text === "Infinity") return "Infinity";
    if (ts.isNumericLiteral(value)) return Number(value.text);
    return "unknown";
  }

  return undefined;
}

function getToastSeverity(node: ts.CallExpression): Severity | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (!ts.isIdentifier(node.expression.expression)) return null;
  if (node.expression.expression.text !== "toast") return null;

  const method = node.expression.name.text;
  if (method === "info" || method === "warning" || method === "error") return method;
  return null;
}

describe("toast lifecycle policy guard", () => {
  const sourceRoot = path.resolve(__dirname, "../../");

  it("enforces severity-based duration rules in source", () => {
    const files = walkSourceFiles(sourceRoot);
    const violations: string[] = [];

    for (const filePath of files) {
      const sourceText = fs.readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const relPath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const severity = getToastSeverity(node);
          if (severity) {
            const duration = getDuration(node.arguments[1]);
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

            if ((severity === "warning" || severity === "error") && duration !== "Infinity") {
              violations.push(`${relPath}:${line + 1} ${severity} toast must use duration: Infinity`);
            }

            if (severity === "info" && duration !== undefined && duration !== 5000) {
              violations.push(`${relPath}:${line + 1} info toast must use duration 5000 (or default)`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });

  it("covers all required scenario groups with toast calls", () => {
    const files = walkSourceFiles(sourceRoot);
    const countsByFile = new Map<string, Record<Severity, number>>();
    const initial = (): Record<Severity, number> => ({ info: 0, warning: 0, error: 0 });

    for (const filePath of files) {
      const sourceText = fs.readFileSync(filePath, "utf-8");
      const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const relPath = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
      const counts = initial();

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const severity = getToastSeverity(node);
          if (severity) counts[severity] += 1;
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
      countsByFile.set(relPath, counts);
    }

    const required: Array<{ file: string; severities: Severity[] }> = [
      { file: "components/layout/app-layout.tsx", severities: ["info", "error"] },
      // workflow.tsx delegates all toast calls to use-workflow-state-machine.ts (listed below)
      { file: "hooks/use-agent-stream.ts", severities: ["info"] },
      { file: "hooks/use-workflow-state-machine.ts", severities: ["info", "warning", "error"] },
      { file: "pages/refine.tsx", severities: ["info", "error"] },
      { file: "components/feedback-dialog.tsx", severities: ["error"] },
      { file: "pages/test.tsx", severities: ["error"] },
      { file: "pages/settings.tsx", severities: ["error"] },
      { file: "pages/dashboard.tsx", severities: ["error"] },
      { file: "components/workspace-skills-tab.tsx", severities: ["error"] },
      { file: "pages/usage.tsx", severities: ["error"] },
    ];

    const missing: string[] = [];
    for (const item of required) {
      const counts = countsByFile.get(item.file) ?? initial();
      for (const severity of item.severities) {
        if (counts[severity] < 1) {
          missing.push(`${item.file} missing ${severity} toast coverage`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("keeps global info default at 5000ms", () => {
    const sonnerPath = path.resolve(sourceRoot, "components/ui/sonner.tsx");
    const sonnerText = fs.readFileSync(sonnerPath, "utf-8");

    expect(sonnerText).toContain("duration={5000}");
    expect(sonnerText).toContain("closeButton");
  });
});
