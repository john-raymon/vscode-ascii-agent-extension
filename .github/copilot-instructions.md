# ASCII Agent — Copilot Instructions

## What this extension does

ASCII Agent silently watches a VS Code workspace and autonomously maintains two markdown diagram files:

- **file_tree.md** — physical file tree rendered in pure ASCII (no AI involved)
- **architecture.md** — conceptual data-flow diagram generated via the `vscode.lm` Copilot chat API

Three commands are exposed: `ASCII Agent: Initialize`, `ASCII Agent: Generate Now`, `ASCII Agent: Toggle Auto-Watch`.

Configuration lives in `.asciirc.json` at the workspace root (JSONC format, deep-merged over compiled defaults).

**Constraints:** zero npm runtime dependencies, fully portable, no hardcoded paths.

---

## Source file roles

| File                    | Role                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `extension.ts`          | Entry point — command registration, activation/deactivation lifecycle                    |
| `lm-client.ts`          | `vscode.lm` wrapper — async model selection, last-write-wins cancellation, retry logic   |
| `architecture-agent.ts` | LM prompt construction, token budget management, response post-processing                |
| `watcher.ts`            | `FileSystemWatcher` — dual independent debounce timers, self-write loop prevention       |
| `tree-generator.ts`     | Pure recursive ASCII file tree generator (no AI)                                         |
| `history.ts`            | Timestamped snapshots written to `.ascii_history/` with mtime-based rotation             |
| `config.ts`             | `.asciirc.json` loader — JSONC parsing, deep-merge over defaults, validation, hot-reload |
| `utils.ts`              | Glob matching (no npm deps), path helpers                                                |
| `types.ts`              | All shared interfaces, enums, and type aliases                                           |
| `logger.ts`             | Singleton VS Code output channel                                                         |

---

## Key architectural decisions — do not "fix" these

These are intentional design choices. Do not refactor them away.

### 1. `logger.ts` singleton breaks circular imports

All modules import logging via `import { log } from './logger'`. The singleton exists solely to avoid circular dependency chains that would occur if modules imported from `extension.ts`. Never replace this with a logger passed through constructors or imported from `extension.ts`.

### 2. `LmClient.isAvailable()` is async

`isAvailable()` awaits the initial model-selection promise before returning. This prevents a race condition where the extension activates before Copilot has resolved its available models. Do not make it synchronous.

### 3. Output files are markdown-wrapped diagrams

Both output files use the format:

```
# Title

\`\`\`
<diagram content>
\`\`\`
```

The function `stripMarkdownCodeBlock()` peels this wrapper before feeding a previous diagram back to the LM as context. Do not change the output format or remove `stripMarkdownCodeBlock()`.

### 4. `watcher.ts` builds an `outputFilePaths` Set

On startup and config reload, `watcher.ts` constructs a `Set<string>` of the resolved output file paths (`file_tree.md`, `architecture.md`). Every file-change event is checked against this set to skip changes caused by the extension's own writes. Do not remove this guard — without it, every write triggers infinite regeneration.

### 5. `extensionDependencies` ensures Copilot activates first

`package.json` declares `"extensionDependencies": ["github.copilot-chat"]`. This guarantees the Copilot extension is active before ASCII Agent activates, so `vscode.lm.selectChatModels()` resolves correctly. Do not remove this dependency.

---

## Coding standards

- **Comments:** all non-trivial functions must have a JSDoc comment explaining intent, not just what the code does.
- **Async/await:** use `async/await` throughout; avoid raw `.then()` chains.
- **Types:** all function parameters, return types, and shared data structures must use typed interfaces or enums defined in `types.ts`. No `any`.
- **No hardcoded paths:** all paths must be derived from `vscode.workspace.workspaceFolders`, config values, or constants — never as string literals.
- **No runtime npm dependencies:** all utilities must be implemented inline (see `utils.ts` for glob matching).
- **Strict mode:** `tsconfig.json` enforces `"strict": true`. All code must compile cleanly under strict mode.

---

## Build and verify

After any change, both of these must pass with zero errors:

```bash
node esbuild.mjs && npx tsc --noEmit
```

- `node esbuild.mjs` — bundles the extension via esbuild (CommonJS output)
- `npx tsc --noEmit` — type-checks all source files under strict mode without emitting

Do not ship a change that causes either command to fail.

---

## Output file format

Both managed files share the same markdown-wrapped structure:

**file_tree.md**

```markdown
# File Tree

\`\`\`
<ASCII tree output from tree-generator.ts>
\`\`\`
```

**architecture.md**

```markdown
# Architecture

\`\`\`
<ASCII data-flow diagram from LM response>
\`\`\`
```

When passing a previous diagram back to the LM as context, always call `stripMarkdownCodeBlock()` first to extract only the raw diagram content.
