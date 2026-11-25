# code-ratchet

[简体中文](./README.zh-CN.md) | English

**Zero-dependency polyglot quality ratchet & completion-hook guardrails for AI coding harnesses.**

AI coding agents love taking shortcuts: stuffing 300 extra lines into an already-bloated 1,500-line file, sprinkling magic Tailwind pixel values (`text-[11px]`), adding `: any`, dropping `.unwrap()` in production Rust, or swallowing Python exceptions with bare `except:`.

Markdown rules (`CLAUDE.md` / `AGENTS.md`) get ignored under context pressure, while strict linters fail with hundreds of errors on legacy codebases.

**`code-ratchet` solves both:**
1. **Freeze legacy debt, block new debt**: `code-ratchet init` snapshots your existing oversized files and anti-pattern counts into `.ratchet.json`. Legacy files pass untouched, while any **new** bloat or violation is strictly blocked. As you refactor, `code-ratchet tighten` permanently lowers the ceiling.
2. **One package, every AI harness**: Built-in hook & plugin adapters speak the native protocol of **Claude Code**, **OpenAI Codex CLI**, **OpenCode**, **Cursor**, **Cline**, **GitHub Copilot / VS Code Agent**, **Windsurf**, **Antigravity**, plus **Git `pre-commit`** (covering Aider & terminal workflows)—in ~30ms with **zero npm dependencies**.

---

## Quick Start

### 1. Install into your AI coding harnesses (once per machine)

**Option A: One-command auto-install across all local harnesses (Recommended)**
```bash
npx github:LDH0218/code-ratchet install
npx github:LDH0218/code-ratchet status
```
> Automatically persists the zero-dependency runtime into `~/.code-ratchet/runtime/`, so hooks and `/ratchet` stay fast and offline-ready even after clearing npm caches.

**Option B: Native Plugin Marketplaces (Codex & Claude Code)**
```bash
# OpenAI Codex CLI / Codex App
codex plugin marketplace add LDH0218/code-ratchet
codex plugin add ratchet@code-ratchet

# Claude Code (run inside chat)
/plugin marketplace add LDH0218/code-ratchet
/plugin install ratchet@code-ratchet
```

### 2. Enable in any repository (once per repo)

Type **`/ratchet`** directly in **Codex**, **Claude Code**, **Cursor**, **OpenCode**, **Factory Droid**, **Windsurf**, **VS Code Copilot**, or **Antigravity** (or run `npx code-ratchet init` in your terminal):
- `/ratchet init` — Initialize `.ratchet.json` and freeze current legacy baselines
- `/ratchet check` — Scan for regressions and fix any violations
- `/ratchet tighten` — Permanently lower watermarks after refactoring
- `/ratchet status` — Check hook installation status across harnesses

Commit the generated `.ratchet.json`. Repositories **without** `.ratchet.json` are completely ignored (<25ms silent exit).

---

## Supported Harnesses

| Harness | Native Mechanism | Config Managed by `code-ratchet install` | Enforcement Protocol |
| :--- | :--- | :--- | :--- |
| **Claude Code** | `Stop` hook / `.claude-plugin` | `~/.claude/settings.json` | `{"decision":"block","reason":"..."}` |
| **Codex CLI** | `Stop` hook | `~/.codex/config.toml` (`[[hooks.Stop]]`) | `{"decision":"block","reason":"..."}` |
| **T3 Code / Botdeck / Orchestrators** | Underlying Claude + Codex hooks (`--t3code`) | `~/.claude/settings.json` + `~/.codex/config.toml` | Inherited automatically by spawned CLI turns |
| **OpenCode** | Native JS Plugin (`session.idle`) | `~/.config/opencode/plugins/code-ratchet.mjs` | `client.session.prompt(...)` auto-fix loop |
| **Factory Droid** | `Stop` hook | `~/.factory/settings.json` (`hooks.Stop`) | `{"decision":"block","reason":"..."}` |
| **Cursor** | `stop` hook | `~/.cursor/hooks.json` | `{"followup_message":"..."}` |
| **Cline** | `PreToolUse` (`attempt_completion`) | `~/Documents/Cline/Hooks/PreToolUse` | `{"cancel":true,"errorMessage":"..."}` |
| **GitHub Copilot / VS Code** | Repo `Stop` hook | `npx code-ratchet install --copilot .` (`.github/hooks/`) | `exit 2` + `stderr` feedback |
| **Windsurf (Cascade)** | `pre_run_command` (`git commit`) | `~/.codeium/windsurf/hooks.json` | `exit 2` + `stderr` (`show_output: true`) |
| **AWS Kiro** | `Stop` hook (`v1`) | `~/.kiro/hooks/code-ratchet.json` | `exit 2` + `stderr` |
| **Antigravity** | `Stop` hook plugin | `~/.gemini/config/plugins/code-ratchet` | `{"decision":"continue","reason":"..."}` |
| **Git / Aider / Augment (Universal)** | `pre-commit` hook | `npx code-ratchet install --git-hook .` | Non-zero exit + actionable report |

---

## Auto-Detected Polyglot Guardrails

`code-ratchet init` inspects manifests and source roots (`src`, `src-tauri/src`, `crates`, `internal`, `cmd`, `pkg`, `backend`, `server`, `services`, `app`, `lib`, `Sources`, `packages`) and configures stack-appropriate rules out of the box:

- **Tiered File-Size Caps (`tierMaxLines`)**: Tight on UI components (`.tsx/.jsx/.vue/.svelte`: **450 lines**), moderate on general scripts (`.ts/.js/.css`: **600 lines**), and generous on cohesive backend engines (`.rs/.go/.py/.java/.kt/.cs/.cpp`: **900 lines**).
- **Single-Function Length Ratchet (`functionSize`)**: Blocks newly written >**120-line** mega-functions across brace languages and Python while freezing existing legacy long functions in place.
- **Smart Auto-Exemptions**: Unit test files (`_tests.rs`, `_test.go`, `.test.ts`, etc.), pure DTO/contract/schema definitions (`dto.rs`, `contracts.ts`, `schema.ts`), migrations, and generated code (`*.gen.*`, `*.pb.*`) are automatically excluded from size caps.
- **Pragmatic Escape Hatches**: Add `// ratchet-max-lines: 1500` or `// ratchet-ignore-file` in the first 10 lines for legitimately large cohesive modules, or `// ratchet-max-fn-lines: 200` above a function.
- **TypeScript / JavaScript / Tailwind / UI**:
  - `ts-explicit-any`: Blocks new `: any` / `as any`.
  - `tailwind-arbitrary-px`: Blocks new magic pixel/rem utilities (`text-[11px]`, `rounded-[14px]`) and suggests your CSS theme tokens.
  - `nestedButton`: Blocks invalid HTML `<button>` inside `<button>` or nested `role="button"`.
  - `tauriIpc`: Bidirectional check ensuring every frontend Tauri `invoke()` matches `tauri::generate_handler![]` in Rust.
- **Rust**: `rust-unwrap` — Blocks new `.unwrap()` in production code while automatically stopping at `#[cfg(test)]` / `#[cfg(all(test, ...))]` so inline unit tests remain unrestricted.
- **Go**: `go-panic` — Blocks new `panic(` in business packages (excludes `cmd/` and `_test.go`).
- **Python**: `python-bare-except` & `python-bare-type-ignore` — Blocks bare `except:` and uncoded `# type: ignore`.
- **Java / Kotlin**: `jvm-print-stacktrace` & `kotlin-not-null-assert` (`!!`).
- **C# / .NET**: `csharp-empty-catch` — Blocks empty `catch {}` blocks.
- **C / C++**: `cpp-unsafe-cstr` — Blocks `gets`, `strcpy`, `strcat`, `sprintf`.
- **PHP / Ruby**: Blocks leftover `var_dump`/`dd` and `binding.pry`/`debugger`.

---

## CLI Reference

```bash
code-ratchet init [dir]                  # Create .ratchet.json & freeze current baselines
code-ratchet check [dir] [--changed]     # Check baselines (--changed scans only git-modified files)
code-ratchet tighten [dir]               # Lower watermarks permanently after cleaning up debt
code-ratchet update [dir]                # Re-baseline after editing rules in .ratchet.json
code-ratchet status                      # Show detected harnesses & hook status
code-ratchet install [--all | --claude | --codex | --opencode | --cursor | --cline | --windsurf | --antigravity | --copilot | --git-hook]
code-ratchet uninstall [--all | --claude | --codex | --opencode | --cursor | --cline | --windsurf | --antigravity | --copilot | --git-hook]
```

Inline exemption for a single intentional line: add `ratchet-ignore` (or `ratchet-ignore:<rule-id>`) in a comment on that line.

## Performance

Written in pure zero-dependency Node.js ESM:
- Unconfigured repo skip: **~25ms** (cold start included)
- 70-file full-stack Tauri/Rust/React repo check: **~29ms**
- 1,000-file (250k LOC) repo full scan: **~82ms** (`<15ms` with `--changed`)

## License

MIT
