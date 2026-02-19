/**
 * @file logger.ts
 * @description Singleton output channel for all ASCII Agent diagnostic logging.
 *
 * All modules import from this file instead of `extension.ts` to avoid circular
 * dependencies. The output channel is initialized by `extension.ts` on activation
 * via `initLogger()`, and is a no-op until initialized.
 *
 * Usage:
 *   import { log } from './logger';
 *   log.info('Hello');
 *   log.warn('Something odd happened');
 *   log.error('Something broke');
 */

import * as vscode from "vscode";

// The single shared output channel instance.
let _channel: vscode.OutputChannel | undefined;

/**
 * Initialize the logger with the given output channel.
 * Must be called once from `extension.ts` during `activate()`.
 *
 * @param channel - The already-created output channel.
 */
export function initLogger(channel: vscode.OutputChannel): void {
  _channel = channel;
}

/**
 * Logging helpers.
 * All methods are no-ops if the logger has not been initialized yet.
 */
export const log = {
  /**
   * Log an informational message.
   * @param message - The message to log.
   */
  info(message: string): void {
    _channel?.appendLine(`[INFO]  ${message}`);
  },

  /**
   * Log a warning message.
   * @param message - The message to log.
   */
  warn(message: string): void {
    _channel?.appendLine(`[WARN]  ${message}`);
  },

  /**
   * Log an error message.
   * @param message - The message to log.
   */
  error(message: string): void {
    _channel?.appendLine(`[ERROR] ${message}`);
  },

  /**
   * Log a raw message with no prefix — for structured output (e.g. command output).
   * @param message - The message to log.
   */
  raw(message: string): void {
    _channel?.appendLine(message);
  },
};

/**
 * Expose the raw channel for cases where callers need direct access
 * (e.g. to push into `context.subscriptions`).
 */
export function getOutputChannel(): vscode.OutputChannel | undefined {
  return _channel;
}
