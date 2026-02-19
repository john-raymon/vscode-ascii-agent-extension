/**
 * @file config.test.ts
 * @description Unit tests for `src/config.ts`.
 *
 * Strategy: mock `vscode.workspace.fs.readFile` to return controlled JSON text,
 * then assert that the loaded config merges and validates correctly.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { loadConfig, getDefaultConfig } from "../../src/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Patch `vscode.workspace.fs.readFile` for a single URI path.
 * Returns a restore function.
 *
 * @param targetPath - The `fsPath` of the URI to intercept.
 * @param content    - The string content to return (encoded as UTF-8 bytes).
 */
function mockReadFile(targetPath: string, content: string | Error): () => void {
  const original = vscode.workspace.fs.readFile.bind(vscode.workspace.fs);
  // @ts-expect-error — intentional mock
  vscode.workspace.fs.readFile = async (uri: vscode.Uri): Promise<Uint8Array> => {
    if (uri.fsPath === targetPath) {
      if (content instanceof Error) {
        throw content;
      }
      return Buffer.from(content, "utf-8");
    }
    return original(uri);
  };
  return () => {
    // @ts-expect-error — restoring original
    vscode.workspace.fs.readFile = original;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite("Config Loader", () => {
  const fakeRoot = vscode.Uri.file("/fake/workspace");
  const configPath = "/fake/workspace/.asciirc.json";

  test("returns defaults when .asciirc.json is absent", async () => {
    const restore = mockReadFile(configPath, new Error("ENOENT: file not found"));
    try {
      const cfg = await loadConfig(fakeRoot);
      const defaults = getDefaultConfig();
      assert.strictEqual(cfg.debounceMs, defaults.debounceMs);
      assert.strictEqual(cfg.autoWatchEnabled, defaults.autoWatchEnabled);
      assert.deepStrictEqual(cfg.ignore, defaults.ignore);
    } finally {
      restore();
    }
  });

  test("merges user values over defaults", async () => {
    const userConfig = JSON.stringify({ debounceMs: 5000, autoWatchEnabled: false });
    const restore = mockReadFile(configPath, userConfig);
    try {
      const cfg = await loadConfig(fakeRoot);
      assert.strictEqual(cfg.debounceMs, 5000, "User debounceMs should override default");
      assert.strictEqual(cfg.autoWatchEnabled, false, "User autoWatchEnabled should override default");
      // Default ignore patterns should still be present (not overridden by user config).
      assert.ok(cfg.ignore.includes("node_modules"), "Default ignore should be preserved");
    } finally {
      restore();
    }
  });

  test("clamps debounceMs to minimum 500 when below threshold", async () => {
    const userConfig = JSON.stringify({ debounceMs: 100 });
    const restore = mockReadFile(configPath, userConfig);
    try {
      const cfg = await loadConfig(fakeRoot);
      assert.strictEqual(cfg.debounceMs, 500, "debounceMs should be clamped to 500");
    } finally {
      restore();
    }
  });

  test("clamps maxHistorySnapshots to minimum 1 when 0", async () => {
    const userConfig = JSON.stringify({ maxHistorySnapshots: 0 });
    const restore = mockReadFile(configPath, userConfig);
    try {
      const cfg = await loadConfig(fakeRoot);
      assert.strictEqual(cfg.maxHistorySnapshots, 1, "maxHistorySnapshots should be clamped to 1");
    } finally {
      restore();
    }
  });

  test("falls back to defaults on malformed JSON", async () => {
    const restore = mockReadFile(configPath, "{ this is not valid json }}}");
    try {
      const cfg = await loadConfig(fakeRoot);
      const defaults = getDefaultConfig();
      assert.strictEqual(cfg.debounceMs, defaults.debounceMs, "Should fall back to defaults on bad JSON");
    } finally {
      restore();
    }
  });

  test("strips JSONC comments before parsing", async () => {
    const jsonc = `{
  // This is a comment
  "debounceMs": 3000
}`;
    const restore = mockReadFile(configPath, jsonc);
    try {
      const cfg = await loadConfig(fakeRoot);
      assert.strictEqual(cfg.debounceMs, 3000, "Should parse JSONC with line comments");
    } finally {
      restore();
    }
  });

  test("getDefaultConfig returns a fresh object each call", () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    a.ignore.push("__test__");
    assert.ok(!b.ignore.includes("__test__"), "getDefaultConfig should return independent copies");
  });
});
