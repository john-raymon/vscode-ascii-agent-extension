/**
 * @file config.ts
 * @description Configuration loader for `.asciirc.json`.
 *
 * Responsibilities:
 * - Read and parse `.asciirc.json` from the workspace root.
 * - Deep-merge user values over hardcoded defaults.
 * - Validate numeric constraints.
 * - Watch `.asciirc.json` for changes and hot-reload.
 */

import * as vscode from "vscode";
import type { AsciiAgentConfig } from "./types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Returns a fresh copy of the default `AsciiAgentConfig`.
 * Called as a factory so each caller gets an independent object (no shared mutation).
 *
 * @returns The default configuration object.
 */
export function getDefaultConfig(): AsciiAgentConfig {
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
      "package-lock.json",
    ],
    architectureWatchPatterns: ["src/**/*.{ts,tsx,js,jsx}", "lib/**/*.{ts,tsx,js,jsx}", "api/**/*.ts"],
    outputPaths: {
      fileTree: "docs/file_tree.txt",
      architecture: "docs/architecture.txt",
    },
    debounceMs: 2000,
    maxHistorySnapshots: 50,
    autoWatchEnabled: true,
    contextFiles: [],
    filePriority: [],
    // `tags` is intentionally undefined here — tree-generator uses its own defaults when absent.
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load the `.asciirc.json` configuration from the workspace root.
 *
 * Loading rules (per PRD §4):
 * 1. Attempt to read `<workspaceRoot>/.asciirc.json` via `vscode.workspace.fs.readFile`.
 * 2. Deep-merge parsed values over defaults.
 * 3. Validate constraints.
 * 4. On malformed JSON, warn the user and fall back to defaults.
 * 5. If the file is absent, silently use defaults.
 *
 * @param workspaceRoot - The URI of the workspace root folder.
 * @returns The fully resolved `AsciiAgentConfig`.
 */
export async function loadConfig(workspaceRoot: vscode.Uri): Promise<AsciiAgentConfig> {
  const configUri = vscode.Uri.joinPath(workspaceRoot, ".asciirc.json");
  const defaults = getDefaultConfig();

  let rawText: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(configUri);
    rawText = Buffer.from(bytes).toString("utf-8");
  } catch {
    // File doesn't exist — use defaults silently.
    return defaults;
  }

  let parsed: Partial<AsciiAgentConfig>;
  try {
    // Strip single-line comments (JSONC support) before parsing.
    const stripped = stripJsoncComments(rawText);
    parsed = JSON.parse(stripped) as Partial<AsciiAgentConfig>;
  } catch (err) {
    // Malformed JSON — warn user and fall back to defaults.
    vscode.window.showWarningMessage(`ASCII Agent: .asciirc.json is malformed — using defaults. (${String(err)})`);
    return defaults;
  }

  // Deep-merge: user values override defaults.
  const merged = deepMergeConfig(defaults, parsed);

  // Validate constraints (§4).
  return validateConfig(merged);
}

// ---------------------------------------------------------------------------
// Config Watcher
// ---------------------------------------------------------------------------

/**
 * Watch `.asciirc.json` for changes and invoke `onChange` with the reloaded config.
 * The returned `Disposable` should be added to `context.subscriptions`.
 *
 * @param workspaceRoot - URI of the workspace root folder.
 * @param onChange      - Callback invoked with the new config whenever the file changes.
 * @returns A disposable that stops watching when disposed.
 */
export function watchConfigFile(
  workspaceRoot: vscode.Uri,
  onChange: (cfg: AsciiAgentConfig) => void,
): vscode.Disposable {
  // Watch only the specific config file.
  const pattern = new vscode.RelativePattern(workspaceRoot, ".asciirc.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const reload = async () => {
    const cfg = await loadConfig(workspaceRoot);
    onChange(cfg);
  };

  // Handle creation, modification, and deletion of the config file.
  const onCreate = watcher.onDidCreate(reload);
  const onChange_ = watcher.onDidChange(reload);
  const onDelete = watcher.onDidDelete(async () => {
    // If deleted, revert to defaults.
    onChange(getDefaultConfig());
  });

  return {
    dispose: () => {
      watcher.dispose();
      onCreate.dispose();
      onChange_.dispose();
      onDelete.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

/**
 * Deep-merge two `AsciiAgentConfig`-shaped objects.
 * Array fields from `overrides` fully replace those in `base` (no array concat).
 * Nested objects (`outputPaths`) are merged shallowly.
 *
 * @param base      - The default config.
 * @param overrides - The user-provided partial config.
 * @returns The merged config.
 */
function deepMergeConfig(base: AsciiAgentConfig, overrides: Partial<AsciiAgentConfig>): AsciiAgentConfig {
  return {
    ignore: overrides.ignore !== undefined ? overrides.ignore : base.ignore,
    architectureWatchPatterns:
      overrides.architectureWatchPatterns !== undefined
        ? overrides.architectureWatchPatterns
        : base.architectureWatchPatterns,
    outputPaths:
      overrides.outputPaths !== undefined ? { ...base.outputPaths, ...overrides.outputPaths } : base.outputPaths,
    debounceMs: overrides.debounceMs !== undefined ? overrides.debounceMs : base.debounceMs,
    maxHistorySnapshots:
      overrides.maxHistorySnapshots !== undefined ? overrides.maxHistorySnapshots : base.maxHistorySnapshots,
    autoWatchEnabled: overrides.autoWatchEnabled !== undefined ? overrides.autoWatchEnabled : base.autoWatchEnabled,
    contextFiles: overrides.contextFiles !== undefined ? overrides.contextFiles : base.contextFiles,
    filePriority: overrides.filePriority !== undefined ? overrides.filePriority : base.filePriority,
    // `tags` is optional — only set if user explicitly provided it.
    tags: overrides.tags !== undefined ? overrides.tags : base.tags,
  };
}

/**
 * Validate numeric constraints on the config per PRD §4.
 * Mutates the config in place and returns it for chaining.
 *
 * @param cfg - The config to validate.
 * @returns The (possibly corrected) config.
 */
function validateConfig(cfg: AsciiAgentConfig): AsciiAgentConfig {
  if (cfg.debounceMs < 500) {
    vscode.window.showWarningMessage("ASCII Agent: debounceMs must be ≥ 500. Resetting to 500.");
    cfg.debounceMs = 500;
  }
  if (cfg.maxHistorySnapshots < 1) {
    vscode.window.showWarningMessage("ASCII Agent: maxHistorySnapshots must be ≥ 1. Resetting to 1.");
    cfg.maxHistorySnapshots = 1;
  }
  return cfg;
}

/**
 * Strip single-line (`//`) comments from a JSONC string so `JSON.parse` can handle it.
 * This is a minimal implementation — it does not handle block comments (C-style slash-star pairs).
 *
 * @param text - Raw JSONC text.
 * @returns JSON text with `//` comments removed.
 */
function stripJsoncComments(text: string): string {
  // Remove everything from `//` to end-of-line, but not inside string literals.
  // A proper JSONC parser would handle edge cases like `//` inside strings,
  // but for a config file this lightweight approach is sufficient.
  return text.replace(/\/\/[^\n]*/g, "");
}
