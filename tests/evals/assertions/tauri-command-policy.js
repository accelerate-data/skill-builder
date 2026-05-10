const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_UNSAFE_WRAPPER_COMMAND_ALLOWLIST = [
  "log_frontend",
  "start_agent",
  "run_workflow_step",
  "materialize_workflow_step_output",
  "reset_workflow_step",
  "navigate_back_to_step",
  "preview_step_reset",
  "verify_step_output",
  "get_disabled_steps",
  "get_workflow_state",
  "save_workflow_state",
  "read_file",
  "write_file",
  "list_skill_files",
  "get_workspace_path",
  "graceful_shutdown",
  "allow_app_exit",
  "create_workflow_session",
  "end_workflow_session",
  "resolve_orphan",
  "resolve_discovery",
  "create_github_issue",
  "acquire_lock",
  "release_lock",
  "get_externally_locked_skills",
  "get_usage_summary",
  "get_recent_workflow_sessions",
  "get_step_agent_runs",
  "get_agent_runs",
  "get_usage_by_step",
  "get_usage_by_model",
  "get_usage_by_day",
  "get_workflow_skill_names",
  "reset_usage",
  "create_skill",
  "get_all_tags",
  "list_documents",
  "list_skills_for_documents",
  "add_document_file",
  "add_document_url",
  "add_document_folder",
  "update_document",
  "delete_document",
];

function loadTypescript(repoRoot) {
  try {
    return require("typescript");
  } catch (error) {
    if (error && error.code !== "MODULE_NOT_FOUND") throw error;
    return require(path.join(repoRoot, "app/node_modules/typescript"));
  }
}

function toPosix(relativePath) {
  return relativePath.replace(/\\/g, "/");
}

function listSourceFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (["__tests__", "node_modules", "test"].includes(entry.name)) continue;
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function getIdentifierName(ts, node) {
  return ts.isIdentifier(node) ? node.text : undefined;
}

function collectAliasNames(ts, sourceFile, seedNames) {
  const aliases = new Set(seedNames);
  let changed = true;

  while (changed) {
    changed = false;

    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializerName = getIdentifierName(ts, node.initializer);
        if (initializerName && aliases.has(initializerName) && !aliases.has(node.name.text)) {
          aliases.add(node.name.text);
          changed = true;
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return aliases;
}

function isTauriWrapperImport(moduleSpecifier, filePath, sourceRoot, wrapperRelativePath) {
  if (moduleSpecifier === "@/lib/tauri") return true;
  if (!moduleSpecifier.startsWith(".")) return false;

  const resolved = toPosix(path.relative(sourceRoot, path.resolve(path.dirname(filePath), moduleSpecifier)));
  return resolved === wrapperRelativePath || `${resolved}.ts` === wrapperRelativePath;
}

function importedNames(ts, sourceFile, moduleMatches, importedName) {
  const names = new Set();

  function visit(node) {
    if (!ts.isImportDeclaration(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    if (!ts.isStringLiteral(node.moduleSpecifier) || !moduleMatches(node.moduleSpecifier.text)) return;
    const importClause = node.importClause;
    if (!importClause) return;

    if (importedName === "default" && importClause.name) {
      names.add(importClause.name.text);
    }

    const namedBindings = importClause.namedBindings;
    if (!namedBindings) return;

    if (ts.isNamespaceImport(namedBindings) && importedName === "*") {
      names.add(namedBindings.name.text);
      return;
    }

    if (!ts.isNamedImports(namedBindings)) return;

    for (const element of namedBindings.elements) {
      const sourceName = element.propertyName ? element.propertyName.text : element.name.text;
      if (sourceName === importedName) names.add(element.name.text);
    }
  }

  visit(sourceFile);
  return names;
}

function hasModuleImport(ts, sourceFile, moduleName) {
  let found = false;

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === moduleName
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function getCallIdentifier(ts, expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  return undefined;
}

function getMemberCall(ts, expression) {
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ts.isIdentifier(expression.name)
  ) {
    return {
      objectName: expression.expression.text,
      propertyName: expression.name.text,
    };
  }

  return undefined;
}

function getStringArgument(ts, callExpression) {
  const firstArg = callExpression.arguments[0];
  return firstArg && ts.isStringLiteral(firstArg) ? firstArg.text : undefined;
}

function isExported(ts, node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function isInsideInvokeCommandDeclaration(ts, node) {
  let current = node;

  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text === "invokeCommand";
    }
    current = current.parent;
  }

  return false;
}

function analyzeSource(ts, source, filePath) {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function analyzeTauriCommandPolicy(options) {
  const repoRoot = options.repoRoot;
  const sourceRoot = options.sourceRoot || path.join(repoRoot, "app/src");
  const wrapperRelativePath = toPosix(options.wrapperRelativePath || "lib/tauri.ts");
  const unsafeWrapperCommandAllowlist = new Set(
    options.unsafeWrapperCommandAllowlist || DEFAULT_UNSAFE_WRAPPER_COMMAND_ALLOWLIST,
  );
  const ts = loadTypescript(repoRoot);

  const rawTauriImportOffenders = [];
  const rawInvokeCallOffenders = [];
  const wrapperRawInvokeCallOffenders = [];
  const unsafeCallOffenders = [];
  const wrapperUnsafeCommandOffenders = [];
  const wrapperNonLiteralUnsafeCalls = [];
  const wrapperAllowedUnsafeCommands = [];
  let invokeCommandExportCount = 0;
  let invokeUnsafeExportCount = 0;

  for (const filePath of listSourceFiles(sourceRoot)) {
    const relPath = toPosix(path.relative(sourceRoot, filePath));
    const source = fs.readFileSync(filePath, "utf8");
    const sourceFile = analyzeSource(ts, source, filePath);
    const isWrapper = relPath === wrapperRelativePath;

    const rawInvokeNames = collectAliasNames(
      ts,
      sourceFile,
      importedNames(ts, sourceFile, (moduleSpecifier) => moduleSpecifier === "@tauri-apps/api/core", "invoke"),
    );
    if (isWrapper) rawInvokeNames.delete("invokeUnsafe");
    const unsafeNames = collectAliasNames(
      ts,
      sourceFile,
      importedNames(
        ts,
        sourceFile,
        (moduleSpecifier) => isTauriWrapperImport(moduleSpecifier, filePath, sourceRoot, wrapperRelativePath),
        "invokeUnsafe",
      ),
    );
    const unsafeNamespaces = collectAliasNames(
      ts,
      sourceFile,
      importedNames(
        ts,
        sourceFile,
        (moduleSpecifier) => isTauriWrapperImport(moduleSpecifier, filePath, sourceRoot, wrapperRelativePath),
        "*",
      ),
    );
    if (isWrapper) unsafeNames.add("invokeUnsafe");

    if (!isWrapper && hasModuleImport(ts, sourceFile, "@tauri-apps/api/core")) {
      rawTauriImportOffenders.push(relPath);
    }

    function visit(node) {
      if (isWrapper && ts.isVariableStatement(node) && isExported(ts, node)) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          if (declaration.name.text === "invokeCommand") invokeCommandExportCount += 1;
          if (declaration.name.text === "invokeUnsafe") invokeUnsafeExportCount += 1;
        }
      }

      if (ts.isCallExpression(node)) {
        const callee = getCallIdentifier(ts, node.expression);
        const memberCall = getMemberCall(ts, node.expression);
        if (callee && rawInvokeNames.has(callee)) {
          const location = `${relPath}:${node.getStart(sourceFile)}`;
          if (isWrapper) {
            if (!isInsideInvokeCommandDeclaration(ts, node)) wrapperRawInvokeCallOffenders.push(location);
          } else {
            rawInvokeCallOffenders.push(location);
          }
        }

        const callsInvokeUnsafe =
          (callee && unsafeNames.has(callee)) ||
          (memberCall &&
            memberCall.propertyName === "invokeUnsafe" &&
            unsafeNamespaces.has(memberCall.objectName));

        if (callsInvokeUnsafe) {
          const commandName = getStringArgument(ts, node);

          if (!isWrapper) {
            unsafeCallOffenders.push(`${relPath}:${node.getStart(sourceFile)}`);
          } else if (!commandName) {
            wrapperNonLiteralUnsafeCalls.push(`${relPath}:${node.getStart(sourceFile)}`);
          } else if (unsafeWrapperCommandAllowlist.has(commandName)) {
            wrapperAllowedUnsafeCommands.push(commandName);
          } else {
            wrapperUnsafeCommandOffenders.push(commandName);
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    rawTauriImportOffenders,
    rawInvokeCallOffenders,
    wrapperRawInvokeCallOffenders,
    unsafeCallOffenders,
    wrapperUnsafeCommandOffenders,
    wrapperNonLiteralUnsafeCalls,
    wrapperAllowedUnsafeCommands,
    invokeCommandExportCount,
    invokeUnsafeExportCount,
  };
}

module.exports = {
  DEFAULT_UNSAFE_WRAPPER_COMMAND_ALLOWLIST,
  analyzeTauriCommandPolicy,
};
