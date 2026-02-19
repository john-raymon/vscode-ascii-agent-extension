/**
 * @file watcher.ts
 * @description FileSystemWatcher orchestration with debounce timers.
 *
 * Responsibilities (PRD §5.3):
 * - Create a single `FileSystemWatcher` on `**\/*` within the workspace.
 * - On create/delete/change events:
 *   (a) Skip if path matches `ignore` patterns.
 *   (b) Skip if path is an output file or `.ascii_history/**` (self-write loop prevention).
 *   (c) Always schedule a debounced file-tree regeneration.
 *   (d) If the path matches `architectureWatchPatterns`, also schedule a debounced
 *       architecture regeneration.
 * - Maintain two INDEPENDENT debounce timers (tree vs. architecture).
 *
 * Critical edge cases handled:
 * - Burst protection: debounce timer resets on every event; fires only after sustained silence.
 * - Self-write loop: output files and history dir are explicitly excluded.
 */

import * as vscode from "vscode";
import type { AsciiAgentConfig, WatcherHandlers, WatcherSession } from "./types";
import { matchesAnyPattern, workspaceRelativePath } from "./utils";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Module-level debounce timer handles (shared so extension.ts can cancel them)
// ---------------------------------------------------------------------------

/** Timer handle for the pending file-tree regeneration. */
let treeDebounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Timer handle for the pending architecture regeneration. */
let archDebounceTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start watching the workspace for file changes.
 *
 * Creates a `vscode.FileSystemWatcher` on all files (`**\/*`) and wires up
 * the debounced regeneration handlers.
 *
 * @param config   - Active `AsciiAgentConfig` (ignore patterns, watch patterns, debounceMs).
 * @param context  - Extension context (unused directly; kept for API symmetry and future use).
 * @param handlers - Callbacks invoked when debounce timers expire.
 * @returns A `WatcherSession` whose `dispose()` tears everything down.
 */
export function startWatching(
  config: AsciiAgentConfig,
  context: vscode.ExtensionContext,
  handlers: WatcherHandlers,
): WatcherSession {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    log.warn("startWatching: no workspace folder — aborting.");
    return { dispose: () => undefined };
  }

  const workspaceRoot = workspaceFolders[0].uri;

  // Watch all files in the workspace (broad pattern; filtering done in the event handler).
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, "**/*"));

  /**
   * Build the set of paths that should NEVER trigger regeneration.
   * Pre-compute once when the watcher starts (config-driven).
   */
  const outputFilePaths = new Set([config.outputPaths.fileTree, config.outputPaths.architecture]);

  /**
   * Determine whether a file-system event should be processed.
   *
   * Returns `'ignore'` if the event should be skipped entirely.
   * Returns `'tree-only'` if only the file tree should be regenerated.
   * Returns `'tree-and-arch'` if both tree and architecture should be regenerated.
   *
   * @param uri - The URI of the changed file.
   */
  function classifyEvent(uri: vscode.Uri): "ignore" | "tree-only" | "tree-and-arch" {
    const relPath = workspaceRelativePath(uri, workspaceRoot);

    // --- Self-write loop prevention (PRD §5.3) ---
    // Skip changes to the output files themselves.
    if (outputFilePaths.has(relPath)) {
      return "ignore";
    }
    // Skip changes inside .ascii_history/.
    if (relPath.startsWith(".ascii_history/") || relPath === ".ascii_history") {
      return "ignore";
    }

    // --- Ignore-pattern matching ---
    if (matchesAnyPattern(relPath, config.ignore) || matchesAnyPattern(relPath.split("/").pop() ?? "", config.ignore)) {
      return "ignore";
    }

    // --- Architecture watch pattern matching ---
    if (matchesAnyPattern(relPath, config.architectureWatchPatterns)) {
      return "tree-and-arch";
    }

    return "tree-only";
  }

  /**
   * Schedule (or reset) the debounced file-tree regeneration.
   */
  function scheduleTreeRegen(): void {
    if (treeDebounceTimer !== undefined) {
      clearTimeout(treeDebounceTimer);
    }
    treeDebounceTimer = setTimeout(async () => {
      treeDebounceTimer = undefined;
      log.info("Debounce expired — regenerating file tree.");
      try {
        await handlers.onTreeRegenNeeded();
      } catch (err) {
        log.error(`Tree regen failed: ${String(err)}`);
      }
    }, config.debounceMs);
  }

  /**
   * Schedule (or reset) the debounced architecture regeneration.
   */
  function scheduleArchRegen(): void {
    if (archDebounceTimer !== undefined) {
      clearTimeout(archDebounceTimer);
    }
    archDebounceTimer = setTimeout(async () => {
      archDebounceTimer = undefined;
      log.info("Debounce expired — regenerating architecture diagram.");
      try {
        await handlers.onArchitectureRegenNeeded();
      } catch (err) {
        log.error(`Architecture regen failed: ${String(err)}`);
      }
    }, config.debounceMs);
  }

  /**
   * Shared handler for all three watcher events (create, change, delete).
   *
   * @param uri - URI of the affected file.
   */
  function handleEvent(uri: vscode.Uri): void {
    const classification = classifyEvent(uri);

    if (classification === "ignore") {
      return;
    }

    scheduleTreeRegen();

    if (classification === "tree-and-arch") {
      scheduleArchRegen();
    }
  }

  // Wire up all three watcher events.
  const onCreate = watcher.onDidCreate(handleEvent);
  const onChange = watcher.onDidChange(handleEvent);
  const onDelete = watcher.onDidDelete(handleEvent);

  log.info(`Watcher started. debounceMs=${config.debounceMs}`);

  return {
    dispose: () => {
      // Cancel any pending timers.
      if (treeDebounceTimer !== undefined) {
        clearTimeout(treeDebounceTimer);
        treeDebounceTimer = undefined;
      }
      if (archDebounceTimer !== undefined) {
        clearTimeout(archDebounceTimer);
        archDebounceTimer = undefined;
      }
      // Dispose VS Code watcher and event subscriptions.
      onCreate.dispose();
      onChange.dispose();
      onDelete.dispose();
      watcher.dispose();
      log.info("Watcher stopped.");
    },
  };
}

/**
 * Stop a watcher session by calling its dispose method.
 * Convenience wrapper that handles `undefined` sessions gracefully.
 *
 * @param session - The session to stop.
 */
export function stopWatching(session: WatcherSession): void {
  session.dispose();
}

/**
 * Cancel any pending debounce timers without disposing the watcher.
 * Used by `asciiAgent.generateNow` to pre-empt a pending debounced regeneration (PRD §7.5).
 */
export function cancelPendingTimers(): void {
  if (treeDebounceTimer !== undefined) {
    clearTimeout(treeDebounceTimer);
    treeDebounceTimer = undefined;
  }
  if (archDebounceTimer !== undefined) {
    clearTimeout(archDebounceTimer);
    archDebounceTimer = undefined;
  }
}
