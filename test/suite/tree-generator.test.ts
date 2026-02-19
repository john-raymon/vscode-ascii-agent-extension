/**
 * @file tree-generator.test.ts
 * @description Unit tests for `src/tree-generator.ts`.
 *
 * Strategy: mock `vscode.workspace.fs.readDirectory` to return controlled directory
 * structures, then assert the generated ASCII tree matches expected output.
 *
 * These tests run via `@vscode/test-cli` in the Extension Host environment where
 * the real `vscode` module is available.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { generateFileTree } from "../../src/tree-generator";
import type { AsciiAgentConfig } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal config with only the fields relevant to tree generation. */
function makeConfig(overrides: Partial<AsciiAgentConfig> = {}): AsciiAgentConfig {
  return {
    ignore: ["node_modules", ".git"],
    architectureWatchPatterns: [],
    outputPaths: { fileTree: "docs/file_tree.txt", architecture: "docs/architecture.txt" },
    debounceMs: 2000,
    maxHistorySnapshots: 50,
    autoWatchEnabled: false,
    contextFiles: [],
    filePriority: [],
    ...overrides,
  };
}

/**
 * Patch `vscode.workspace.fs.readDirectory` to return a controlled file-system map.
 * Returns a restore function that must be called after the test.
 *
 * @param fsMap - Map from absolute path strings to their directory entries.
 */
function mockReadDirectory(fsMap: Map<string, [string, vscode.FileType][]>): () => void {
  const original = vscode.workspace.fs.readDirectory.bind(vscode.workspace.fs);
  // Intentional mock for testing
  vscode.workspace.fs.readDirectory = async (uri: vscode.Uri) => {
    const entries = fsMap.get(uri.fsPath);
    if (!entries) {
      throw new Error(`ENOENT: ${uri.fsPath}`);
    }
    return entries;
  };
  return () => {
    // Restore original for cleanup
    vscode.workspace.fs.readDirectory = original;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite("Tree Generator", () => {
  test("generates a simple two-level tree", async () => {
    const root = vscode.Uri.file("/fake/workspace");

    const fsMap = new Map<string, [string, vscode.FileType][]>([
      [
        "/fake/workspace",
        [
          ["src", vscode.FileType.Directory],
          ["package.json", vscode.FileType.File],
        ],
      ],
      ["/fake/workspace/src", [["index.ts", vscode.FileType.File]]],
    ]);

    const restore = mockReadDirectory(fsMap);
    try {
      const result = await generateFileTree(root, makeConfig());

      // Root node should be the workspace folder name.
      assert.ok(result.startsWith("workspace/"), `Expected root "workspace/", got: ${result.split("\n")[0]}`);

      // Should contain the src directory.
      assert.ok(result.includes("src/"), "Missing src/ directory");

      // Should contain the file.
      assert.ok(result.includes("index.ts"), "Missing index.ts");

      // package.json should be tagged [config].
      assert.ok(result.includes("[config]"), "Missing [config] tag on package.json");
    } finally {
      restore();
    }
  });

  test("ignores node_modules", async () => {
    const root = vscode.Uri.file("/fake/workspace");

    const fsMap = new Map<string, [string, vscode.FileType][]>([
      [
        "/fake/workspace",
        [
          ["node_modules", vscode.FileType.Directory],
          ["src", vscode.FileType.Directory],
        ],
      ],
      ["/fake/workspace/src", [["app.ts", vscode.FileType.File]]],
    ]);

    const restore = mockReadDirectory(fsMap);
    try {
      const result = await generateFileTree(root, makeConfig());
      assert.ok(!result.includes("node_modules"), "node_modules should be ignored");
      assert.ok(result.includes("src/"), "src/ should be present");
    } finally {
      restore();
    }
  });

  test("sorts directories before files", async () => {
    const root = vscode.Uri.file("/fake/workspace");

    const fsMap = new Map<string, [string, vscode.FileType][]>([
      [
        "/fake/workspace",
        [
          ["z-file.ts", vscode.FileType.File],
          ["a-dir", vscode.FileType.Directory],
        ],
      ],
      ["/fake/workspace/a-dir", []],
    ]);

    const restore = mockReadDirectory(fsMap);
    try {
      const result = await generateFileTree(root, makeConfig());
      const lines = result.split("\n").filter(Boolean);
      // a-dir/ should appear before z-file.ts.
      const dirIdx = lines.findIndex((l) => l.includes("a-dir/"));
      const fileIdx = lines.findIndex((l) => l.includes("z-file.ts"));
      assert.ok(dirIdx < fileIdx, `Directory index (${dirIdx}) should be before file index (${fileIdx})`);
    } finally {
      restore();
    }
  });

  test("uses custom tags from config when provided", async () => {
    const root = vscode.Uri.file("/fake/workspace");

    const fsMap = new Map<string, [string, vscode.FileType][]>([
      ["/fake/workspace", [["server.ts", vscode.FileType.File]]],
    ]);

    const config = makeConfig({ tags: { "*.ts": "[custom-tag]" } });

    const restore = mockReadDirectory(fsMap);
    try {
      const result = await generateFileTree(root, config);
      assert.ok(result.includes("[custom-tag]"), "Custom tag should appear");
      assert.ok(!result.includes("[source]"), "Default tag should NOT appear when custom tags are set");
    } finally {
      restore();
    }
  });
});
