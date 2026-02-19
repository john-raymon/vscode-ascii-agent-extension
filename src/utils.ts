/**
 * @file utils.ts
 * @description Shared utility functions for ASCII Agent.
 *
 * Stub — full implementation in Phase 2.
 */

import * as vscode from "vscode";

/**
 * Test a workspace-relative file path against an array of glob patterns.
 *
 * @param filePath - Workspace-relative path to test (e.g. "src/app.tsx").
 * @param patterns - Array of glob patterns to match against.
 * @returns `true` if the path matches at least one pattern.
 */
export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filePath, pattern));
}

/**
 * Convert an absolute `vscode.Uri` to a workspace-relative string.
 *
 * @param uri           - Absolute URI to convert.
 * @param workspaceRoot - URI of the workspace root.
 * @returns Workspace-relative path (e.g. "src/app.tsx"), without leading slash.
 */
export function workspaceRelativePath(uri: vscode.Uri, workspaceRoot: vscode.Uri): string {
  const rootPath = workspaceRoot.fsPath.replace(/\\/g, "/").replace(/\/$/, "");
  const filePath = uri.fsPath.replace(/\\/g, "/");
  return filePath.startsWith(rootPath + "/") ? filePath.slice(rootPath.length + 1) : filePath;
}

/**
 * Create a directory (and all intermediate parents) if it does not already exist.
 * Equivalent to `mkdir -p`.
 *
 * @param uri - Absolute URI of the directory to create.
 */
export async function ensureDirectoryExists(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(uri);
  } catch {
    // createDirectory is idempotent on most platforms; ignore errors if already exists.
    // Any real I/O error will surface when we subsequently try to write files.
  }
}

// ---------------------------------------------------------------------------
// Minimal glob matching (no npm dependencies)
// ---------------------------------------------------------------------------

/**
 * Minimal glob pattern matcher.
 *
 * Supports the following syntax:
 * - `*`  — matches any sequence of characters within a path segment (not `/`).
 * - `**` — matches any sequence of characters including `/` (zero or more path segments).
 * - `?`  — matches any single character except `/`.
 * - `{a,b}` — brace expansion (simple comma-separated alternatives).
 * - Character classes like `{ts,tsx}`.
 *
 * This is intentionally minimal — sufficient for the glob patterns used in `.asciirc.json`.
 * Full POSIX glob semantics are NOT required.
 *
 * @param path    - The path to test.
 * @param pattern - The glob pattern.
 * @returns `true` if `path` matches `pattern`.
 */
function minimatch(path: string, pattern: string): boolean {
  // Normalize path separators to forward slashes.
  const normalizedPath = path.replace(/\\/g, "/");

  // Expand brace expressions like `{ts,tsx,js}` into alternatives.
  const patterns = expandBraces(pattern);

  return patterns.some((p) => matchGlob(normalizedPath, p));
}

/**
 * Expand brace expressions in a glob pattern into an array of patterns.
 * E.g. `src/**\/*.{ts,tsx}` → `["src/**\/*.ts", "src/**\/*.tsx"]`
 *
 * @param pattern - Glob pattern possibly containing `{a,b,c}`.
 * @returns Array of expanded patterns.
 */
function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern);
  if (!match) {
    return [pattern];
  }

  const alternatives = match[1].split(",");
  const results: string[] = [];

  for (const alt of alternatives) {
    const expanded = pattern.slice(0, match.index) + alt + pattern.slice(match.index + match[0].length);
    // Recursively expand nested braces.
    results.push(...expandBraces(expanded));
  }

  return results;
}

/**
 * Match a path against a single (already brace-expanded) glob pattern.
 * Converts the glob to a regular expression and tests.
 *
 * @param path    - Normalized path.
 * @param pattern - A single glob pattern (no braces).
 * @returns `true` if the path matches.
 */
function matchGlob(path: string, pattern: string): boolean {
  // Convert glob to regex:
  // 1. Escape regex special chars (except * and ?).
  // 2. Replace `**` with a sentinel, then `*` with `[^/]*`, then restore `**` as `.*`.
  // 3. Replace `?` with `[^/]`.
  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex specials (not * or ?)
    .replace(/\*\*/g, "\u0001DOUBLESTAR\u0001") // Sentinel for **
    .replace(/\*/g, "[^/]*") // * → any chars except /
    .replace(/\u0001DOUBLESTAR\u0001/g, ".*") // ** → any chars including /
    .replace(/\?/g, "[^/]"); // ? → any single char except /

  // Anchor the pattern.
  // If the pattern has no `/`, match against the basename only.
  if (!pattern.includes("/")) {
    // Match the filename at any depth.
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
