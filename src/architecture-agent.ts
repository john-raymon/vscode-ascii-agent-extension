/**
 * @file architecture-agent.ts
 * @description LM-powered architecture diagram generator.
 *
 * Flow (PRD §5.5):
 * 1. Gather context: read files matching `architectureWatchPatterns` (within token budget).
 * 2. Read the current architecture output (if it exists) as "previous version."
 * 3. Optionally read `contextFiles` from config.
 * 4. Construct a system prompt, injecting workspace folder name dynamically.
 * 5. Call `vscode.lm` via `LmClient`.
 * 6. Post-process: strip markdown fences / preamble text from the response.
 * 7. Return the cleaned diagram string (caller handles disk I/O).
 */

import * as vscode from "vscode";
import type { AsciiAgentConfig, LmClient } from "./types";
import { matchesAnyPattern } from "./utils";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Fraction of the model's `maxInputTokens` budget reserved for source code context.
 * The remaining 20% is for system instructions and response headroom.
 */
const INPUT_BUDGET_FRACTION = 0.8;

// ---------------------------------------------------------------------------
// System Prompt Template
// ---------------------------------------------------------------------------

/**
 * System prompt template string.
 * Placeholders (all replaced dynamically at runtime — never hardcoded):
 * - `{workspace_folder_name}` — basename of the workspace root folder.
 * - `{previous_architecture}` — content of current `docs/architecture.txt` (or "N/A").
 * - `{context_files_content}` — concatenated content of `config.contextFiles` (or "N/A").
 * - `{source_files_content}` — concatenated source files within token budget.
 */
const SYSTEM_PROMPT_TEMPLATE = `You are an ASCII architecture diagram generator for the software project "{workspace_folder_name}".

Your job is to produce a CONCEPTUAL data-flow diagram in pure ASCII art. The diagram must show:
- Major logical modules and their responsibilities
- Data flow between modules (arrows: ---> )
- State management cycles
- External API interactions
- Feedback loops

RULES:
1. Output ONLY the ASCII diagram. No markdown fences, no explanation text before or after.
2. Use box-drawing characters: +, -, |, > for arrows.
3. Keep column width under 100 characters.
4. Include a "Feedback loops:" text section at the bottom listing cyclic dependencies.
5. Do NOT include file paths or directory structure. This is a CONCEPTUAL diagram, not a physical one.
6. If a previous diagram is provided, preserve its general layout and only update sections that have changed based on the new source code. Do not gratuitously reorganize.

PREVIOUS DIAGRAM:
{previous_architecture}

PROJECT CONTEXT (if available):
{context_files_content}

SOURCE CODE CONTEXT:
{source_files_content}

Generate the updated architecture diagram now.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the architecture diagram using the Copilot LM.
 *
 * @param config        - Active `AsciiAgentConfig` (watch patterns, context files, etc.)
 * @param workspaceRoot - Absolute URI of the workspace root.
 * @param lmClient      - Initialized `LmClient` instance to use for the LM call.
 * @param token         - Optional external cancellation token (e.g. from progress dialog).
 * @returns The cleaned ASCII diagram string (ready to write to disk).
 */
export async function generateArchitectureDiagram(
  config: AsciiAgentConfig,
  workspaceRoot: vscode.Uri,
  lmClient: LmClient,
  token?: vscode.CancellationToken,
): Promise<string> {
  // 1. Select the model to determine token budget.
  const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
  const model = models[0];
  const tokenBudget = model ? Math.floor(model.maxInputTokens * INPUT_BUDGET_FRACTION) : 8000; // Fallback budget if model metadata is unavailable.

  // 2. Gather source file context within token budget.
  const sourceContent = await gatherSourceContext(config, workspaceRoot, tokenBudget, model);

  // 3. Read previous architecture diagram (if it exists).
  const previousArchitecture = await readPreviousArchitecture(config, workspaceRoot);

  // 4. Read optional context files.
  const contextFilesContent = await readContextFiles(config, workspaceRoot);

  // 5. Derive workspace folder name dynamically — never hardcoded.
  const workspaceFolderName =
    workspaceRoot.path.split("/").filter(Boolean).pop() ??
    workspaceRoot.fsPath.split(/[\\/]/).filter(Boolean).pop() ??
    "workspace";

  // 6. Build the prompt by substituting all template placeholders.
  const promptText = SYSTEM_PROMPT_TEMPLATE.replace("{workspace_folder_name}", workspaceFolderName)
    .replace("{previous_architecture}", previousArchitecture || "N/A")
    .replace("{context_files_content}", contextFilesContent || "N/A")
    .replace("{source_files_content}", sourceContent || "N/A");

  log.info(`Sending architecture prompt (~${promptText.length} chars) to LM.`);

  // 7. Send the prompt to the LM.
  const messages = [vscode.LanguageModelChatMessage.User(promptText)];

  const rawResponse = await lmClient.sendPrompt(messages, token);

  // 8. Post-process: strip markdown fences and any preamble text.
  const cleaned = postProcessResponse(rawResponse);

  log.info(`Architecture diagram received (${cleaned.length} chars).`);

  return cleaned;
}

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

/**
 * Gather source file content for the LM prompt, respecting the token budget.
 *
 * Priority order (PRD §5.5.2):
 * 1. Files matching `config.filePriority` glob patterns (in order).
 * 2. Heuristic fallback: `contextFiles`, then `src/`/`lib/` roots, then alphabetical.
 *
 * If the model supports `countTokens`, use it to measure. Otherwise use a
 * character-count heuristic (~4 chars per token).
 *
 * @param config        - Active config.
 * @param workspaceRoot - Workspace root URI.
 * @param tokenBudget   - Max tokens available for source content.
 * @param model         - LM model (for `countTokens`), may be undefined.
 * @returns Concatenated source file contents, possibly truncated.
 */
async function gatherSourceContext(
  config: AsciiAgentConfig,
  workspaceRoot: vscode.Uri,
  tokenBudget: number,
  model: vscode.LanguageModelChat | undefined,
): Promise<string> {
  // Collect all files matching architectureWatchPatterns.
  const allCandidates = await collectCandidateFiles(config, workspaceRoot);

  // Sort candidates by priority.
  const prioritized = prioritizeFiles(allCandidates, config);

  // Read and accumulate within token budget.
  const sections: string[] = [];
  let usedTokens = 0;

  for (const relPath of prioritized) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, relPath);
    let content: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      content = Buffer.from(bytes).toString("utf-8");
    } catch {
      continue; // Skip unreadable files.
    }

    const fileSection = `// File: ${relPath}\n${content}\n`;

    // Estimate token count.
    const tokenCount = model ? await safeCountTokens(model, fileSection) : Math.ceil(fileSection.length / 4);

    if (usedTokens + tokenCount > tokenBudget) {
      log.info(`Token budget reached. Skipping ${relPath} and remaining files.`);
      break; // Stop adding files.
    }

    sections.push(fileSection);
    usedTokens += tokenCount;
  }

  return sections.join("\n---\n");
}

/**
 * Collect all files in the workspace that match any `architectureWatchPatterns` glob,
 * excluding paths matching `ignore` patterns.
 *
 * @param config        - Active config.
 * @param workspaceRoot - Workspace root URI.
 * @returns Sorted list of workspace-relative file paths.
 */
async function collectCandidateFiles(config: AsciiAgentConfig, workspaceRoot: vscode.Uri): Promise<string[]> {
  const candidates: string[] = [];

  /** Recursively walk a directory, collecting matching files. */
  async function walk(dirUri: vscode.Uri, relBase: string): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      const relPath = relBase ? `${relBase}/${name}` : name;

      // Skip ignored paths.
      if (matchesAnyPattern(relPath, config.ignore) || matchesAnyPattern(name, config.ignore)) {
        continue;
      }

      if (type === vscode.FileType.Directory) {
        await walk(vscode.Uri.joinPath(dirUri, name), relPath);
      } else if (type === vscode.FileType.File) {
        // Include if it matches any architectureWatchPattern.
        if (matchesAnyPattern(relPath, config.architectureWatchPatterns)) {
          candidates.push(relPath);
        }
      }
    }
  }

  await walk(workspaceRoot, "");
  return candidates.sort();
}

/**
 * Sort candidate file paths by priority (PRD §5.5.2).
 *
 * If `config.filePriority` is non-empty, use that ordering.
 * Otherwise use heuristic: `contextFiles` first, then `src/`/`lib/` roots, then alphabetical.
 *
 * @param candidates - All candidate file paths.
 * @param config     - Active config.
 * @returns Re-ordered list.
 */
function prioritizeFiles(candidates: string[], config: AsciiAgentConfig): string[] {
  if (config.filePriority.length > 0) {
    // Priority-ordered: assign a score based on which filePriority pattern matches first.
    return [...candidates].sort((a, b) => {
      const scoreA = getPriorityScore(a, config.filePriority);
      const scoreB = getPriorityScore(b, config.filePriority);
      // Lower score = higher priority.
      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }
      return a.localeCompare(b);
    });
  }

  // Generic heuristic (PRD §5.5.2):
  // 1. contextFiles (if they appear in candidates)
  // 2. src/ or lib/ root-level files (depth 2)
  // 3. Everything else alphabetically.
  const contextSet = new Set(config.contextFiles);

  return [...candidates].sort((a, b) => {
    const aScore = heuristicScore(a, contextSet);
    const bScore = heuristicScore(b, contextSet);
    if (aScore !== bScore) {
      return aScore - bScore;
    }
    return a.localeCompare(b);
  });
}

/**
 * Return the priority score for a path given ordered filePriority patterns.
 * Lower index → higher priority. Unmatched files get score = pattern count.
 *
 * @param path          - Workspace-relative path.
 * @param filePriority  - Ordered priority glob patterns.
 * @returns Numeric priority score.
 */
function getPriorityScore(path: string, filePriority: string[]): number {
  for (let i = 0; i < filePriority.length; i++) {
    if (matchesAnyPattern(path, [filePriority[i]])) {
      return i;
    }
  }
  return filePriority.length; // Lowest priority.
}

/**
 * Compute a heuristic priority score for a file path.
 *
 * @param path       - Workspace-relative path.
 * @param contextSet - Set of contextFiles paths.
 * @returns Numeric score (lower = higher priority).
 */
function heuristicScore(path: string, contextSet: Set<string>): number {
  if (contextSet.has(path)) {
    return 0; // Highest priority.
  }
  // src/ or lib/ direct children (e.g. "src/app.ts" has 1 slash after the dir).
  const parts = path.split("/");
  const inRoot = (parts[0] === "src" || parts[0] === "lib") && parts.length === 2;
  if (inRoot) {
    return 1;
  }
  // Other src/lib subdirectory files.
  if (parts[0] === "src" || parts[0] === "lib") {
    return 2;
  }
  return 3; // Everything else.
}

// ---------------------------------------------------------------------------
// Previous diagram & context file readers
// ---------------------------------------------------------------------------

/**
 * Read the current `docs/architecture.txt` content as the "previous version."
 * Returns an empty string if the file doesn't exist.
 *
 * @param config        - Active config (for `outputPaths.architecture`).
 * @param workspaceRoot - Workspace root URI.
 * @returns Previous diagram content, or empty string.
 */
async function readPreviousArchitecture(config: AsciiAgentConfig, workspaceRoot: vscode.Uri): Promise<string> {
  try {
    const archUri = vscode.Uri.joinPath(workspaceRoot, config.outputPaths.architecture);
    const bytes = await vscode.workspace.fs.readFile(archUri);
    return Buffer.from(bytes).toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Read all files listed in `config.contextFiles` and concatenate their contents.
 *
 * @param config        - Active config.
 * @param workspaceRoot - Workspace root URI.
 * @returns Concatenated context, or empty string if no files specified.
 */
async function readContextFiles(config: AsciiAgentConfig, workspaceRoot: vscode.Uri): Promise<string> {
  if (config.contextFiles.length === 0) {
    return "";
  }

  const parts: string[] = [];
  for (const relPath of config.contextFiles) {
    try {
      const fileUri = vscode.Uri.joinPath(workspaceRoot, relPath);
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      parts.push(`// Context file: ${relPath}\n${Buffer.from(bytes).toString("utf-8")}`);
    } catch {
      log.warn(`Could not read context file: ${relPath}`);
    }
  }
  return parts.join("\n---\n");
}

// ---------------------------------------------------------------------------
// Response post-processing
// ---------------------------------------------------------------------------

/**
 * Clean the raw LM response to extract only the ASCII diagram.
 *
 * Per PRD §19 (model produces markdown-fenced or preamble text mitigation):
 * - Strip ``` code fences.
 * - Strip any lines before the first `+` or `|` character (diagram start indicators).
 * - Strip any lines after the last `+` or `|` that completes the diagram.
 *
 * @param raw - Raw text response from the LM.
 * @returns Cleaned ASCII diagram string.
 */
function postProcessResponse(raw: string): string {
  // 1. Remove markdown code fences (``` or ```ascii, etc.)
  let cleaned = raw.replace(/^```[a-z]*\n?/gm, "").replace(/^```\n?/gm, "");

  // 2. Split into lines for boundary detection.
  const lines = cleaned.split("\n");

  // Find the first line that looks like it's part of an ASCII diagram.
  // Indicators: lines starting with `+`, `|`, or containing `---`.
  const firstDiagramLine = lines.findIndex((line) => /^[+|]/.test(line.trim()) || /^[-+]{3,}/.test(line.trim()));

  // Find the last such line.
  let lastDiagramLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^[+|]/.test(lines[i].trim()) || /^[-+]{3,}/.test(lines[i].trim())) {
      lastDiagramLine = i;
      break;
    }
  }

  // If we found diagram boundaries, trim to them. Otherwise return as-is.
  if (firstDiagramLine !== -1 && lastDiagramLine !== -1 && firstDiagramLine <= lastDiagramLine) {
    cleaned = lines.slice(firstDiagramLine, lastDiagramLine + 1).join("\n");
  }

  return cleaned.trim() + "\n";
}

// ---------------------------------------------------------------------------
// Token counting helper
// ---------------------------------------------------------------------------

/**
 * Safely call `model.countTokens()`. Falls back to character-count heuristic on error.
 *
 * @param model - LM model with `countTokens` support.
 * @param text  - Text to measure.
 * @returns Estimated token count.
 */
async function safeCountTokens(model: vscode.LanguageModelChat, text: string): Promise<number> {
  try {
    // countTokens accepts a string or a LanguageModelChatMessage array.
    const count = await model.countTokens(text);
    return count;
  } catch {
    // Fallback: rough estimate of 4 chars per token.
    return Math.ceil(text.length / 4);
  }
}
