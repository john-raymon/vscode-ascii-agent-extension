/**
 * @file lm-client.ts
 * @description Thin, reusable wrapper around `vscode.lm`.
 *
 * Responsibilities (PRD §5.6):
 * - Model selection: `vscode.lm.selectChatModels({ vendor: 'copilot' })`, cache reference.
 * - Request execution: send via `model.sendRequest()`, stream response, return full text.
 * - Cancellation: `CancellationTokenSource` per request; expose `cancelAll()`.
 * - Error handling: quota cooldown, consent prompt, one retry on unknown errors.
 * - Rate limiting: only ONE LM request in-flight at a time (last-write-wins cancellation).
 */

import * as vscode from "vscode";
import type { LmClient } from "./types";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration of the quota-exceeded cooldown period in milliseconds. */
const QUOTA_COOLDOWN_MS = 60_000;

/** Delay before the single retry attempt on unknown errors, in milliseconds. */
const RETRY_DELAY_MS = 3_000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new `LmClient` instance.
 *
 * The returned client manages its own model reference and in-flight request state.
 * Callers should call `dispose()` when done (e.g. after `deactivate()`).
 *
 * @returns A fully initialized `LmClient`.
 */
export function createLmClient(): LmClient {
  /** Cached chat model. Re-selected whenever `vscode.lm.onDidChangeChatModels` fires. */
  let cachedModel: vscode.LanguageModelChat | undefined;

  /** Whether we are currently in a quota-exceeded cooldown period. */
  let quotaCooldown = false;

  /** Timeout handle for clearing the cooldown flag. */
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `CancellationTokenSource` for the currently in-flight request.
   * Cancelled (and replaced) when a new request arrives (last-write-wins).
   */
  let currentRequestCts: vscode.CancellationTokenSource | undefined;

  /** Disposable for the model-change listener. */
  let modelChangeDisposable: vscode.Disposable | undefined;

  // -------------------------------------------------------------------------
  // Model selection
  // -------------------------------------------------------------------------

  /**
   * Select and cache the best available Copilot model.
   * Tries to find a model with vendor 'copilot'. Falls back to first available if needed.
   *
   * @returns The selected model, or `undefined` if none available.
   */
  async function selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (models.length > 0) {
        cachedModel = models[0];
        log.info(`LM model selected: ${cachedModel.name} (vendor: ${cachedModel.vendor})`);
        return cachedModel;
      }
    } catch (err) {
      log.warn(`Model selection failed: ${String(err)}`);
    }
    cachedModel = undefined;
    return undefined;
  }

  // Eagerly select a model when the client is created.
  selectModel();

  // Re-select when available models change (e.g. user signs in/out of Copilot).
  modelChangeDisposable = vscode.lm.onDidChangeChatModels(() => {
    log.info("LM models changed — re-selecting.");
    selectModel();
  });

  // -------------------------------------------------------------------------
  // Public interface implementation
  // -------------------------------------------------------------------------

  /**
   * Send a chat prompt and return the full streamed response text.
   *
   * Implements last-write-wins: if a request is already in-flight when this is
   * called, the old request is cancelled before the new one starts.
   *
   * @param messages - Ordered chat messages forming the prompt.
   * @param token    - Optional external cancellation token.
   * @returns Full response text as a string.
   */
  async function sendPrompt(
    messages: vscode.LanguageModelChatMessage[],
    token?: vscode.CancellationToken,
  ): Promise<string> {
    // Enforce quota cooldown — do not attempt requests during cooldown.
    if (quotaCooldown) {
      log.warn("LM quota cooldown active — skipping request.");
      throw new Error("ASCII Agent: LM quota cooldown active. Skipping request.");
    }

    // Ensure a model is available.
    const model = cachedModel ?? (await selectModel());
    if (!model) {
      throw new Error("ASCII Agent: No Copilot LM model available.");
    }

    // Last-write-wins: cancel any in-flight request.
    if (currentRequestCts) {
      currentRequestCts.cancel();
      currentRequestCts.dispose();
      currentRequestCts = undefined;
    }

    // Create a new cancellation token for this request.
    // Merge with any externally provided token.
    const cts = new vscode.CancellationTokenSource();
    currentRequestCts = cts;

    // If an external token is provided, propagate its cancellation.
    let externalCancelDisposable: vscode.Disposable | undefined;
    if (token) {
      externalCancelDisposable = token.onCancellationRequested(() => cts.cancel());
    }

    try {
      return await executeRequest(model, messages, cts.token);
    } finally {
      externalCancelDisposable?.dispose();
      if (currentRequestCts === cts) {
        currentRequestCts = undefined;
      }
      cts.dispose();
    }
  }

  /**
   * Execute the LM request with one retry on unknown errors.
   *
   * @param model    - The selected LM model.
   * @param messages - Chat messages to send.
   * @param token    - Cancellation token for this specific request.
   * @returns Full response text.
   */
  async function executeRequest(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    token: vscode.CancellationToken,
  ): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await model.sendRequest(messages, {}, token);

        // Stream the response and accumulate into a string.
        let fullText = "";
        for await (const chunk of response.text) {
          if (token.isCancellationRequested) {
            return fullText; // Return whatever we have so far.
          }
          fullText += chunk;
        }
        return fullText;
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          return handleLanguageModelError(err, attempt);
        }

        // Unknown/network error — retry once after a delay.
        if (attempt === 0) {
          log.warn(`LM request failed (attempt ${attempt + 1}): ${String(err)}. Retrying in ${RETRY_DELAY_MS}ms...`);
          await sleep(RETRY_DELAY_MS);
          continue; // Retry.
        }

        // Second attempt also failed — give up.
        log.warn(`LM request failed after retry: ${String(err)}`);
        throw err;
      }
    }

    // Should never reach here; TypeScript requires return.
    throw new Error("ASCII Agent: Unexpected end of executeRequest loop.");
  }

  /**
   * Handle a `vscode.LanguageModelError` according to PRD §5.6 rules.
   *
   * @param err     - The language model error.
   * @param attempt - Current attempt index (0-based).
   * @returns Never returns normally — always throws.
   */
  function handleLanguageModelError(err: vscode.LanguageModelError, attempt: number): never {
    const msg = err.message.toLowerCase();

    // Quota exceeded — enter cooldown, do not retry.
    if (msg.includes("quota") || msg.includes("rate limit") || err.code === "quota-exceeded") {
      quotaCooldown = true;
      log.warn(`LM quota exceeded. Cooldown for ${QUOTA_COOLDOWN_MS / 1000}s.`);
      cooldownTimer = setTimeout(() => {
        quotaCooldown = false;
        log.info("LM quota cooldown expired.");
      }, QUOTA_COOLDOWN_MS);
      throw err; // Do not retry.
    }

    // Consent not given — show one-time info message.
    if (msg.includes("consent") || msg.includes("not authorized") || err.code === "no-permissions") {
      log.warn("Copilot consent not given. Prompting user.");
      vscode.window.showInformationMessage(
        "ASCII Agent: Please authorize GitHub Copilot to enable architecture diagram generation.",
      );
      throw err; // Do not retry.
    }

    // Generic LM error — retry once.
    if (attempt === 0) {
      log.warn(`LM error (attempt ${attempt + 1}): ${String(err)}. Retrying...`);
      // Caller's loop will retry; throw to break out of sendRequest and trigger the retry.
      throw err;
    }

    log.error(`LM error after retry: ${String(err)}`);
    throw err;
  }

  /**
   * Cancel all currently in-flight LM requests.
   * Called during extension `deactivate()`.
   */
  function cancelAll(): void {
    if (currentRequestCts) {
      currentRequestCts.cancel();
      currentRequestCts.dispose();
      currentRequestCts = undefined;
    }
  }

  /**
   * Returns `true` if a Copilot model is currently available and no cooldown is active.
   */
  function isAvailable(): boolean {
    return cachedModel !== undefined && !quotaCooldown;
  }

  /**
   * Release all resources held by this client instance.
   */
  function dispose(): void {
    cancelAll();
    modelChangeDisposable?.dispose();
    if (cooldownTimer !== undefined) {
      clearTimeout(cooldownTimer);
    }
  }

  return { sendPrompt, cancelAll, isAvailable, dispose };
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

/**
 * Promisified sleep for retry delays.
 *
 * @param ms - Duration to wait in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
