/**
 * @file extension.ts
 * @description VS Code extension entry point for ASCII Agent.
 *
 * Responsibilities:
 * - `activate()`: Load config, register commands, start watcher (if enabled), show status bar.
 * - `deactivate()`: Dispose watchers, cancel in-flight LM requests.
 *
 * NOTE: This file is intentionally project-agnostic. Zero hardcoded paths or project names.
 * All workspace resolution is done via `vscode.workspace.workspaceFolders[0].uri`.
 */

import * as vscode from "vscode";
import { loadConfig, watchConfigFile } from "./config";
import { initLogger, log } from "./logger";
import type { AsciiAgentConfig } from "./types";
import { WatcherState } from "./types";

// ---------------------------------------------------------------------------
// Extension-level mutable state
// ---------------------------------------------------------------------------

/** The currently active config (hot-reloadable). */
let currentConfig: AsciiAgentConfig;

/** Current watcher state, toggleable via command. */
let watcherState: WatcherState = WatcherState.Disabled;

/** Status bar item showing watcher state. */
let statusBarItem: vscode.StatusBarItem;

/** Disposable for the currently running watcher session (set in Phase 6). */
let watcherSessionDisposable: vscode.Disposable | undefined;

// ---------------------------------------------------------------------------
// Workspace root helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the active workspace root at call time.
 *
 * Always read `workspaceFolders` fresh rather than relying on a closure captured
 * at activation, so commands target the correct folder regardless of which window
 * is focused or whether the workspace changed after the extension activated.
 *
 * Exported for unit testing.
 *
 * @returns The URI of the first workspace folder, or `undefined` if none is open.
 */
export function resolveWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Show a warning when a command is invoked with no open workspace folder.
 */
function warnNoWorkspace(): void {
  vscode.window.showWarningMessage("ASCII Agent: No workspace folder is open.");
  log.warn("Command invoked with no open workspace folder.");
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

/**
 * Extension activation entry point.
 * Called by VS Code when any `activationEvent` is triggered.
 *
 * @param context - The extension context provided by VS Code.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Create the output channel FIRST so all subsequent code can log (PRD §17).
  const channel = vscode.window.createOutputChannel("ASCII Agent");
  context.subscriptions.push(channel);
  initLogger(channel);

  // --- Guard: require at least one workspace folder (PRD §7.2) ---
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    log.warn("No workspace folder open — aborting activation.");
    return;
  }

  // Warn about multi-root workspaces — only first root is monitored (PRD §7.3).
  if (vscode.workspace.workspaceFolders.length > 1) {
    log.warn("Multiple workspace folders detected. Only the first folder will be monitored.");
    vscode.window.showWarningMessage("ASCII Agent only monitors the first workspace folder.");
  }

  const workspaceRoot = vscode.workspace.workspaceFolders[0].uri;

  // --- Load initial config ---
  currentConfig = await loadConfig(workspaceRoot);
  log.info(`Config loaded. debounceMs=${currentConfig.debounceMs}, autoWatch=${currentConfig.autoWatchEnabled}`);

  // --- Hot-reload config on .asciirc.json changes ---
  const configWatcherDisposable = watchConfigFile(workspaceRoot, (newCfg) => {
    currentConfig = newCfg;
    log.info("Config reloaded from .asciirc.json.");
    // If the watcher is running, restart it with the new config.
    if (watcherState === WatcherState.Active) {
      stopWatcher();
      startWatcher(context, workspaceRoot);
    }
  });
  context.subscriptions.push(configWatcherDisposable);

  // --- Status bar ---
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "asciiAgent.toggleAutoWatch";
  updateStatusBar(WatcherState.Disabled);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // --- Register commands ---
  // Commands resolve the active workspace root at invocation time (not from the
  // activation-time closure) so they always target the correct folder even when
  // multiple windows are open or the workspace changes after activation.
  context.subscriptions.push(
    vscode.commands.registerCommand("asciiAgent.initialize", () => {
      const root = resolveWorkspaceRoot();
      return root ? commandInitialize(root) : warnNoWorkspace();
    }),
    vscode.commands.registerCommand("asciiAgent.generateNow", () => {
      const root = resolveWorkspaceRoot();
      return root ? commandGenerateNow(root) : warnNoWorkspace();
    }),
    vscode.commands.registerCommand("asciiAgent.toggleAutoWatch", () => {
      const root = resolveWorkspaceRoot();
      return root ? commandToggleAutoWatch(context, root) : warnNoWorkspace();
    }),
  );

  // --- Auto-start watcher if configured ---
  if (currentConfig.autoWatchEnabled) {
    startWatcher(context, workspaceRoot); // Use activation-time root for the watcher — correct for this window.
  }

  // --- Activation success message (fades after 3 seconds) ---
  const msg = vscode.window.setStatusBarMessage("ASCII Agent: active", 3000);
  context.subscriptions.push(msg);

  log.info("Activated successfully.");
}

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

/**
 * Extension deactivation entry point.
 * Called by VS Code when the extension is deactivated or VS Code is closed.
 * Dispose all watchers and cancel in-flight LM requests.
 */
export function deactivate(): void {
  stopWatcher();
  log.info("Deactivated.");
}

// ---------------------------------------------------------------------------
// Command: Initialize
// ---------------------------------------------------------------------------

/**
 * Command handler for `asciiAgent.initialize`.
 *
 * Creates the `docs/` directory if missing, writes a default `.asciirc.json` if missing,
 * runs both generators once immediately, and prompts about `.gitignore`.
 *
 * @param workspaceRoot - The URI of the workspace root folder.
 */
async function commandInitialize(workspaceRoot: vscode.Uri): Promise<void> {
  log.info("Running: asciiAgent.initialize");

  const { generateFileTree } = await import("./tree-generator");
  const { ensureDirectoryExists } = await import("./utils");

  // 1. Ensure the configured output directory exists (PRD §7.4).
  const outputDir = currentConfig.outputPaths.fileTree.split("/").slice(0, -1).join("/");
  await ensureDirectoryExists(vscode.Uri.joinPath(workspaceRoot, outputDir || "docs"));

  // 2. Create default .asciirc.json if absent.
  await maybeCreateDefaultAsciirc(workspaceRoot);

  // Reload config after potential creation.
  currentConfig = await loadConfig(workspaceRoot);

  // 3. Check for existing output files and confirm overwrite if any exist.
  const existingFiles = await detectExistingOutputFiles(workspaceRoot, currentConfig);
  if (existingFiles.length > 0) {
    const fileList = existingFiles.map((f) => `• ${f}`).join("\n");
    const choice = await vscode.window.showWarningMessage(
      `ASCII Agent: The following files already exist:\n\n${fileList}\n\nOverwrite them?`,
      { modal: true },
      "Overwrite",
    );
    if (choice !== "Overwrite") {
      log.info("Initialize cancelled by user — existing files would be overwritten.");
      return;
    }
  }

  // 4. Generate and write file tree.
  await safeGenerateAndWriteFileTree(workspaceRoot, generateFileTree);

  // 5. Generate and write architecture diagram.
  const archGenerated = await safeGenerateArchitecture(workspaceRoot);
  if (!archGenerated) {
    vscode.window.showWarningMessage(
      'ASCII Agent: File tree created. Architecture diagram skipped — Copilot not available yet. Run "ASCII Agent: Generate Now" once Copilot is ready.',
    );
  }

  // 6. Prompt about .gitignore (PRD §7.7).
  await promptGitignoreUpdate(workspaceRoot);

  vscode.window.showInformationMessage("ASCII Agent: Initialization complete.");
  log.info("Initialization complete.");
}

// ---------------------------------------------------------------------------
// Command: Generate Now
// ---------------------------------------------------------------------------

/**
 * Command handler for `asciiAgent.generateNow`.
 *
 * Manually triggers both generators with a cancellable progress notification.
 *
 * @param workspaceRoot - The URI of the workspace root folder.
 */
async function commandGenerateNow(workspaceRoot: vscode.Uri): Promise<void> {
  log.info("Running: asciiAgent.generateNow");

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "ASCII Agent",
      cancellable: true,
    },
    async (progress, token) => {
      // Cancel any pending debounced ops before starting (PRD §7.5).
      import("./watcher").then(({ cancelPendingTimers }) => cancelPendingTimers()).catch(() => undefined); // Safe no-op if watcher not yet loaded.

      progress.report({ message: "Generating file tree..." });
      setStatusBarGenerating(true);

      try {
        const { generateFileTree } = await import("./tree-generator");
        const { ensureDirectoryExists } = await import("./utils");

        if (token.isCancellationRequested) {
          return;
        }

        // Ensure output directory exists (PRD §7.4).
        const outputDir = currentConfig.outputPaths.fileTree.split("/").slice(0, -1).join("/");
        await ensureDirectoryExists(vscode.Uri.joinPath(workspaceRoot, outputDir || "docs"));

        // --- File tree generation ---
        const treeStart = Date.now();
        const treeContent = await generateFileTree(workspaceRoot, currentConfig);
        await writeOutputFile(workspaceRoot, currentConfig.outputPaths.fileTree, treeContent);
        log.info(`File tree generated in ${Date.now() - treeStart}ms.`);

        if (token.isCancellationRequested) {
          return;
        }

        progress.report({ message: "Generating architecture diagram (AI)..." });

        // --- Architecture diagram generation ---
        const { generateArchitectureDiagram } = await import("./architecture-agent");
        const { createLmClient } = await import("./lm-client");
        const lmClient = createLmClient();

        try {
          if (!(await lmClient.isAvailable())) {
            vscode.window.showWarningMessage(
              "ASCII Agent: Copilot model not available — only file tree was regenerated.",
            );
            log.warn("LM unavailable — skipping architecture generation.");
            return;
          }

          const archStart = Date.now();
          const archContent = await generateArchitectureDiagram(currentConfig, workspaceRoot, lmClient, token);

          if (token.isCancellationRequested) {
            return;
          }

          // Snapshot before overwriting (PRD §5.7).
          const { saveSnapshot } = await import("./history");
          await saveSnapshot(workspaceRoot, archContent);
          await pruneHistory(workspaceRoot);

          await writeOutputFile(workspaceRoot, currentConfig.outputPaths.architecture, archContent);
          log.info(`Architecture diagram generated in ${Date.now() - archStart}ms.`);
          vscode.window.showInformationMessage("ASCII Agent: Diagrams updated.");
        } finally {
          lmClient.dispose();
        }
      } finally {
        setStatusBarGenerating(false);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Command: Toggle Auto-Watch
// ---------------------------------------------------------------------------

/**
 * Command handler for `asciiAgent.toggleAutoWatch`.
 *
 * Toggles the watcher between active and paused.
 * The toggle does NOT persist to `.asciirc.json` — it resets on VS Code reload.
 *
 * @param context       - Extension context, needed to re-register the watcher.
 * @param workspaceRoot - URI of the workspace root.
 */
function commandToggleAutoWatch(context: vscode.ExtensionContext, workspaceRoot: vscode.Uri): void {
  if (watcherState === WatcherState.Active) {
    stopWatcher();
    vscode.window.showInformationMessage("ASCII Agent: Auto-watch is now OFF.");
    log.info("Auto-watch paused by user.");
  } else {
    startWatcher(context, workspaceRoot);
    vscode.window.showInformationMessage("ASCII Agent: Auto-watch is now ON.");
    log.info("Auto-watch started by user.");
  }
}

// ---------------------------------------------------------------------------
// Watcher lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Start the file-system watcher and register its disposable.
 * Sets `watcherState` to `Active`.
 *
 * @param context       - Extension context for disposable registration.
 * @param workspaceRoot - URI of the workspace root.
 */
function startWatcher(context: vscode.ExtensionContext, workspaceRoot: vscode.Uri): void {
  import("./watcher").then(({ startWatching }) => {
    watcherSessionDisposable = startWatching(currentConfig, context, {
      onTreeRegenNeeded: async () => {
        const { generateFileTree } = await import("./tree-generator");
        await safeGenerateAndWriteFileTree(workspaceRoot, generateFileTree);
      },
      onArchitectureRegenNeeded: async () => {
        await safeGenerateArchitecture(workspaceRoot);
      },
    });
    context.subscriptions.push(watcherSessionDisposable);
    watcherState = WatcherState.Active;
    updateStatusBar(WatcherState.Active);
  });
}

/**
 * Stop the currently active watcher session and update state.
 */
function stopWatcher(): void {
  watcherSessionDisposable?.dispose();
  watcherSessionDisposable = undefined;
  watcherState = WatcherState.Paused;
  updateStatusBar(WatcherState.Paused);
}

// ---------------------------------------------------------------------------
// Status bar helpers
// ---------------------------------------------------------------------------

/**
 * Update the status bar item to reflect the current watcher state.
 *
 * @param state - The new watcher state.
 */
function updateStatusBar(state: WatcherState): void {
  if (!statusBarItem) {
    return;
  }
  switch (state) {
    case WatcherState.Active:
      statusBarItem.text = "$(eye) ASCII Agent";
      statusBarItem.tooltip = "ASCII Agent: auto-watch active. Click to pause.";
      break;
    case WatcherState.Paused:
      statusBarItem.text = "$(eye-closed) ASCII Agent (paused)";
      statusBarItem.tooltip = "ASCII Agent: auto-watch paused. Click to resume.";
      break;
    case WatcherState.Disabled:
      statusBarItem.text = "$(eye) ASCII Agent";
      statusBarItem.tooltip = "ASCII Agent: inactive.";
      break;
  }
}

/**
 * Update status bar to show "generating..." spinner during diagram generation.
 *
 * @param generating - Whether generation is in progress.
 */
function setStatusBarGenerating(generating: boolean): void {
  if (!statusBarItem) {
    return;
  }
  if (generating) {
    statusBarItem.text = "$(sync~spin) ASCII Agent: generating...";
  } else {
    updateStatusBar(watcherState);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Write content to an output file, creating parent directories as needed.
 *
 * @param workspaceRoot  - URI of the workspace root.
 * @param relPath        - Path relative to workspace root (e.g. "docs/file_tree.txt").
 * @param content        - String content to write.
 */
async function writeOutputFile(workspaceRoot: vscode.Uri, relPath: string, content: string): Promise<void> {
  const { ensureDirectoryExists } = await import("./utils");
  const fileUri = vscode.Uri.joinPath(workspaceRoot, relPath);
  const parentRel = relPath.split("/").slice(0, -1).join("/");
  if (parentRel) {
    await ensureDirectoryExists(vscode.Uri.joinPath(workspaceRoot, parentRel));
  }
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf-8"));
}

/**
 * Safely generate and write the file tree, logging errors without rethrowing.
 *
 * @param workspaceRoot    - URI of workspace root.
 * @param generateFileTree - The tree-generator function.
 */
async function safeGenerateAndWriteFileTree(
  workspaceRoot: vscode.Uri,
  generateFileTree: (root: vscode.Uri, cfg: AsciiAgentConfig) => Promise<string>,
): Promise<void> {
  try {
    const content = await generateFileTree(workspaceRoot, currentConfig);
    await writeOutputFile(workspaceRoot, currentConfig.outputPaths.fileTree, content);
    log.info("File tree written successfully.");
  } catch (err) {
    log.error(`Failed to generate file tree: ${String(err)}`);
  }
}

/**
 * Safely generate and write the architecture diagram.
 * Silently skips if the LM is unavailable.
 *
 * @param workspaceRoot - URI of workspace root.
 */
/**
 * Safely generate and write the architecture diagram.
 * Returns `true` if the diagram was generated and written, `false` if the LM
 * was unavailable or generation failed. Callers can use the return value to
 * decide whether to surface a follow-up prompt to the user.
 *
 * @param workspaceRoot - URI of workspace root.
 * @returns Whether the diagram was successfully generated.
 */
async function safeGenerateArchitecture(workspaceRoot: vscode.Uri): Promise<boolean> {
  try {
    const { generateArchitectureDiagram } = await import("./architecture-agent");
    const { createLmClient } = await import("./lm-client");
    const { saveSnapshot } = await import("./history");

    const lmClient = createLmClient();
    try {
      if (!(await lmClient.isAvailable())) {
        log.info("LM unavailable — skipping architecture generation.");
        return false;
      }

      const archContent = await generateArchitectureDiagram(currentConfig, workspaceRoot, lmClient);

      await saveSnapshot(workspaceRoot, archContent);
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

/**
 * Prune old history snapshots to stay within `config.maxHistorySnapshots`.
 *
 * @param workspaceRoot - URI of workspace root.
 */
async function pruneHistory(workspaceRoot: vscode.Uri): Promise<void> {
  try {
    const { pruneSnapshots } = await import("./history");
    await pruneSnapshots(workspaceRoot, currentConfig.maxHistorySnapshots);
  } catch (err) {
    log.warn(`Snapshot pruning failed: ${String(err)}`);
  }
}

/**
 * Check which configured output files already exist in the workspace.
 * Returns an array of workspace-relative paths for files that exist.
 *
 * @param workspaceRoot - URI of workspace root.
 * @param config        - Current extension config (used to resolve configured output paths).
 */
async function detectExistingOutputFiles(
  workspaceRoot: vscode.Uri,
  config: import("./types").AsciiAgentConfig,
): Promise<string[]> {
  const candidates = [config.outputPaths.fileTree, config.outputPaths.architecture];
  const existing: string[] = [];
  for (const relPath of candidates) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceRoot, relPath));
      existing.push(relPath);
    } catch {
      // File does not exist — no action needed.
    }
  }
  return existing;
}

/**
 * Create a default `.asciirc.json` in the workspace root if one does not exist.
 *
 * @param workspaceRoot - URI of workspace root.
 */
async function maybeCreateDefaultAsciirc(workspaceRoot: vscode.Uri): Promise<void> {
  const configUri = vscode.Uri.joinPath(workspaceRoot, ".asciirc.json");
  try {
    await vscode.workspace.fs.stat(configUri);
    // File exists — do nothing.
  } catch {
    // File absent — write defaults.
    const { getDefaultConfig } = await import("./config");
    const defaults = getDefaultConfig();
    const content = JSON.stringify(defaults, null, 2);
    await vscode.workspace.fs.writeFile(configUri, Buffer.from(content, "utf-8"));
    log.info("Created default .asciirc.json.");
  }
}

/**
 * Check whether `.ascii_history/` is in `.gitignore` and prompt the user if not.
 *
 * Per PRD §7.7: do NOT auto-modify; prompt with a yes/no dialog.
 *
 * @param workspaceRoot - URI of workspace root.
 */
async function promptGitignoreUpdate(workspaceRoot: vscode.Uri): Promise<void> {
  const gitignoreUri = vscode.Uri.joinPath(workspaceRoot, ".gitignore");

  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
    content = Buffer.from(bytes).toString("utf-8");
  } catch {
    // .gitignore doesn't exist — skip.
    return;
  }

  // Check if .ascii_history/ is already listed.
  if (content.includes(".ascii_history")) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "ASCII Agent: Add .ascii_history/ to .gitignore?",
    "Yes",
    "No",
  );

  if (choice === "Yes") {
    const appended = content.trimEnd() + "\n\n# ASCII Agent history snapshots\n.ascii_history/\n";
    await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(appended, "utf-8"));
    log.info("Added .ascii_history/ to .gitignore.");
  }
}
