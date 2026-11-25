---
name: ratchet
description: Manage code-ratchet guardrails (.ratchet.json) via /ratchet — initialize tiered file & function-size baselines, run checks, tighten watermarks, or inspect harness status across frontend and backend languages. Also triggered by the /ratchet slash command.
---

# /ratchet — Code Ratchet Guardrails

Manage `.ratchet.json` baselines (tiered file caps: UI 450 / scripts 600 / backend 900 lines, 120-line single-function cap, DTO/test/generated auto-exemption, and language-specific anti-pattern budgets).

## Slash Command Subcommands

Interpret the user's `/ratchet [subcommand]` argument (default to `check` if `.ratchet.json` exists, otherwise `init`):

- **`/ratchet init`** (or `/ratchet` in an uninitialized repo):
  Run `npx code-ratchet init .` (or `node ~/.gemini/config/plugins/code-ratchet/bin/code-ratchet.mjs init .`) to auto-detect project languages and freeze existing file/function/anti-pattern baselines without failing on legacy debt.
- **`/ratchet check`**:
  Run `npx code-ratchet check .` and fix any reported regressions before finishing.
- **`/ratchet tighten`**:
  Run `npx code-ratchet tighten .` after refactoring to permanently lower watermarks.
- **`/ratchet status`**:
  Run `npx code-ratchet status` to inspect hook & slash-command installation across local AI harnesses.

## Escape Hatches

- Single cohesive large module: add `// ratchet-max-lines: 1500` (or `// ratchet-ignore-file`) in the first 10 lines.
- Single cohesive long function: add `// ratchet-max-fn-lines: 200` above the function signature.
- Single intentional line: add `ratchet-ignore` (or `ratchet-ignore:<rule-id>`) in an inline comment.
