"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/config.ts
var config_exports = {};
__export(config_exports, {
  getDefaultConfig: () => getDefaultConfig,
  loadConfig: () => loadConfig,
  watchConfigFile: () => watchConfigFile
});
function getDefaultConfig() {
  return {
    ignore: [
      "node_modules",
      ".git",
      "dist",
      "out",
      ".ascii_history",
      "*.log",
      ".DS_Store",
      "yarn.lock",
      "package-lock.json"
    ],
    architectureWatchPatterns: ["src/**/*.{ts,tsx,js,jsx}", "lib/**/*.{ts,tsx,js,jsx}", "api/**/*.ts"],
    outputPaths: {
      fileTree: "docs/file_tree.md",
      architecture: "docs/architecture.md"
    },
    debounceMs: 2e3,
    maxHistorySnapshots: 50,
    autoWatchEnabled: true,
    contextFiles: [],
    filePriority: []
    // `tags` is intentionally undefined here — tree-generator uses its own defaults when absent.
  };
}
async function loadConfig(workspaceRoot) {
  const configUri = vscode.Uri.joinPath(workspaceRoot, ".asciirc.json");
  const defaults = getDefaultConfig();
  let rawText;
  try {
    const bytes = await vscode.workspace.fs.readFile(configUri);
    rawText = Buffer.from(bytes).toString("utf-8");
  } catch {
    return defaults;
  }
  let parsed;
  try {
    const stripped = stripJsoncComments(rawText);
    parsed = JSON.parse(stripped);
  } catch (err) {
    vscode.window.showWarningMessage(`ASCII Agent: .asciirc.json is malformed \u2014 using defaults. (${String(err)})`);
    return defaults;
  }
  const merged = deepMergeConfig(defaults, parsed);
  return validateConfig(merged);
}
function watchConfigFile(workspaceRoot, onChange) {
  const pattern = new vscode.RelativePattern(workspaceRoot, ".asciirc.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const reload = async () => {
    const cfg = await loadConfig(workspaceRoot);
    onChange(cfg);
  };
  const onCreate = watcher.onDidCreate(reload);
  const onChange_ = watcher.onDidChange(reload);
  const onDelete = watcher.onDidDelete(async () => {
    onChange(getDefaultConfig());
  });
  return {
    dispose: () => {
      watcher.dispose();
      onCreate.dispose();
      onChange_.dispose();
      onDelete.dispose();
    }
  };
}
function deepMergeConfig(base, overrides) {
  return {
    ignore: overrides.ignore !== void 0 ? overrides.ignore : base.ignore,
    architectureWatchPatterns: overrides.architectureWatchPatterns !== void 0 ? overrides.architectureWatchPatterns : base.architectureWatchPatterns,
    outputPaths: overrides.outputPaths !== void 0 ? { ...base.outputPaths, ...overrides.outputPaths } : base.outputPaths,
    debounceMs: overrides.debounceMs !== void 0 ? overrides.debounceMs : base.debounceMs,
    maxHistorySnapshots: overrides.maxHistorySnapshots !== void 0 ? overrides.maxHistorySnapshots : base.maxHistorySnapshots,
    autoWatchEnabled: overrides.autoWatchEnabled !== void 0 ? overrides.autoWatchEnabled : base.autoWatchEnabled,
    contextFiles: overrides.contextFiles !== void 0 ? overrides.contextFiles : base.contextFiles,
    filePriority: overrides.filePriority !== void 0 ? overrides.filePriority : base.filePriority,
    // `tags` is optional — only set if user explicitly provided it.
    tags: overrides.tags !== void 0 ? overrides.tags : base.tags
  };
}
function validateConfig(cfg) {
  if (cfg.debounceMs < 500) {
    vscode.window.showWarningMessage("ASCII Agent: debounceMs must be \u2265 500. Resetting to 500.");
    cfg.debounceMs = 500;
  }
  if (cfg.maxHistorySnapshots < 1) {
    vscode.window.showWarningMessage("ASCII Agent: maxHistorySnapshots must be \u2265 1. Resetting to 1.");
    cfg.maxHistorySnapshots = 1;
  }
  return cfg;
}
function stripJsoncComments(text) {
  return text.replace(/\/\/[^\n]*/g, "");
}
var vscode;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    vscode = __toESM(require("vscode"));
  }
});

// src/logger.ts
function initLogger(channel) {
  _channel = channel;
}
var _channel, log;
var init_logger = __esm({
  "src/logger.ts"() {
    "use strict";
    log = {
      /**
       * Log an informational message.
       * @param message - The message to log.
       */
      info(message) {
        _channel?.appendLine(`[INFO]  ${message}`);
      },
      /**
       * Log a warning message.
       * @param message - The message to log.
       */
      warn(message) {
        _channel?.appendLine(`[WARN]  ${message}`);
      },
      /**
       * Log an error message.
       * @param message - The message to log.
       */
      error(message) {
        _channel?.appendLine(`[ERROR] ${message}`);
      },
      /**
       * Log a raw message with no prefix — for structured output (e.g. command output).
       * @param message - The message to log.
       */
      raw(message) {
        _channel?.appendLine(message);
      }
    };
  }
});

// src/utils.ts
var utils_exports = {};
__export(utils_exports, {
  ensureDirectoryExists: () => ensureDirectoryExists,
  matchesAnyPattern: () => matchesAnyPattern,
  workspaceRelativePath: () => workspaceRelativePath
});
function matchesAnyPattern(filePath, patterns) {
  return patterns.some((pattern) => minimatch(filePath, pattern));
}
function workspaceRelativePath(uri, workspaceRoot) {
  const rootPath = workspaceRoot.fsPath.replace(/\\/g, "/").replace(/\/$/, "");
  const filePath = uri.fsPath.replace(/\\/g, "/");
  return filePath.startsWith(rootPath + "/") ? filePath.slice(rootPath.length + 1) : filePath;
}
async function ensureDirectoryExists(uri) {
  try {
    await vscode2.workspace.fs.createDirectory(uri);
  } catch {
  }
}
function minimatch(path, pattern) {
  const normalizedPath = path.replace(/\\/g, "/");
  const patterns = expandBraces(pattern);
  return patterns.some((p) => matchGlob(normalizedPath, p));
}
function expandBraces(pattern) {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match) {
    return [pattern];
  }
  const alternatives = match[1].split(",");
  const results = [];
  for (const alt of alternatives) {
    const expanded = pattern.slice(0, match.index) + alt + pattern.slice(match.index + match[0].length);
    results.push(...expandBraces(expanded));
  }
  return results;
}
function matchGlob(path, pattern) {
  let regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "DOUBLESTAR").replace(/\*/g, "[^/]*").replace(/\u0001DOUBLESTAR\u0001/g, ".*").replace(/\?/g, "[^/]");
  if (!pattern.includes("/")) {
    regexStr = "(^|.*/)(" + regexStr + ")$";
  } else {
    regexStr = "^" + regexStr + "$";
  }
  try {
    return new RegExp(regexStr).test(path);
  } catch {
    return false;
  }
}
var vscode2;
var init_utils = __esm({
  "src/utils.ts"() {
    "use strict";
    vscode2 = __toESM(require("vscode"));
  }
});

// src/tree-generator.ts
var tree_generator_exports = {};
__export(tree_generator_exports, {
  generateFileTree: () => generateFileTree
});
async function generateFileTree(workspaceRoot, config) {
  const tagMap = config.tags ?? DEFAULT_TAGS;
  let entryCount = 0;
  let truncated = false;
  async function buildLines(dirUri, relPath, prefix) {
    if (truncated) {
      return [];
    }
    let entries;
    try {
      entries = await vscode3.workspace.fs.readDirectory(dirUri);
    } catch {
      return [];
    }
    const filtered = entries.filter(([name]) => {
      const entryRelPath = relPath ? `${relPath}/${name}` : name;
      return !matchesAnyPattern(entryRelPath, config.ignore) && !matchesAnyPattern(name, config.ignore);
    });
    const sorted = filtered.sort(([nameA, typeA], [nameB, typeB]) => {
      const aIsDir = typeA === vscode3.FileType.Directory;
      const bIsDir = typeB === vscode3.FileType.Directory;
      if (aIsDir !== bIsDir) {
        return aIsDir ? -1 : 1;
      }
      return nameA.localeCompare(nameB);
    });
    const lines = [];
    for (let i = 0; i < sorted.length; i++) {
      if (truncated) {
        break;
      }
      const [name, type] = sorted[i];
      const isLast = i === sorted.length - 1;
      const entryRelPath = relPath ? `${relPath}/${name}` : name;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const childPrefix = isLast ? "    " : "\u2502   ";
      entryCount++;
      if (entryCount > MAX_ENTRIES) {
        const remaining = sorted.length - i;
        lines.push(`${prefix}... (truncated: ${remaining} more entries not shown)`);
        truncated = true;
        break;
      }
      if (type === vscode3.FileType.Directory) {
        lines.push(`${prefix}${connector}${name}/`);
        const childLines = await buildLines(vscode3.Uri.joinPath(dirUri, name), entryRelPath, prefix + childPrefix);
        lines.push(...childLines);
      } else {
        const tag = resolveTag(entryRelPath, tagMap);
        const tagSuffix = tag ? `  ${tag}` : "";
        lines.push(`${prefix}${connector}${name}${tagSuffix}`);
      }
    }
    return lines;
  }
  const rootName = workspaceRoot.path.split("/").pop() ?? workspaceRoot.fsPath.split("/").pop() ?? "workspace";
  const bodyLines = await buildLines(workspaceRoot, "", "");
  const allLines = [rootName + "/", ...bodyLines];
  const rawTree = allLines.join("\n");
  return `# File Tree

\`\`\`
${rawTree}
\`\`\`
`;
}
function resolveTag(relPath, tagMap) {
  for (const [pattern, tag] of Object.entries(tagMap)) {
    if (matchesAnyPattern(relPath, [pattern])) {
      return tag;
    }
  }
  return void 0;
}
var vscode3, MAX_ENTRIES, DEFAULT_TAGS;
var init_tree_generator = __esm({
  "src/tree-generator.ts"() {
    "use strict";
    vscode3 = __toESM(require("vscode"));
    init_utils();
    MAX_ENTRIES = 5e3;
    DEFAULT_TAGS = {
      "*.config.*": "[config]",
      "*.json": "[config]",
      "src/components/**": "[ui]",
      "src/**": "[source]",
      "lib/**": "[source]",
      "api/**": "[backend]",
      "docs/**": "[docs]",
      "test/**": "[test]",
      "scripts/**": "[script]"
    };
  }
});

// src/watcher.ts
var watcher_exports = {};
__export(watcher_exports, {
  cancelPendingTimers: () => cancelPendingTimers,
  startWatching: () => startWatching,
  stopWatching: () => stopWatching
});
function startWatching(config, context, handlers) {
  const workspaceFolders = vscode4.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    log.warn("startWatching: no workspace folder \u2014 aborting.");
    return { dispose: () => void 0 };
  }
  const workspaceRoot = workspaceFolders[0].uri;
  const watcher = vscode4.workspace.createFileSystemWatcher(new vscode4.RelativePattern(workspaceRoot, "**/*"));
  const outputFilePaths = /* @__PURE__ */ new Set([config.outputPaths.fileTree, config.outputPaths.architecture]);
  function classifyEvent(uri) {
    const relPath = workspaceRelativePath(uri, workspaceRoot);
    if (outputFilePaths.has(relPath)) {
      return "ignore";
    }
    if (relPath.startsWith(".ascii_history/") || relPath === ".ascii_history") {
      return "ignore";
    }
    if (matchesAnyPattern(relPath, config.ignore) || matchesAnyPattern(relPath.split("/").pop() ?? "", config.ignore)) {
      return "ignore";
    }
    if (matchesAnyPattern(relPath, config.architectureWatchPatterns)) {
      return "tree-and-arch";
    }
    return "tree-only";
  }
  function scheduleTreeRegen() {
    if (treeDebounceTimer !== void 0) {
      clearTimeout(treeDebounceTimer);
    }
    treeDebounceTimer = setTimeout(async () => {
      treeDebounceTimer = void 0;
      log.info("Debounce expired \u2014 regenerating file tree.");
      try {
        await handlers.onTreeRegenNeeded();
      } catch (err) {
        log.error(`Tree regen failed: ${String(err)}`);
      }
    }, config.debounceMs);
  }
  function scheduleArchRegen() {
    if (archDebounceTimer !== void 0) {
      clearTimeout(archDebounceTimer);
    }
    archDebounceTimer = setTimeout(async () => {
      archDebounceTimer = void 0;
      log.info("Debounce expired \u2014 regenerating architecture diagram.");
      try {
        await handlers.onArchitectureRegenNeeded();
      } catch (err) {
        log.error(`Architecture regen failed: ${String(err)}`);
      }
    }, config.debounceMs);
  }
  function handleEvent(uri) {
    const classification = classifyEvent(uri);
    if (classification === "ignore") {
      return;
    }
    scheduleTreeRegen();
    if (classification === "tree-and-arch") {
      scheduleArchRegen();
    }
  }
  const onCreate = watcher.onDidCreate(handleEvent);
  const onChange = watcher.onDidChange(handleEvent);
  const onDelete = watcher.onDidDelete(handleEvent);
  log.info(`Watcher started. debounceMs=${config.debounceMs}`);
  return {
    dispose: () => {
      if (treeDebounceTimer !== void 0) {
        clearTimeout(treeDebounceTimer);
        treeDebounceTimer = void 0;
      }
      if (archDebounceTimer !== void 0) {
        clearTimeout(archDebounceTimer);
        archDebounceTimer = void 0;
      }
      onCreate.dispose();
      onChange.dispose();
      onDelete.dispose();
      watcher.dispose();
      log.info("Watcher stopped.");
    }
  };
}
function stopWatching(session) {
  session.dispose();
}
function cancelPendingTimers() {
  if (treeDebounceTimer !== void 0) {
    clearTimeout(treeDebounceTimer);
    treeDebounceTimer = void 0;
  }
  if (archDebounceTimer !== void 0) {
    clearTimeout(archDebounceTimer);
    archDebounceTimer = void 0;
  }
}
var vscode4, treeDebounceTimer, archDebounceTimer;
var init_watcher = __esm({
  "src/watcher.ts"() {
    "use strict";
    vscode4 = __toESM(require("vscode"));
    init_utils();
    init_logger();
  }
});

// src/architecture-agent.ts
var architecture_agent_exports = {};
__export(architecture_agent_exports, {
  generateArchitectureDiagram: () => generateArchitectureDiagram
});
async function generateArchitectureDiagram(config, workspaceRoot, lmClient, token) {
  const models = await vscode5.lm.selectChatModels({ vendor: "copilot" });
  const model = models[0];
  const tokenBudget = model ? Math.floor(model.maxInputTokens * INPUT_BUDGET_FRACTION) : 8e3;
  const sourceContent = await gatherSourceContext(config, workspaceRoot, tokenBudget, model);
  const previousArchitecture = await readPreviousArchitecture(config, workspaceRoot);
  const contextFilesContent = await readContextFiles(config, workspaceRoot);
  const workspaceFolderName = workspaceRoot.path.split("/").filter(Boolean).pop() ?? workspaceRoot.fsPath.split(/[\\/]/).filter(Boolean).pop() ?? "workspace";
  const promptText = SYSTEM_PROMPT_TEMPLATE.replace("{workspace_folder_name}", workspaceFolderName).replace("{previous_architecture}", previousArchitecture || "N/A").replace("{context_files_content}", contextFilesContent || "N/A").replace("{source_files_content}", sourceContent || "N/A");
  log.info(`Sending architecture prompt (~${promptText.length} chars) to LM.`);
  const messages = [vscode5.LanguageModelChatMessage.User(promptText)];
  const rawResponse = await lmClient.sendPrompt(messages, token);
  const cleaned = postProcessResponse(rawResponse);
  log.info(`Architecture diagram received (${cleaned.length} chars).`);
  return `# Architecture Diagram

\`\`\`
${cleaned.trimEnd()}
\`\`\`
`;
}
async function gatherSourceContext(config, workspaceRoot, tokenBudget, model) {
  const allCandidates = await collectCandidateFiles(config, workspaceRoot);
  const prioritized = prioritizeFiles(allCandidates, config);
  const sections = [];
  let usedTokens = 0;
  for (const relPath of prioritized) {
    const fileUri = vscode5.Uri.joinPath(workspaceRoot, relPath);
    let content;
    try {
      const bytes = await vscode5.workspace.fs.readFile(fileUri);
      content = Buffer.from(bytes).toString("utf-8");
    } catch {
      continue;
    }
    const fileSection = `// File: ${relPath}
${content}
`;
    const tokenCount = model ? await safeCountTokens(model, fileSection) : Math.ceil(fileSection.length / 4);
    if (usedTokens + tokenCount > tokenBudget) {
      log.info(`Token budget reached. Skipping ${relPath} and remaining files.`);
      break;
    }
    sections.push(fileSection);
    usedTokens += tokenCount;
  }
  return sections.join("\n---\n");
}
async function collectCandidateFiles(config, workspaceRoot) {
  const candidates = [];
  async function walk(dirUri, relBase) {
    let entries;
    try {
      entries = await vscode5.workspace.fs.readDirectory(dirUri);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      const relPath = relBase ? `${relBase}/${name}` : name;
      if (matchesAnyPattern(relPath, config.ignore) || matchesAnyPattern(name, config.ignore)) {
        continue;
      }
      if (type === vscode5.FileType.Directory) {
        await walk(vscode5.Uri.joinPath(dirUri, name), relPath);
      } else if (type === vscode5.FileType.File) {
        if (matchesAnyPattern(relPath, config.architectureWatchPatterns)) {
          candidates.push(relPath);
        }
      }
    }
  }
  await walk(workspaceRoot, "");
  return candidates.sort();
}
function prioritizeFiles(candidates, config) {
  if (config.filePriority.length > 0) {
    return [...candidates].sort((a, b) => {
      const scoreA = getPriorityScore(a, config.filePriority);
      const scoreB = getPriorityScore(b, config.filePriority);
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      return a.localeCompare(b);
    });
  }
  const contextSet = new Set(config.contextFiles);
  return [...candidates].sort((a, b) => {
    const aScore = heuristicScore(a, contextSet);
    const bScore = heuristicScore(b, contextSet);
    if (aScore !== bScore) {
      return aScore - bScore;
    }
    return a.localeCompare(b);
  });
}
function getPriorityScore(path, filePriority) {
  for (let i = 0; i < filePriority.length; i++) {
    if (matchesAnyPattern(path, [filePriority[i]])) {
      return i;
    }
  }
  return filePriority.length;
}
function heuristicScore(path, contextSet) {
  if (contextSet.has(path)) {
    return 0;
  }
  const parts = path.split("/");
  const inRoot = (parts[0] === "src" || parts[0] === "lib") && parts.length === 2;
  if (inRoot) {
    return 1;
  }
  if (parts[0] === "src" || parts[0] === "lib") {
    return 2;
  }
  return 3;
}
async function readPreviousArchitecture(config, workspaceRoot) {
  try {
    const archUri = vscode5.Uri.joinPath(workspaceRoot, config.outputPaths.architecture);
    const bytes = await vscode5.workspace.fs.readFile(archUri);
    const raw = Buffer.from(bytes).toString("utf-8");
    return stripMarkdownCodeBlock(raw);
  } catch {
    return "";
  }
}
function stripMarkdownCodeBlock(content) {
  const match = content.match(/^(?:#[^\n]*\n+)?```[^\n]*\n([\s\S]*?)```\s*$/m);
  return match ? match[1].trimEnd() : content;
}
async function readContextFiles(config, workspaceRoot) {
  if (config.contextFiles.length === 0) {
    return "";
  }
  const parts = [];
  for (const relPath of config.contextFiles) {
    try {
      const fileUri = vscode5.Uri.joinPath(workspaceRoot, relPath);
      const bytes = await vscode5.workspace.fs.readFile(fileUri);
      parts.push(`// Context file: ${relPath}
${Buffer.from(bytes).toString("utf-8")}`);
    } catch {
      log.warn(`Could not read context file: ${relPath}`);
    }
  }
  return parts.join("\n---\n");
}
function postProcessResponse(raw) {
  let cleaned = raw.replace(/^```[a-z]*\n?/gm, "").replace(/^```\n?/gm, "");
  const lines = cleaned.split("\n");
  const firstDiagramLine = lines.findIndex((line) => /^[+|]/.test(line.trim()) || /^[-+]{3,}/.test(line.trim()));
  let lastDiagramLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[+|]/.test(lines[i].trim()) || /^[-+]{3,}/.test(lines[i].trim())) {
      lastDiagramLine = i;
      break;
    }
  }
  if (firstDiagramLine !== -1 && lastDiagramLine !== -1 && firstDiagramLine <= lastDiagramLine) {
    cleaned = lines.slice(firstDiagramLine, lastDiagramLine + 1).join("\n");
  }
  return cleaned.trim() + "\n";
}
async function safeCountTokens(model, text) {
  try {
    const count = await model.countTokens(text);
    return count;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
var vscode5, INPUT_BUDGET_FRACTION, SYSTEM_PROMPT_TEMPLATE;
var init_architecture_agent = __esm({
  "src/architecture-agent.ts"() {
    "use strict";
    vscode5 = __toESM(require("vscode"));
    init_utils();
    init_logger();
    INPUT_BUDGET_FRACTION = 0.8;
    SYSTEM_PROMPT_TEMPLATE = `You are an ASCII architecture diagram generator for the software project "{workspace_folder_name}".

Your job is to produce a CONCEPTUAL data-flow diagram in pure ASCII art. The diagram must show:
- Major logical modules and their responsibilities
- Data flow between modules (arrows: ---> )
- State management cycles
- External API interactions
- Feedback loops

RULES:
1. Output ONLY the ASCII diagram. No markdown fences, no explanation text before or after.
2. Use box-drawing characters: +, -, |, > for arrows.
3. Keep column width under 100 characters.
4. Include a "Feedback loops:" text section at the bottom listing cyclic dependencies.
5. Do NOT include file paths or directory structure. This is a CONCEPTUAL diagram, not a physical one.
6. If a previous diagram is provided, preserve its general layout and only update sections that have changed based on the new source code. Do not gratuitously reorganize.

PREVIOUS DIAGRAM:
{previous_architecture}

PROJECT CONTEXT (if available):
{context_files_content}

SOURCE CODE CONTEXT:
{source_files_content}

Generate the updated architecture diagram now.`;
  }
});

// src/lm-client.ts
var lm_client_exports = {};
__export(lm_client_exports, {
  createLmClient: () => createLmClient
});
function createLmClient() {
  let cachedModel;
  let quotaCooldown = false;
  let cooldownTimer;
  let currentRequestCts;
  let modelChangeDisposable;
  async function selectModel() {
    try {
      const models = await vscode6.lm.selectChatModels({ vendor: "copilot" });
      if (models.length > 0) {
        cachedModel = models[0];
        log.info(`LM model selected: ${cachedModel.name} (vendor: ${cachedModel.vendor})`);
        return cachedModel;
      }
    } catch (err) {
      log.warn(`Model selection failed: ${String(err)}`);
    }
    cachedModel = void 0;
    return void 0;
  }
  let initialSelectionPromise = selectModel();
  modelChangeDisposable = vscode6.lm.onDidChangeChatModels(() => {
    log.info("LM models changed \u2014 re-selecting.");
    initialSelectionPromise = selectModel();
  });
  async function sendPrompt(messages, token) {
    if (quotaCooldown) {
      log.warn("LM quota cooldown active \u2014 skipping request.");
      throw new Error("ASCII Agent: LM quota cooldown active. Skipping request.");
    }
    const model = cachedModel ?? await selectModel();
    if (!model) {
      throw new Error("ASCII Agent: No Copilot LM model available.");
    }
    if (currentRequestCts) {
      currentRequestCts.cancel();
      currentRequestCts.dispose();
      currentRequestCts = void 0;
    }
    const cts = new vscode6.CancellationTokenSource();
    currentRequestCts = cts;
    let externalCancelDisposable;
    if (token) {
      externalCancelDisposable = token.onCancellationRequested(() => cts.cancel());
    }
    try {
      return await executeRequest(model, messages, cts.token);
    } finally {
      externalCancelDisposable?.dispose();
      if (currentRequestCts === cts) {
        currentRequestCts = void 0;
      }
      cts.dispose();
    }
  }
  async function executeRequest(model, messages, token) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await model.sendRequest(messages, {}, token);
        let fullText = "";
        for await (const chunk of response.text) {
          if (token.isCancellationRequested) {
            return fullText;
          }
          fullText += chunk;
        }
        return fullText;
      } catch (err) {
        if (err instanceof vscode6.LanguageModelError) {
          return await handleLanguageModelError(err, attempt);
        }
        if (attempt === 0) {
          log.warn(`LM request failed (attempt ${attempt + 1}): ${String(err)}. Retrying in ${RETRY_DELAY_MS}ms...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        log.warn(`LM request failed after retry: ${String(err)}`);
        throw err;
      }
    }
    throw new Error("ASCII Agent: Unexpected end of executeRequest loop.");
  }
  async function handleLanguageModelError(err, attempt) {
    const msg = err.message.toLowerCase();
    if (msg.includes("quota") || msg.includes("rate limit") || err.code === "quota-exceeded") {
      quotaCooldown = true;
      log.warn(`LM quota exceeded. Cooldown for ${QUOTA_COOLDOWN_MS / 1e3}s.`);
      cooldownTimer = setTimeout(() => {
        quotaCooldown = false;
        log.info("LM quota cooldown expired.");
      }, QUOTA_COOLDOWN_MS);
      throw err;
    }
    if (msg.includes("consent") || msg.includes("not authorized") || err.code === "no-permissions") {
      log.warn("Copilot consent not given. Prompting user.");
      vscode6.window.showInformationMessage(
        "ASCII Agent: Please authorize GitHub Copilot to enable architecture diagram generation."
      );
      throw err;
    }
    if (attempt === 0) {
      log.warn(`LM error (attempt ${attempt + 1}): ${String(err)}. Retrying in ${RETRY_DELAY_MS / 1e3}s...`);
      await sleep(RETRY_DELAY_MS);
      throw err;
    }
    log.error(`LM error after retry: ${String(err)}`);
    throw err;
  }
  function cancelAll() {
    if (currentRequestCts) {
      currentRequestCts.cancel();
      currentRequestCts.dispose();
      currentRequestCts = void 0;
    }
  }
  async function isAvailable() {
    if (cachedModel === void 0) {
      await initialSelectionPromise;
    }
    return cachedModel !== void 0 && !quotaCooldown;
  }
  function dispose() {
    cancelAll();
    modelChangeDisposable?.dispose();
    if (cooldownTimer !== void 0) {
      clearTimeout(cooldownTimer);
    }
  }
  return { sendPrompt, cancelAll, isAvailable, dispose };
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var vscode6, QUOTA_COOLDOWN_MS, RETRY_DELAY_MS;
var init_lm_client = __esm({
  "src/lm-client.ts"() {
    "use strict";
    vscode6 = __toESM(require("vscode"));
    init_logger();
    QUOTA_COOLDOWN_MS = 6e4;
    RETRY_DELAY_MS = 3e3;
  }
});

// src/history.ts
var history_exports = {};
__export(history_exports, {
  pruneSnapshots: () => pruneSnapshots,
  saveSnapshot: () => saveSnapshot
});
async function saveSnapshot(workspaceRoot, currentContent) {
  const historyDirUri = vscode7.Uri.joinPath(workspaceRoot, HISTORY_DIR);
  try {
    await vscode7.workspace.fs.createDirectory(historyDirUri);
  } catch {
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/:/g, "-");
  const fileName = `architecture_${timestamp}.txt`;
  const snapshotUri = vscode7.Uri.joinPath(historyDirUri, fileName);
  await vscode7.workspace.fs.writeFile(snapshotUri, Buffer.from(currentContent, "utf-8"));
}
async function pruneSnapshots(workspaceRoot, maxSnapshots) {
  const historyDirUri = vscode7.Uri.joinPath(workspaceRoot, HISTORY_DIR);
  let entries;
  try {
    entries = await vscode7.workspace.fs.readDirectory(historyDirUri);
  } catch {
    return;
  }
  const snapshotNames = entries.filter(([name, type]) => type === vscode7.FileType.File && name.endsWith(".txt")).map(([name]) => name);
  if (snapshotNames.length <= maxSnapshots) {
    return;
  }
  const withMtimes = [];
  for (const name of snapshotNames) {
    try {
      const stat = await vscode7.workspace.fs.stat(vscode7.Uri.joinPath(historyDirUri, name));
      withMtimes.push({ name, mtime: stat.mtime });
    } catch {
      withMtimes.push({ name, mtime: 0 });
    }
  }
  withMtimes.sort((a, b) => a.mtime - b.mtime);
  const targetCount = maxSnapshots - 1;
  const toDelete = withMtimes.slice(0, withMtimes.length - targetCount);
  for (const { name } of toDelete) {
    try {
      await vscode7.workspace.fs.delete(vscode7.Uri.joinPath(historyDirUri, name));
    } catch {
    }
  }
}
var vscode7, HISTORY_DIR;
var init_history = __esm({
  "src/history.ts"() {
    "use strict";
    vscode7 = __toESM(require("vscode"));
    HISTORY_DIR = ".ascii_history";
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode8 = __toESM(require("vscode"));
init_config();
init_logger();
var currentConfig;
var watcherState = "disabled" /* Disabled */;
var statusBarItem;
var watcherSessionDisposable;
function resolveWorkspaceRoot() {
  return vscode8.workspace.workspaceFolders?.[0]?.uri;
}
function warnNoWorkspace() {
  vscode8.window.showWarningMessage("ASCII Agent: No workspace folder is open.");
  log.warn("Command invoked with no open workspace folder.");
}
async function activate(context) {
  const channel = vscode8.window.createOutputChannel("ASCII Agent");
  context.subscriptions.push(channel);
  initLogger(channel);
  if (!vscode8.workspace.workspaceFolders || vscode8.workspace.workspaceFolders.length === 0) {
    log.warn("No workspace folder open \u2014 aborting activation.");
    return;
  }
  if (vscode8.workspace.workspaceFolders.length > 1) {
    log.warn("Multiple workspace folders detected. Only the first folder will be monitored.");
    vscode8.window.showWarningMessage("ASCII Agent only monitors the first workspace folder.");
  }
  const workspaceRoot = vscode8.workspace.workspaceFolders[0].uri;
  currentConfig = await loadConfig(workspaceRoot);
  log.info(`Config loaded. debounceMs=${currentConfig.debounceMs}, autoWatch=${currentConfig.autoWatchEnabled}`);
  const configWatcherDisposable = watchConfigFile(workspaceRoot, (newCfg) => {
    currentConfig = newCfg;
    log.info("Config reloaded from .asciirc.json.");
    if (watcherState === "active" /* Active */) {
      stopWatcher();
      startWatcher(context, workspaceRoot);
    }
  });
  context.subscriptions.push(configWatcherDisposable);
  statusBarItem = vscode8.window.createStatusBarItem(vscode8.StatusBarAlignment.Left, 100);
  statusBarItem.command = "asciiAgent.toggleAutoWatch";
  updateStatusBar("disabled" /* Disabled */);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    vscode8.commands.registerCommand("asciiAgent.initialize", () => {
      const root = resolveWorkspaceRoot();
      return root ? commandInitialize(root) : warnNoWorkspace();
    }),
    vscode8.commands.registerCommand("asciiAgent.generateNow", () => {
      const root = resolveWorkspaceRoot();
      return root ? commandGenerateNow(root) : warnNoWorkspace();
    }),
    vscode8.commands.registerCommand("asciiAgent.toggleAutoWatch", () => {
      const root = resolveWorkspaceRoot();
      return root ? commandToggleAutoWatch(context, root) : warnNoWorkspace();
    })
  );
  if (currentConfig.autoWatchEnabled) {
    startWatcher(context, workspaceRoot);
  }
  const msg = vscode8.window.setStatusBarMessage("ASCII Agent: active", 3e3);
  context.subscriptions.push(msg);
  log.info("Activated successfully.");
}
function deactivate() {
  stopWatcher();
  log.info("Deactivated.");
}
async function commandInitialize(workspaceRoot) {
  log.info("Running: asciiAgent.initialize");
  const { generateFileTree: generateFileTree2 } = await Promise.resolve().then(() => (init_tree_generator(), tree_generator_exports));
  const { ensureDirectoryExists: ensureDirectoryExists2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
  const outputDir = currentConfig.outputPaths.fileTree.split("/").slice(0, -1).join("/");
  await ensureDirectoryExists2(vscode8.Uri.joinPath(workspaceRoot, outputDir || "docs"));
  await maybeCreateDefaultAsciirc(workspaceRoot);
  currentConfig = await loadConfig(workspaceRoot);
  const existingFiles = await detectExistingOutputFiles(workspaceRoot, currentConfig);
  if (existingFiles.length > 0) {
    const fileList = existingFiles.map((f) => `\u2022 ${f}`).join("\n");
    const choice = await vscode8.window.showWarningMessage(
      `ASCII Agent: The following files already exist:

${fileList}

Overwrite them?`,
      { modal: true },
      "Overwrite"
    );
    if (choice !== "Overwrite") {
      log.info("Initialize cancelled by user \u2014 existing files would be overwritten.");
      return;
    }
  }
  await safeGenerateAndWriteFileTree(workspaceRoot, generateFileTree2);
  const archGenerated = await safeGenerateArchitecture(workspaceRoot);
  if (!archGenerated) {
    vscode8.window.showWarningMessage(
      'ASCII Agent: File tree created. Architecture diagram skipped \u2014 Copilot not available yet. Run "ASCII Agent: Generate Now" once Copilot is ready.'
    );
  }
  await promptGitignoreUpdate(workspaceRoot);
  vscode8.window.showInformationMessage("ASCII Agent: Initialization complete.");
  log.info("Initialization complete.");
}
async function commandGenerateNow(workspaceRoot) {
  log.info("Running: asciiAgent.generateNow");
  await vscode8.window.withProgress(
    {
      location: vscode8.ProgressLocation.Notification,
      title: "ASCII Agent",
      cancellable: true
    },
    async (progress, token) => {
      Promise.resolve().then(() => (init_watcher(), watcher_exports)).then(({ cancelPendingTimers: cancelPendingTimers2 }) => cancelPendingTimers2()).catch(() => void 0);
      progress.report({ message: "Generating file tree..." });
      setStatusBarGenerating(true);
      try {
        const { generateFileTree: generateFileTree2 } = await Promise.resolve().then(() => (init_tree_generator(), tree_generator_exports));
        const { ensureDirectoryExists: ensureDirectoryExists2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
        if (token.isCancellationRequested) {
          return;
        }
        const outputDir = currentConfig.outputPaths.fileTree.split("/").slice(0, -1).join("/");
        await ensureDirectoryExists2(vscode8.Uri.joinPath(workspaceRoot, outputDir || "docs"));
        const treeStart = Date.now();
        const treeContent = await generateFileTree2(workspaceRoot, currentConfig);
        await writeOutputFile(workspaceRoot, currentConfig.outputPaths.fileTree, treeContent);
        log.info(`File tree generated in ${Date.now() - treeStart}ms.`);
        if (token.isCancellationRequested) {
          return;
        }
        progress.report({ message: "Generating architecture diagram (AI)..." });
        const { generateArchitectureDiagram: generateArchitectureDiagram2 } = await Promise.resolve().then(() => (init_architecture_agent(), architecture_agent_exports));
        const { createLmClient: createLmClient2 } = await Promise.resolve().then(() => (init_lm_client(), lm_client_exports));
        const lmClient = createLmClient2();
        try {
          if (!await lmClient.isAvailable()) {
            vscode8.window.showWarningMessage(
              "ASCII Agent: Copilot model not available \u2014 only file tree was regenerated."
            );
            log.warn("LM unavailable \u2014 skipping architecture generation.");
            return;
          }
          const archStart = Date.now();
          const archContent = await generateArchitectureDiagram2(currentConfig, workspaceRoot, lmClient, token);
          if (token.isCancellationRequested) {
            return;
          }
          const { saveSnapshot: saveSnapshot2 } = await Promise.resolve().then(() => (init_history(), history_exports));
          await saveSnapshot2(workspaceRoot, archContent);
          await pruneHistory(workspaceRoot);
          await writeOutputFile(workspaceRoot, currentConfig.outputPaths.architecture, archContent);
          log.info(`Architecture diagram generated in ${Date.now() - archStart}ms.`);
          vscode8.window.showInformationMessage("ASCII Agent: Diagrams updated.");
        } finally {
          lmClient.dispose();
        }
      } finally {
        setStatusBarGenerating(false);
      }
    }
  );
}
function commandToggleAutoWatch(context, workspaceRoot) {
  if (watcherState === "active" /* Active */) {
    stopWatcher();
    vscode8.window.showInformationMessage("ASCII Agent: Auto-watch is now OFF.");
    log.info("Auto-watch paused by user.");
  } else {
    startWatcher(context, workspaceRoot);
    vscode8.window.showInformationMessage("ASCII Agent: Auto-watch is now ON.");
    log.info("Auto-watch started by user.");
  }
}
function startWatcher(context, workspaceRoot) {
  Promise.resolve().then(() => (init_watcher(), watcher_exports)).then(({ startWatching: startWatching2 }) => {
    watcherSessionDisposable = startWatching2(currentConfig, context, {
      onTreeRegenNeeded: async () => {
        const { generateFileTree: generateFileTree2 } = await Promise.resolve().then(() => (init_tree_generator(), tree_generator_exports));
        await safeGenerateAndWriteFileTree(workspaceRoot, generateFileTree2);
      },
      onArchitectureRegenNeeded: async () => {
        await safeGenerateArchitecture(workspaceRoot);
      }
    });
    context.subscriptions.push(watcherSessionDisposable);
    watcherState = "active" /* Active */;
    updateStatusBar("active" /* Active */);
  });
}
function stopWatcher() {
  watcherSessionDisposable?.dispose();
  watcherSessionDisposable = void 0;
  watcherState = "paused" /* Paused */;
  updateStatusBar("paused" /* Paused */);
}
function updateStatusBar(state) {
  if (!statusBarItem) {
    return;
  }
  switch (state) {
    case "active" /* Active */:
      statusBarItem.text = "$(eye) ASCII Agent";
      statusBarItem.tooltip = "ASCII Agent: auto-watch active. Click to pause.";
      break;
    case "paused" /* Paused */:
      statusBarItem.text = "$(eye-closed) ASCII Agent (paused)";
      statusBarItem.tooltip = "ASCII Agent: auto-watch paused. Click to resume.";
      break;
    case "disabled" /* Disabled */:
      statusBarItem.text = "$(eye) ASCII Agent";
      statusBarItem.tooltip = "ASCII Agent: inactive.";
      break;
  }
}
function setStatusBarGenerating(generating) {
  if (!statusBarItem) {
    return;
  }
  if (generating) {
    statusBarItem.text = "$(sync~spin) ASCII Agent: generating...";
  } else {
    updateStatusBar(watcherState);
  }
}
async function writeOutputFile(workspaceRoot, relPath, content) {
  const { ensureDirectoryExists: ensureDirectoryExists2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
  const fileUri = vscode8.Uri.joinPath(workspaceRoot, relPath);
  const parentRel = relPath.split("/").slice(0, -1).join("/");
  if (parentRel) {
    await ensureDirectoryExists2(vscode8.Uri.joinPath(workspaceRoot, parentRel));
  }
  await vscode8.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf-8"));
}
async function safeGenerateAndWriteFileTree(workspaceRoot, generateFileTree2) {
  try {
    const content = await generateFileTree2(workspaceRoot, currentConfig);
    await writeOutputFile(workspaceRoot, currentConfig.outputPaths.fileTree, content);
    log.info("File tree written successfully.");
  } catch (err) {
    log.error(`Failed to generate file tree: ${String(err)}`);
  }
}
async function safeGenerateArchitecture(workspaceRoot) {
  try {
    const { generateArchitectureDiagram: generateArchitectureDiagram2 } = await Promise.resolve().then(() => (init_architecture_agent(), architecture_agent_exports));
    const { createLmClient: createLmClient2 } = await Promise.resolve().then(() => (init_lm_client(), lm_client_exports));
    const { saveSnapshot: saveSnapshot2 } = await Promise.resolve().then(() => (init_history(), history_exports));
    const lmClient = createLmClient2();
    try {
      if (!await lmClient.isAvailable()) {
        log.info("LM unavailable \u2014 skipping architecture generation.");
        return false;
      }
      const archContent = await generateArchitectureDiagram2(currentConfig, workspaceRoot, lmClient);
      await saveSnapshot2(workspaceRoot, archContent);
      await pruneHistory(workspaceRoot);
      await writeOutputFile(workspaceRoot, currentConfig.outputPaths.architecture, archContent);
      log.info("Architecture diagram written successfully.");
      return true;
    } finally {
      lmClient.dispose();
    }
  } catch (err) {
    log.error(`Failed to generate architecture diagram: ${String(err)}`);
    return false;
  }
}
async function pruneHistory(workspaceRoot) {
  try {
    const { pruneSnapshots: pruneSnapshots2 } = await Promise.resolve().then(() => (init_history(), history_exports));
    await pruneSnapshots2(workspaceRoot, currentConfig.maxHistorySnapshots);
  } catch (err) {
    log.warn(`Snapshot pruning failed: ${String(err)}`);
  }
}
async function detectExistingOutputFiles(workspaceRoot, config) {
  const candidates = [config.outputPaths.fileTree, config.outputPaths.architecture];
  const existing = [];
  for (const relPath of candidates) {
    try {
      await vscode8.workspace.fs.stat(vscode8.Uri.joinPath(workspaceRoot, relPath));
      existing.push(relPath);
    } catch {
    }
  }
  return existing;
}
async function maybeCreateDefaultAsciirc(workspaceRoot) {
  const configUri = vscode8.Uri.joinPath(workspaceRoot, ".asciirc.json");
  try {
    await vscode8.workspace.fs.stat(configUri);
  } catch {
    const { getDefaultConfig: getDefaultConfig2 } = await Promise.resolve().then(() => (init_config(), config_exports));
    const defaults = getDefaultConfig2();
    const content = JSON.stringify(defaults, null, 2);
    await vscode8.workspace.fs.writeFile(configUri, Buffer.from(content, "utf-8"));
    log.info("Created default .asciirc.json.");
  }
}
async function promptGitignoreUpdate(workspaceRoot) {
  const gitignoreUri = vscode8.Uri.joinPath(workspaceRoot, ".gitignore");
  let content;
  try {
    const bytes = await vscode8.workspace.fs.readFile(gitignoreUri);
    content = Buffer.from(bytes).toString("utf-8");
  } catch {
    return;
  }
  if (content.includes(".ascii_history")) {
    return;
  }
  const choice = await vscode8.window.showInformationMessage(
    "ASCII Agent: Add .ascii_history/ to .gitignore?",
    "Yes",
    "No"
  );
  if (choice === "Yes") {
    const appended = content.trimEnd() + "\n\n# ASCII Agent history snapshots\n.ascii_history/\n";
    await vscode8.workspace.fs.writeFile(gitignoreUri, Buffer.from(appended, "utf-8"));
    log.info("Added .ascii_history/ to .gitignore.");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
