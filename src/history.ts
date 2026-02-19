/**
 * @file history.ts
 * @description Versioning engine for `docs/architecture.txt`.
 *
 * Before every architecture overwrite, a timestamped snapshot is saved to
 * `.ascii_history/` inside the workspace root. Old snapshots are pruned when
 * the count exceeds `maxHistorySnapshots`.
 *
 * IMPORTANT: Only `architecture.txt` is versioned. `file_tree.txt` is
 * deterministic and can be regenerated instantly, so versioning it is wasteful.
 *
 * See PRD §5.7.
 */

import * as vscode from "vscode";

/** Directory name for storing history snapshots, relative to workspace root. */
const HISTORY_DIR = ".ascii_history";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a timestamped snapshot of the current architecture content to `.ascii_history/`.
 *
 * File naming: `architecture_<ISO8601_timestamp>.txt`
 * Example:     `architecture_2026-02-19T14-30-00-000Z.txt`
 *
 * After saving, prune old snapshots if the count exceeds `maxHistorySnapshots`.
 *
 * @param workspaceRoot  - Absolute URI of the workspace root.
 * @param currentContent - The current contents of `docs/architecture.txt` to snapshot.
 */
export async function saveSnapshot(workspaceRoot: vscode.Uri, currentContent: string): Promise<void> {
  const historyDirUri = vscode.Uri.joinPath(workspaceRoot, HISTORY_DIR);

  // Ensure the history directory exists.
  try {
    await vscode.workspace.fs.createDirectory(historyDirUri);
  } catch {
    // Already exists or not creatable — a subsequent write error will surface it.
  }

  // Build a filename-safe ISO 8601 timestamp (colons replaced with dashes).
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const fileName = `architecture_${timestamp}.txt`;
  const snapshotUri = vscode.Uri.joinPath(historyDirUri, fileName);

  // Write the snapshot.
  await vscode.workspace.fs.writeFile(snapshotUri, Buffer.from(currentContent, "utf-8"));
}

/**
 * Prune old snapshots so that the history directory contains at most
 * `maxSnapshots - 1` files after pruning (leaving room for the new one being saved).
 *
 * Oldest snapshots (by file modification time) are deleted first.
 *
 * @param workspaceRoot - Absolute URI of the workspace root.
 * @param maxSnapshots  - Maximum number of snapshots to retain.
 */
export async function pruneSnapshots(workspaceRoot: vscode.Uri, maxSnapshots: number): Promise<void> {
  const historyDirUri = vscode.Uri.joinPath(workspaceRoot, HISTORY_DIR);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(historyDirUri);
  } catch {
    // Directory doesn't exist yet — nothing to prune.
    return;
  }

  // Filter to only `.txt` snapshot files.
  const snapshotNames = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".txt"))
    .map(([name]) => name);

  if (snapshotNames.length <= maxSnapshots) {
    return;
  }

  // Gather modification times for sorting.
  const withMtimes: { name: string; mtime: number }[] = [];
  for (const name of snapshotNames) {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(historyDirUri, name));
      withMtimes.push({ name, mtime: stat.mtime });
    } catch {
      // If we can't stat a file, include it with mtime=0 (will be deleted first).
      withMtimes.push({ name, mtime: 0 });
    }
  }

  // Sort ascending: oldest first.
  withMtimes.sort((a, b) => a.mtime - b.mtime);

  // Delete oldest files until count equals maxSnapshots - 1.
  const targetCount = maxSnapshots - 1;
  const toDelete = withMtimes.slice(0, withMtimes.length - targetCount);

  for (const { name } of toDelete) {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(historyDirUri, name));
    } catch {
      // Best-effort deletion — ignore errors.
    }
  }
}
