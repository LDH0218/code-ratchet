---
name: ratchet
description: Manage code-ratchet guardrails (.ratchet.json) via /ratchet — initialize tiered file & function-size baselines, run checks, tighten watermarks, or inspect harness status across frontend and backend languages. Also triggered by the /ratchet slash command.
argument-hint: "[init | check | tighten | update | status]"
license: MIT
---

# /ratchet — Code Ratchet Guardrails

Manage `.ratchet.json` baselines (tiered file caps: UI 450 / scripts 600 / backend 900 lines, 120-line single-function cap, DTO/test/generated auto-exemption, and language-specific anti-pattern budgets).

## Resolve CLI Runner

Locate the installed zero-dependency runner in this order (fastest & works offline without npm registry):
1. `"${CLAUDE_PLUGIN_ROOT}/bin/code-ratchet.mjs"` (when loaded as a Claude / Codex plugin)
2. `"$HOME/.code-ratchet/runtime/bin/code-ratchet.mjs"` (when installed via `code-ratchet install`)
3. `"$HOME/.gemini/config/plugins/code-ratchet/bin/code-ratchet.mjs"` (when installed as an Antigravity plugin)
4. Fallback: `npx code-ratchet`

## Slash Command Subcommands

Interpret `/ratchet [subcommand]` (default to `check` when `.ratchet.json` exists in workspace root, otherwise `init`):

- **`/ratchet init`** (or `/ratchet` in an uninitialized repo):
  Run `<runner> init .` to auto-detect project languages and freeze existing file/function/anti-pattern baselines without failing on legacy debt.
- **`/ratchet check`**:
  Run `<runner> check .` and fix every reported regression before finishing.
- **`/ratchet tighten`**:
  Run `<runner> tighten .` after refactoring to permanently lower watermarks.
- **`/ratchet update`**:
  Run `<runner> update .` after manually editing rules in `.ratchet.json`.
- **`/ratchet status`**:
  Run `<runner> status` to inspect hook & `/ratchet` installation across local AI harnesses.

## Escape Hatches

- Single cohesive large module: add `// ratchet-max-lines: 1500` (or `// ratchet-ignore-file`) in the first 10 lines.
- Single cohesive long function: add `// ratchet-max-fn-lines: 200` above the function signature.
- Single intentional line: add `ratchet-ignore` (or `ratchet-ignore:<rule-id>`) in an inline comment.
