---
name: code-ratchet
description: Stack-agnostic, zero-dependency ratchet guardrails (.ratchet.json) across frontend and backend languages (TS/JS, Rust, Go, Python, Java/Kotlin, C#, C/C++, PHP, Ruby, Swift, Dart) that freeze legacy file-size and anti-pattern baselines per project and automatically block regressions via Stop hooks before agent completion. Use when the user asks to initialize, check, tighten, or customize code-ratchet guardrails.
---

# Code Ratchet

`code-ratchet` prevents AI-induced codebase drift across **any frontend or backend language** using a single `.ratchet.json` baseline file and native completion hooks across **Claude Code**, **Codex CLI**, **OpenCode**, **Cursor**, **Cline**, **GitHub Copilot / VS Code Agent**, **Windsurf**, **Antigravity**, and **Git `pre-commit`**.

- Repositories **without** `.ratchet.json` are untouched (<25ms silent exit).
- Repositories **with** `.ratchet.json` freeze existing legacy debt on `init` and strictly block new regressions before the agent finishes its turn.

## Commands

Invoke via `npx code-ratchet` (or `node <plugin-root>/bin/code-ratchet.mjs`):

```bash
# 1. Initialize a repository (auto-detects languages & freezes current baselines)
npx code-ratchet init .

# 2. Check for regressions (--changed scans only git-modified files for huge monorepos)
npx code-ratchet check .

# 3. Permanently lower watermarks after refactoring legacy code
npx code-ratchet tighten .

# 4. Rebuild baselines after intentionally editing .ratchet.json rules
npx code-ratchet update .

# 5. Install/uninstall hooks across local AI harnesses
npx code-ratchet status
npx code-ratchet install --all
npx code-ratchet install --copilot .
npx code-ratchet install --git-hook .
```

## Customizing `.ratchet.json`

- Add regex ratchets under `patterns`: `{ id, description, roots, extensions, exclude?, stopAtPattern?, skipCommentLines?, pattern, hints?, budget }`.
- Add fast compiler/linter commands under `extraChecks`: `{ name, command, timeoutSec }`.
- Exempt an intentional line via inline comment `ratchet-ignore` (or `ratchet-ignore:<rule-id>`).
