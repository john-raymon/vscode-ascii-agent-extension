/**
 * @file types.ts
 * @description Shared interfaces, enums, and type aliases used throughout the ASCII Agent extension.
 *              All complex data structures are defined here to ensure type safety and discoverability.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Full configuration schema matching `.asciirc.json`.
 * All fields have defaults defined in `config.ts`; user values deep-merge over them.
 */
export interface AsciiAgentConfig {
  /** Glob patterns for directories/files the file-tree generator should ignore. */
  ignore: string[];

  /**
   * Glob patterns for files whose content changes trigger architecture re-analysis.
   * File-tree is regenerated on ANY structural change regardless of this list.
   */
  architectureWatchPatterns: string[];

  /** Where the two output diagrams live, relative to workspace root. */
  outputPaths: {
    fileTree: string;
    architecture: string;
  };

  /** Debounce window in milliseconds — how long to wait after the last file event before regenerating. */
  debounceMs: number;

  /** Maximum number of history snapshots to retain in `.ascii_history/`. */
  maxHistorySnapshots: number;

  /** Whether auto-watch is enabled on startup. */
  autoWatchEnabled: boolean;

  /**
   * Optional extra files to feed as context to the LM prompt.
   * Paths are relative to workspace root.
   */
  contextFiles: string[];

  /**
   * Optional priority-ordered list of glob patterns for token-budget truncation.
   * Files matching earlier patterns are kept; later ones are truncated first.
   * If empty, a generic heuristic is used.
   */
  filePriority: string[];

  /**
   * Optional custom tag map for file-tree annotations.
   * Keys are glob patterns, values are tag strings like "[config]".
   * If provided, REPLACES the default tag map entirely (not merged).
   */
  tags?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/** State of the auto-watcher */
export enum WatcherState {
  Active = "active",
  Paused = "paused",
  Disabled = "disabled",
}

/**
 * Handlers invoked when debounce timers expire and regeneration is needed.
 * Both handlers are async so callers can await and report errors properly.
 */
export interface WatcherHandlers {
  /** Called when the file tree needs to be regenerated. */
  onTreeRegenNeeded: () => Promise<void>;
  /** Called when the architecture diagram needs to be regenerated. */
  onArchitectureRegenNeeded: () => Promise<void>;
}

/**
 * Disposable session handle returned by `startWatching`.
 * Call `dispose()` to tear down all watchers and cancel pending timers.
 */
export interface WatcherSession {
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Generation Results
// ---------------------------------------------------------------------------

/**
 * Result of a diagram generation attempt.
 * Callers should check `success` before using `diagramContent`.
 */
export interface GenerationResult {
  /** Whether the generation completed successfully. */
  success: boolean;
  /** The generated diagram string, present only on success. */
  diagramContent?: string;
  /** Human-readable error message, present only on failure. */
  error?: string;
  /** Wall-clock time elapsed during generation, in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// LM Client
// ---------------------------------------------------------------------------

import type * as vscode from "vscode";

/**
 * Thin, reusable wrapper interface around `vscode.lm`.
 * Abstracts model selection, request queueing, cancellation, and retries.
 */
export interface LmClient {
  /**
   * Send a chat prompt to the Copilot LM and return the full response text.
   * Implements last-write-wins cancellation: if a request is already in-flight,
   * it is cancelled before this new one starts.
   *
   * @param messages - Ordered list of chat messages forming the prompt.
   * @param token    - Optional external cancellation token (e.g. from a progress dialog).
   * @returns The full streamed response as a single string.
   * @throws If the model is unavailable or a non-recoverable error occurs after retry.
   */
  sendPrompt(messages: vscode.LanguageModelChatMessage[], token?: vscode.CancellationToken): Promise<string>;

  /** Cancel all in-flight LM requests. Used during `deactivate()`. */
  cancelAll(): void;

  /** Returns `true` if a Copilot model is currently available. */
  isAvailable(): boolean;

  /** Release all resources held by this client. */
  dispose(): void;
}
