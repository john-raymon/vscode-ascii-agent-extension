# VS Code ASCII Agent — Project Requirements Document (PRD)

> **Version:** 1.0  
> **Author:** Architect Agent  
> **Date:** 2026-02-19  
> **Target Executor:** Autonomous AI Coding Agent  
> **Parent Project:** Word for Word (`word-for-word-game/`)

---

## 0. Document Purpose

This PRD is the **single source of truth** for building the "ASCII Agent" VS Code extension. It is written to be machine-readable by an autonomous coding agent. Every file path, API surface, and behavioral rule is explicit. **Do not infer. Follow exactly.**

---

## 1. Core Objective

Build a VS Code extension that **silently** watches the host workspace and **autonomously** maintains two strictly separated ASCII text diagrams:

| Diagram                     | File                                | Concerns                                           |
| --------------------------- | ----------------------------------- | -------------------------------------------------- |
| **Physical File Tree**      | `<workspace>/docs/file_tree.txt`    | Directory structure, file locations, tags          |
| **Conceptual Architecture** | `<workspace>/docs/architecture.txt` | Data flow, state management, component interaction |

The extension lives **inside** the host project at `tools/vscode-ascii-agent/` and is developed/debugged using VS Code's Extension Host launcher.

> **PORTABILITY RULE (§1.1):** This extension must be a **standalone, publish-ready** VS Code extension. It must contain **zero** hardcoded references to "Word for Word", the parent project's directory layout, or any project-specific file paths. All workspace paths must be resolved dynamically via `vscode.workspace.workspaceFolders`. The extension must function correctly when installed in **any** arbitrary codebase.

---

## 2. Non-Functional Constraints

| Constraint          | Rule                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language            | TypeScript (strict mode)                                                                                                                                              |
| Module system       | ES Modules (`"module": "nodenext"` in tsconfig) — **but** VS Code extensions must compile to CommonJS for the extension host. Use `"module": "commonjs"` in tsconfig. |
| Runtime             | VS Code Extension Host (Node.js)                                                                                                                                      |
| AI integration      | `vscode.lm` API only — **zero** external API keys, **zero** npm AI packages                                                                                           |
| Min VS Code version | `^1.93.0` (LM API was finalized in 1.93)                                                                                                                              |
| Bundle              | `esbuild` bundler (single `out/extension.js`)                                                                                                                         |
| Dependencies        | Keep `dependencies` in `package.json` to **zero** — all functionality from `vscode` API and Node.js built-ins                                                         |
| Code style          | Thorough JSDoc comments on every exported function, interface, and type. Inline comments on non-obvious logic.                                                        |
| Portability         | Zero hardcoded project names or paths. All workspace references via `vscode.workspace.workspaceFolders`. Must work in ANY codebase.                                   |

---

## 3. Directory Structure (Extension)

```
tools/vscode-ascii-agent/
├── .vscode/
│   ├── launch.json          # Extension Host debug config
│   └── tasks.json           # Compile task
├── src/
│   ├── extension.ts         # activate() / deactivate() entry
│   ├── types.ts             # All shared interfaces, enums, config types
│   ├── config.ts            # .asciirc.json loader + defaults
│   ├── watcher.ts           # FileSystemWatcher orchestration + debounce
│   ├── tree-generator.ts    # Pure function: workspace → file_tree.txt string
│   ├── architecture-agent.ts# LM-powered architecture diagram generator
│   ├── history.ts           # Versioning engine (.ascii_history/)
│   ├── lm-client.ts         # Thin wrapper around vscode.lm (model selection, retries, token management)
│   └── utils.ts             # Path helpers, ignore-pattern matching
├── test/
│   └── suite/
│       ├── tree-generator.test.ts
│       └── config.test.ts
├── package.json
├── tsconfig.json
├── esbuild.mjs              # Build script
├── .vscodeignore
└── README.md
```

---

## 4. Configuration (`.asciirc.json`)

The extension looks for `<workspace_root>/.asciirc.json`. If absent, use these defaults:

```jsonc
{
  // Glob patterns for directories/files the file-tree generator should ignore
  "ignore": [
    "node_modules",
    ".git",
    "dist",
    "out",
    ".ascii_history",
    "*.log",
    ".DS_Store",
    "yarn.lock",
    "package-lock.json",
  ],

  // Glob patterns for files whose content changes trigger architecture re-analysis
  // (file tree is regenerated on ANY structural change regardless of this list)
  "architectureWatchPatterns": ["src/**/*.{ts,tsx,js,jsx}", "lib/**/*.{ts,tsx,js,jsx}", "api/**/*.ts"],

  // Where the two output diagrams live, relative to workspace root
  "outputPaths": {
    "fileTree": "docs/file_tree.txt",
    "architecture": "docs/architecture.txt",
  },

  // Debounce window in milliseconds — how long to wait after the last file event
  // before triggering regeneration (prevents burst writes during git operations)
  "debounceMs": 2000,

  // Maximum number of history snapshots to retain in .ascii_history/
  "maxHistorySnapshots": 50,

  // Whether auto-watch is enabled on startup
  "autoWatchEnabled": true,

  // Optional: additional files to feed as context to the architecture LM prompt
  // (e.g. design docs, READMEs). Relative to workspace root.
  "contextFiles": [],

  // Optional: priority-ordered list of glob patterns for token-budget truncation.
  // Files matching earlier patterns are kept; later ones are truncated first.
  // If empty, a generic heuristic is used (see §5.5.2).
  "filePriority": [],

  // Optional: custom tag map for file-tree annotations.
  // Keys are glob patterns, values are tag strings like "[config]".
  // If provided, REPLACES the default tag map entirely.
  // "tags": { "src/components/**": "[ui]", "api/**": "[backend]" }
}
```

**Type:** Define an `AsciiAgentConfig` interface in `src/types.ts` matching this schema exactly.

**Loading rules:**

1. Read `.asciirc.json` from workspace root with `vscode.workspace.fs.readFile`.
2. Deep-merge with defaults (user values override defaults).
3. Validate: `debounceMs` must be ≥ 500. `maxHistorySnapshots` must be ≥ 1.
4. If the file is malformed JSON, log a warning via `vscode.window.showWarningMessage` and fall back to full defaults.
5. Watch `.asciirc.json` itself for changes and hot-reload config when it changes.

---

## 5. Module Specifications

### 5.1 `src/extension.ts` — Entry Point

**`activate(context: vscode.ExtensionContext)`**

1. Load config via `config.ts`.
2. Register all three commands (§6).
3. If `autoWatchEnabled`, immediately start the watcher (§5.3).
4. Push all disposables into `context.subscriptions`.
5. Show a one-time status bar message: `"ASCII Agent: active"` that fades after 3 seconds.

**`deactivate()`**

1. Dispose watchers.
2. Cancel any in-flight LM requests via `CancellationTokenSource.cancel()`.

### 5.2 `src/config.ts` — Configuration Loader

Exports:

- `loadConfig(workspaceRoot: vscode.Uri): Promise<AsciiAgentConfig>`
- `getDefaultConfig(): AsciiAgentConfig`
- `watchConfigFile(workspaceRoot: vscode.Uri, onChange: (cfg: AsciiAgentConfig) => void): vscode.Disposable`

### 5.3 `src/watcher.ts` — File System Watcher Orchestration

**Responsibilities:**

- Create a single `FileSystemWatcher` on `**/*` within the workspace.
- On every `onDidCreate`, `onDidDelete`, `onDidChange` event:
  1. Check if the changed path matches any `ignore` pattern → skip if so.
  2. **Always** schedule a file-tree regeneration (debounced).
  3. If the changed path matches an `architectureWatchPatterns` glob → **also** schedule an architecture regeneration (debounced separately).
- Maintain two independent debounce timers (one for tree, one for architecture).

**Critical edge case — burst protection:**
When a user does `git checkout` or `npm install`, hundreds of file events fire within milliseconds. The debounce timer resets on each event. Only after `debounceMs` of silence does the regeneration fire. This is essential.

**Critical edge case — self-write loop prevention:**
The watcher MUST ignore changes to the output files themselves (`docs/file_tree.txt`, `docs/architecture.txt`) and to `.ascii_history/**`. Otherwise the extension writes a file, detects its own write, and enters an infinite loop.

Exports:

- `startWatching(config: AsciiAgentConfig, context: ExtensionContext, handlers: WatcherHandlers): WatcherSession`
- `stopWatching(session: WatcherSession): void`

```typescript
/** Handlers called when debounce timers expire */
interface WatcherHandlers {
  onTreeRegenNeeded: () => Promise<void>;
  onArchitectureRegenNeeded: () => Promise<void>;
}

/** Disposable session handle */
interface WatcherSession {
  dispose: () => void;
}
```

### 5.4 `src/tree-generator.ts` — File Tree Generator

**This module is PURE — no AI, no LM calls.** It walks the file system and produces the ASCII tree string.

Algorithm:

1. Recursively read directory entries via `vscode.workspace.fs.readDirectory`.
2. Filter out entries matching `ignore` patterns from config.
3. Sort: directories first (alphabetical), then files (alphabetical).
4. Format as a tree using `├──`, `└──`, `│   ` box-drawing characters.
5. **Tagging:** Append inline tags (e.g. `[config]`, `[ui]`, `[logic]`) based on a configurable tag map. Tags are defined in `.asciirc.json` under an optional `"tags"` field. If absent, use these **generic** defaults:

   ```jsonc
   "tags": {
     "*.config.*":     "[config]",
     "*.json":         "[config]",
     "src/components/**": "[ui]",
     "src/**":         "[source]",
     "lib/**":         "[source]",
     "api/**":         "[backend]",
     "docs/**":        "[docs]",
     "test/**":        "[test]",
     "scripts/**":     "[script]"
   }
   ```

   The key is a glob pattern (matched against workspace-relative path), the value is the tag string. User-provided tags in `.asciirc.json` **replace** the defaults entirely (not merged). This keeps the extension fully project-agnostic — no project-specific path assumptions.

6. Prepend the workspace folder name as the root node.
7. Return the full string (do NOT write to disk — caller handles I/O).

Exports:

- `generateFileTree(workspaceRoot: vscode.Uri, config: AsciiAgentConfig): Promise<string>`

### 5.5 `src/architecture-agent.ts` — LM-Powered Architecture Generator

**This is the AI-powered module.** It reads relevant source files and asks the LM to produce/update the architecture diagram.

**Flow:**

1. Gather context: read all files matching `architectureWatchPatterns` (up to a token budget — see §7).
2. Read the **current** architecture output file (if it exists) as the "previous version."
3. Optionally read a project context file if specified in config (see `contextFiles` in §4).
4. Construct a system prompt (see §5.5.1). Inject the workspace folder name dynamically — **never hardcode a project name.**
5. Call `vscode.lm` via the `lm-client.ts` wrapper.
6. Parse the response — extract only the ASCII diagram portion.
7. Return the new diagram string (do NOT write to disk — caller handles I/O).

**5.5.1 System Prompt Template:**

```
You are an ASCII architecture diagram generator for the software project "{workspace_folder_name}".

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

Generate the updated architecture diagram now.
```

**5.5.2 Token Budget Management:**

The `vscode.lm` API does not expose a tokenizer, but `LanguageModelChat` objects expose `countTokens(text)` method. Use it.

- **Input budget:** Reserve 80% of the model's `maxInputTokens` for the prompt (source code + system instructions).
- **If over budget:** Prioritize files using the optional `"filePriority"` array from `.asciirc.json` (see §4). If not configured, use a generic heuristic:
  1. Any files listed in `contextFiles` config.
  2. Files in `src/` or `lib/` root (entry points).
  3. Files in subdirectories matching `architectureWatchPatterns`, alphabetically.
  4. Everything else — truncate or omit.

Exports:

- `generateArchitectureDiagram(config: AsciiAgentConfig, workspaceRoot: vscode.Uri, lmClient: LmClient): Promise<string>`

### 5.6 `src/lm-client.ts` — Language Model Wrapper

A thin, reusable wrapper around `vscode.lm`.

**Responsibilities:**

- Model selection: call `vscode.lm.selectChatModels({ vendor: 'copilot' })` and pick the first available model. Cache the model reference. Re-select on `vscode.lm.onDidChangeChatModels`.
- Request execution: accept an array of `LanguageModelChatMessage`, send via `model.sendRequest()`, stream the response, and return the full text.
- Cancellation: maintain a `CancellationTokenSource` per request. Expose `cancelAll()` for deactivation.
- Error handling:
  - `LanguageModelError` with quota exceeded → log warning, set a cooldown flag (60 seconds), do NOT retry.
  - `LanguageModelError` with consent not given → show a one-time info message asking the user to authorize Copilot.
  - Network/unknown errors → retry once after 3 seconds, then give up with a logged warning.
- **Rate limiting (critical):** Maintain an internal mutex/queue so that only **one** LM request is in-flight at a time. If a new request arrives while one is pending, **cancel** the old one and start the new one (last-write-wins). This prevents quota exhaustion when multiple file saves trigger near-simultaneous architecture regenerations.

```typescript
interface LmClient {
  sendPrompt(messages: vscode.LanguageModelChatMessage[], token?: vscode.CancellationToken): Promise<string>;
  cancelAll(): void;
  isAvailable(): boolean;
  dispose(): void;
}
```

Exports:

- `createLmClient(): LmClient`

### 5.7 `src/history.ts` — Versioning Engine

**Before** the caller writes a new `docs/architecture.txt`, it must call the history engine to snapshot the previous version.

Storage: `<workspace_root>/.ascii_history/`

File naming: `architecture_<ISO8601_timestamp>.txt`  
Example: `architecture_2026-02-19T14-30-00-000Z.txt`

**Rotation:** After writing a snapshot, count all files in `.ascii_history/`. If count exceeds `maxHistorySnapshots`, delete the oldest files until count equals the max minus 1 (to make room). Use file modification time for ordering.

**Important:** Do NOT version `file_tree.txt`. It is deterministic and can be regenerated instantly. Only `architecture.txt` (which involves AI judgment) gets versioned.

Exports:

- `saveSnapshot(workspaceRoot: vscode.Uri, currentContent: string): Promise<void>`
- `pruneSnapshots(workspaceRoot: vscode.Uri, maxSnapshots: number): Promise<void>`

### 5.8 `src/utils.ts` — Utilities

- `matchesAnyPattern(filePath: string, patterns: string[]): boolean` — test a workspace-relative path against an array of glob patterns. Use `vscode.RelativePattern` or a minimal glob-match implementation (no npm packages).
- `workspaceRelativePath(uri: vscode.Uri, workspaceRoot: vscode.Uri): string` — convert absolute URI to workspace-relative string.
- `ensureDirectoryExists(uri: vscode.Uri): Promise<void>` — create directory (and parents) if missing, using `vscode.workspace.fs.createDirectory`.

### 5.9 `src/types.ts` — Shared Types

All interfaces, enums, and type aliases live here. At minimum:

```typescript
/** Full configuration schema matching .asciirc.json */
export interface AsciiAgentConfig {
  ignore: string[];
  architectureWatchPatterns: string[];
  outputPaths: {
    fileTree: string;
    architecture: string;
  };
  debounceMs: number;
  maxHistorySnapshots: number;
  autoWatchEnabled: boolean;
  /** Optional extra files to feed as context to the LM prompt */
  contextFiles: string[];
  /** Optional priority-ordered globs for token-budget truncation */
  filePriority: string[];
  /** Optional custom tag map (glob → tag string). Replaces defaults if provided. */
  tags?: Record<string, string>;
}

/** State of the auto-watcher */
export enum WatcherState {
  Active = "active",
  Paused = "paused",
  Disabled = "disabled",
}

/** Result of a diagram generation attempt */
export interface GenerationResult {
  success: boolean;
  diagramContent?: string;
  error?: string;
  durationMs: number;
}
```

---

## 6. Commands

Register in `package.json` under `contributes.commands`:

| Command ID                   | Title                            | Behavior                                                                                                                                                                                  |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asciiAgent.initialize`      | `ASCII Agent: Initialize`        | Creates `docs/` dir if missing, creates `.asciirc.json` with defaults if missing, runs both generators once immediately, shows completion notification.                                   |
| `asciiAgent.generateNow`     | `ASCII Agent: Generate Now`      | Manually triggers both file-tree and architecture regeneration right now. Shows a progress notification (`vscode.window.withProgress`) with a cancellation button.                        |
| `asciiAgent.toggleAutoWatch` | `ASCII Agent: Toggle Auto-Watch` | Flips the watcher between active and paused. Displays current state in an info message: "Auto-watch is now ON/OFF". Does NOT persist the toggle to `.asciirc.json` — it resets on reload. |

---

## 7. Edge Cases & Architect Decisions

### 7.1 LM API Unavailability

If no Copilot model is available (user not signed in, no Copilot license, offline):

- `file_tree.txt` generation works normally (no AI needed).
- `architecture.txt` generation is **skipped silently**. A debug-level log is written. No error popups.
- The `ASCII Agent: Generate Now` command should show a warning: "Copilot model not available — only file tree was regenerated."

### 7.2 Empty Workspace

If the workspace has no folders open → do nothing. Log and exit `activate()` early.

### 7.3 Multi-Root Workspace

Use `vscode.workspace.workspaceFolders[0]` only. Log a warning if multiple roots are detected: "ASCII Agent only monitors the first workspace folder."

### 7.4 Output File Doesn't Exist

If `docs/file_tree.txt` or `docs/architecture.txt` don't exist yet, create them. Ensure `docs/` directory exists first.

### 7.5 Concurrent Generation Requests

The debounce handles most concurrency. But if a user runs `Generate Now` while a debounced generation is pending:

- Cancel the pending debounced operation.
- Execute the manual generation immediately.
- The manual generation takes priority.

### 7.6 Large Workspaces

The file-tree generator should cap at **5000 entries**. If the workspace has more, truncate and append:

```
... (truncated: X more entries not shown)
```

### 7.7 `.ascii_history/` in `.gitignore`

The `ASCII Agent: Initialize` command should check if `.gitignore` exists and if `.ascii_history/` is listed. If not, **prompt** the user (do not auto-modify): "Add .ascii_history/ to .gitignore?"

---

## 8. `package.json` (Extension Manifest)

```jsonc
{
  "name": "vscode-ascii-agent",
  "displayName": "ASCII Agent",
  "description": "Silently maintains ASCII file-tree and architecture diagrams for your workspace.",
  "version": "0.0.1",
  "publisher": "word-for-word",
  "engines": {
    "vscode": "^1.93.0",
  },
  "categories": ["Other"],
  "activationEvents": ["workspaceContains:**/.asciirc.json", "onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "asciiAgent.initialize",
        "title": "ASCII Agent: Initialize",
      },
      {
        "command": "asciiAgent.generateNow",
        "title": "ASCII Agent: Generate Now",
      },
      {
        "command": "asciiAgent.toggleAutoWatch",
        "title": "ASCII Agent: Toggle Auto-Watch",
      },
    ],
  },
  "scripts": {
    "vscode:prepublish": "node esbuild.mjs --production",
    "compile": "node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "lint": "eslint src/",
    "test": "vscode-test",
  },
  "devDependencies": {
    "@types/vscode": "^1.93.0",
    "@types/node": "^20.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0",
    "@vscode/test-cli": "^0.0.10",
    "@vscode/test-electron": "^2.4.0",
  },
}
```

**Critical:** `"dependencies"` must remain **empty**. All runtime code uses Node.js built-ins and the `vscode` API.

---

## 9. `tsconfig.json` (Extension)

```jsonc
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out", "test"],
}
```

---

## 10. `esbuild.mjs` (Build Script)

Bundle all TypeScript into a single `out/extension.js`. Mark `vscode` as external. Enable source maps for debugging.

```javascript
import * as esbuild from "esbuild";

const isProduction = process.argv.includes("--production");
const isWatch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: "info",
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
}
```

---

## 11. `.vscode/launch.json` (Debug Config)

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run ASCII Agent Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/tools/vscode-ascii-agent"],
      "outFiles": ["${workspaceFolder}/tools/vscode-ascii-agent/out/**/*.js"],
      "preLaunchTask": "compile-ascii-agent",
    },
  ],
}
```

---

## 12. `.vscode/tasks.json` (Compile Task)

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "compile-ascii-agent",
      "type": "shell",
      "command": "node esbuild.mjs",
      "options": {
        "cwd": "${workspaceFolder}/tools/vscode-ascii-agent",
      },
      "group": "build",
      "problemMatcher": ["$tsc"],
    },
    {
      "label": "watch-ascii-agent",
      "type": "shell",
      "command": "node esbuild.mjs --watch",
      "options": {
        "cwd": "${workspaceFolder}/tools/vscode-ascii-agent",
      },
      "isBackground": true,
      "group": "build",
      "problemMatcher": ["$esbuild-watch"],
    },
  ],
}
```

---

## 13. Implementation Phases

The coding agent MUST implement in this exact order, testing each phase before proceeding.

### Phase 1: Scaffold & Config (files: `package.json`, `tsconfig.json`, `esbuild.mjs`, `types.ts`, `config.ts`, `extension.ts` stub, `.vscode/*`)

1. Create the full directory structure.
2. Write `package.json`, `tsconfig.json`, `esbuild.mjs`, `.vscodeignore`.
3. Write `src/types.ts` with all interfaces and enums.
4. Write `src/config.ts` with config loading, defaults, validation, hot-reload watcher.
5. Write `src/extension.ts` as a minimal stub that loads config and logs "ASCII Agent activated."
6. Write `.vscode/launch.json` and `.vscode/tasks.json`.
7. Run `npm install` inside `tools/vscode-ascii-agent/`.
8. Verify: `node esbuild.mjs` compiles without errors.

### Phase 2: File Tree Generator (files: `utils.ts`, `tree-generator.ts`)

1. Write `src/utils.ts` with all utility functions.
2. Write `src/tree-generator.ts` per §5.4.
3. Wire into `extension.ts`: register the `asciiAgent.initialize` command to generate and write the file tree.
4. Verify: run the extension, execute `ASCII Agent: Initialize`, confirm `docs/file_tree.txt` is written with correct content.

### Phase 3: History Engine (files: `history.ts`)

1. Write `src/history.ts` per §5.7.
2. Verify: call `saveSnapshot` manually and confirm `.ascii_history/` is created with a timestamped file.

### Phase 4: LM Client (files: `lm-client.ts`)

1. Write `src/lm-client.ts` per §5.6.
2. Verify: in the debug extension host, call `sendPrompt` with a simple test message and confirm a response is received.

### Phase 5: Architecture Agent (files: `architecture-agent.ts`)

1. Write `src/architecture-agent.ts` per §5.5.
2. Wire into `extension.ts`: the `asciiAgent.generateNow` command calls both generators and writes results.
3. Before writing architecture, call `history.saveSnapshot`.
4. Verify: run `ASCII Agent: Generate Now`, confirm both files are updated and a history snapshot exists.

### Phase 6: Watcher (files: `watcher.ts`)

1. Write `src/watcher.ts` per §5.3.
2. Wire into `extension.ts`: auto-start watcher on activation if config allows. Register `asciiAgent.toggleAutoWatch`.
3. Verify: create a new file in `src/`, wait for debounce, confirm `file_tree.txt` is updated.

### Phase 7: Polish & Edge Cases

1. Implement all edge cases from §7.
2. Add `.gitignore` prompt logic in `asciiAgent.initialize`.
3. Add progress notifications to `asciiAgent.generateNow`.
4. Final compile, test all three commands, confirm no infinite loops.

---

## 14. Testing Strategy

- **Unit tests** for `tree-generator.ts` (mock `vscode.workspace.fs`) and `config.ts` (mock file reads).
- **Integration testing** via the Extension Host debugger — manually exercise all three commands and the watcher.
- **Regression:** After every phase, re-run `node esbuild.mjs` and confirm zero TypeScript errors.

---

## 15. Files the Extension Must NEVER Modify

- Any file outside the workspace root.
- `package.json`, `tsconfig.json`, or any root config of the host project.
- `.git/` contents.
- Only modify: `docs/file_tree.txt`, `docs/architecture.txt`, `.ascii_history/*`, `.asciirc.json` (only during Initialize), and `.gitignore` (only if user consents via prompt during Initialize).

---

## 16. Status Bar UX

- On activation: show `$(eye) ASCII Agent` in the status bar (left side). Clicking it runs `asciiAgent.toggleAutoWatch`.
- When watcher is paused: change icon to `$(eye-closed) ASCII Agent (paused)`.
- During generation: change to `$(sync~spin) ASCII Agent: generating...` briefly.

---

## 17. Logging

Use `vscode.window.createOutputChannel('ASCII Agent')` for all diagnostic logging. Levels:

- **Info:** activation, config loaded, generation complete (with duration).
- **Warning:** config malformed, LM unavailable, multi-root detected.
- **Error:** file I/O failures, LM errors after retry.

Never use `console.log` — always use the output channel.

---

## 18. `.vscodeignore`

```
.vscode/**
src/**
test/**
node_modules/**
tsconfig.json
esbuild.mjs
*.map
.ascii_history/**
PRD.md
```

---

## 19. Risks & Mitigations

| Risk                                               | Mitigation                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------- |
| `vscode.lm.selectChatModels` returns empty array   | Graceful degradation: skip architecture gen, file tree still works.                        |
| Quota exceeded on Copilot LM                       | 60-second cooldown, single-request mutex, debounce prevents burst.                         |
| Infinite write loop (extension detects own output) | Output paths and `.ascii_history/` are in ignore list; explicit URI comparison in watcher. |
| Burst file events from git/npm                     | Debounce timer resets on every event; only fires after sustained silence.                  |
| Model produces markdown-fenced or preamble text    | Post-processing: strip any lines before the first `+` or `                                 | `character, and after the last`+`or` | ` character that completes a box. Also strip ``` fences. |
| User has no `docs/` directory                      | `Initialize` command creates it. Generators also `ensureDirectoryExists` before writing.   |

---

## 20. Portability & Open-Source Readiness

This section reinforces §1.1 with specific rules the coding agent must follow:

1. **No project name literals.** The strings "Word for Word", "word-for-word-game", "cat", "sentence", "coherence" etc. must NEVER appear in any source file. The extension is project-agnostic.
2. **Dynamic workspace root.** Always resolve via `vscode.workspace.workspaceFolders[0].uri`. Never assume a directory name.
3. **Config-driven paths.** Output paths (`docs/file_tree.txt`, `docs/architecture.txt`) come from `AsciiAgentConfig.outputPaths`, not hardcoded strings in business logic.
4. **Config-driven tags.** The file-tree tagging system uses `AsciiAgentConfig.tags` (or generic defaults). No project-specific path→tag mappings in code.
5. **Config-driven context.** The architecture agent reads `AsciiAgentConfig.contextFiles` for supplementary context. It does NOT hardcode specific markdown files.
6. **The system prompt** injects `{workspace_folder_name}` dynamically — derived from the workspace folder's basename at runtime.
7. **Self-contained.** The extension has zero runtime dependencies, zero references to parent `package.json`, and can be copied to a standalone repository and published to the VS Code Marketplace without modification.

---

_End of PRD._
