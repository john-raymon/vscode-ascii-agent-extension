/**
 * @file token-tracker.ts
 * @description Lightweight token-usage accounting for ASCII Agent LM requests.
 *
 * The VS Code LM API does not expose exact token counts from streamed responses,
 * so this module uses character-count heuristics (~4 chars per token) to produce
 * estimates. These are "good enough" for surfacing rough cost awareness, not for
 * billing accuracy.
 *
 * Two tallies are maintained:
 * - **Session** — persisted in `ExtensionContext.globalState` under a well-known key but reset
 *   to zero on every extension activation, so it reflects only the current window's usage.
 * - **Lifetime** — persisted across sessions in `ExtensionContext.globalState`.
 *
 * All public functions are pure side-effects through `globalState`; no module-level
 * mutable state is held here to avoid circular dependencies.
 */

import * as vscode from "vscode";
import type { TokenUsageTotals } from "./types";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const LIFETIME_KEY = "asciiAgent.tokenUsage.lifetime";
const SESSION_KEY = "asciiAgent.tokenUsage.session";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a completed LM request's estimated token usage.
 *
 * Increments both the in-memory session tally and the persisted lifetime tally.
 * Logs a one-line summary to the ASCII Agent output channel.
 *
 * @param context              - Extension context providing `globalState` persistence.
 * @param inputTokensEstimate  - Estimated number of input (prompt) tokens consumed.
 * @param outputTokensEstimate - Estimated number of output (completion) tokens produced.
 */
export async function recordTokenUsage(
  context: vscode.ExtensionContext,
  inputTokensEstimate: number,
  outputTokensEstimate: number,
): Promise<void> {
  const session = getSessionTokenUsage(context);
  const newSession: TokenUsageTotals = {
    inputTokensEstimate: session.inputTokensEstimate + inputTokensEstimate,
    outputTokensEstimate: session.outputTokensEstimate + outputTokensEstimate,
    requestCount: session.requestCount + 1,
  };
  await context.globalState.update(SESSION_KEY, newSession);

  const lifetime = getLifetimeTokenUsage(context);
  const newLifetime: TokenUsageTotals = {
    inputTokensEstimate: lifetime.inputTokensEstimate + inputTokensEstimate,
    outputTokensEstimate: lifetime.outputTokensEstimate + outputTokensEstimate,
    requestCount: lifetime.requestCount + 1,
  };
  await context.globalState.update(LIFETIME_KEY, newLifetime);

  log.info(
    `Token usage — request: ~${inputTokensEstimate} in / ~${outputTokensEstimate} out` +
      ` | session total: ~${newSession.inputTokensEstimate + newSession.outputTokensEstimate} tokens` +
      ` (${newSession.requestCount} requests)` +
      ` | lifetime: ~${newLifetime.inputTokensEstimate + newLifetime.outputTokensEstimate} tokens` +
      ` (${newLifetime.requestCount} requests)`,
  );
}

/**
 * Reset the session token tally.
 * Should be called at the start of each extension activation.
 *
 * @param context - Extension context providing `globalState`.
 */
export async function resetSessionTokens(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(SESSION_KEY, {
    inputTokensEstimate: 0,
    outputTokensEstimate: 0,
    requestCount: 0,
  });
}

/**
 * Return the current session token usage totals.
 * Resets to zero on each extension activation.
 *
 * @param context - Extension context providing `globalState`.
 */
export function getSessionTokenUsage(context: vscode.ExtensionContext): TokenUsageTotals {
  return context.globalState.get<TokenUsageTotals>(SESSION_KEY) ?? emptyTotals();
}

/**
 * Return the persisted lifetime token usage totals.
 * Accumulates across all sessions until manually reset.
 *
 * @param context - Extension context providing `globalState`.
 */
export function getLifetimeTokenUsage(context: vscode.ExtensionContext): TokenUsageTotals {
  return context.globalState.get<TokenUsageTotals>(LIFETIME_KEY) ?? emptyTotals();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Zero-value `TokenUsageTotals`. */
function emptyTotals(): TokenUsageTotals {
  return { inputTokensEstimate: 0, outputTokensEstimate: 0, requestCount: 0 };
}
