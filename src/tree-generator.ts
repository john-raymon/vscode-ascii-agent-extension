/**
 * @file tree-generator.ts
 * @description Pure function: workspace → file_tree.txt string.
 *
 * This module is PURE — no AI, no LM calls. It walks the file system
 * and produces the ASCII tree string.
 *
 * Full implementation — see PRD §5.4.
 */

import * as vscode from "vscode";
import type { AsciiAgentConfig } from "./types";
import { matchesAnyPattern } from "./utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of file-tree entries before truncation (PRD §7.6). */
const MAX_ENTRIES = 5000;

/**
 * Default tag map: maps glob patterns to inline tag strings.
 * Used when `config.tags` is not provided.
 * Keys are generic — no project-specific paths.
 */
const DEFAULT_TAGS: Record<string, string> = {
  "*.config.*": "[config]",
  "*.json": "[config]",
  "src/components/**": "[ui]",
  "src/**": "[source]",
  "lib/**": "[source]",
  "api/**": "[backend]",
  "docs/**": "[docs]",
  "test/**": "[test]",
  "scripts/**": "[script]",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the ASCII file-tree string for the given workspace.
 *
 * Algorithm (PRD §5.4):
 * 1. Recursively read directory entries via `vscode.workspace.fs.readDirectory`.
 * 2. Filter out entries matching `ignore` patterns.
 * 3. Sort: directories first (alphabetical), then files (alphabetical).
 * 4. Format with `├──`, `└──`, `│   ` box-drawing characters.
 * 5. Append inline tags based on the tag map (config.tags or defaults).
 * 6. Prepend the workspace folder name as the root node.
 *
 * Note: File I/O is performed — do NOT write to disk. Caller handles I/O.
 *
 * @param workspaceRoot - Absolute URI of the workspace root folder.
 * @param config        - The active `AsciiAgentConfig` (for ignore patterns and tags).
 * @returns The complete ASCII tree as a single string.
 */
export async function generateFileTree(workspaceRoot: vscode.Uri, config: AsciiAgentConfig): Promise<string> {
  // Determine which tag map to use (user-provided replaces defaults entirely).
  const tagMap: Record<string, string> = config.tags ?? DEFAULT_TAGS;

  // Counter to enforce the MAX_ENTRIES cap.
  let entryCount = 0;
  let truncated = false;

  /**
   * Recursively build tree lines for a directory.
   *
   * @param dirUri   - Absolute URI of the directory to walk.
   * @param relPath  - Workspace-relative path of this directory (for ignore-pattern matching).
   * @param prefix   - Current line-drawing prefix (built up as we recurse).
   * @returns Array of formatted tree lines.
   */
  async function buildLines(dirUri: vscode.Uri, relPath: string, prefix: string): Promise<string[]> {
    if (truncated) {
      return [];
    }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      // Unreadable directory — skip silently.
      return [];
    }

    // Filter out ignored entries.
    const filtered = entries.filter(([name]) => {
      const entryRelPath = relPath ? `${relPath}/${name}` : name;
      return !matchesAnyPattern(entryRelPath, config.ignore) && !matchesAnyPattern(name, config.ignore);
    });

    // Sort: directories first (alphabetical), then files (alphabetical).
    const sorted = filtered.sort(([nameA, typeA], [nameB, typeB]) => {
      const aIsDir = typeA === vscode.FileType.Directory;
      const bIsDir = typeB === vscode.FileType.Directory;
      if (aIsDir !== bIsDir) {
        return aIsDir ? -1 : 1;
      }
      return nameA.localeCompare(nameB);
    });

    const lines: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
      if (truncated) {
        break;
      }

      const [name, type] = sorted[i];
      const isLast = i === sorted.length - 1;
      const entryRelPath = relPath ? `${relPath}/${name}` : name;

      // Box-drawing characters for tree structure.
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      entryCount++;
      if (entryCount > MAX_ENTRIES) {
        // Count remaining entries to report in truncation message.
        const remaining = sorted.length - i;
        lines.push(`${prefix}... (truncated: ${remaining} more entries not shown)`);
        truncated = true;
        break;
      }

      if (type === vscode.FileType.Directory) {
        lines.push(`${prefix}${connector}${name}/`);
        // Recurse into subdirectory.
        const childLines = await buildLines(vscode.Uri.joinPath(dirUri, name), entryRelPath, prefix + childPrefix);
        lines.push(...childLines);
      } else {
        // Determine inline tag for this file.
        const tag = resolveTag(entryRelPath, tagMap);
        const tagSuffix = tag ? `  ${tag}` : "";
        lines.push(`${prefix}${connector}${name}${tagSuffix}`);
      }
    }

    return lines;
  }

  // Build all lines starting from the workspace root.
  const rootName = workspaceRoot.path.split("/").pop() ?? workspaceRoot.fsPath.split("/").pop() ?? "workspace";
  const bodyLines = await buildLines(workspaceRoot, "", "");

  // Compose final string with root node at top.
  const allLines = [rootName + "/", ...bodyLines];
  return allLines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

/**
 * Resolve the tag string for a workspace-relative file path.
 * Tests the path against each entry in `tagMap` (in insertion order) and
 * returns the first matching tag. Returns `undefined` if no match.
 *
 * @param relPath - Workspace-relative path to the file.
 * @param tagMap  - Map of glob-pattern → tag string.
 * @returns The matched tag string, or `undefined`.
 */
function resolveTag(relPath: string, tagMap: Record<string, string>): string | undefined {
  for (const [pattern, tag] of Object.entries(tagMap)) {
    if (matchesAnyPattern(relPath, [pattern])) {
      return tag;
    }
  }
  return undefined;
}
