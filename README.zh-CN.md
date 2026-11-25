# code-ratchet（代码棘轮）

[English](./README.md) | 简体中文

**零依赖、全语言通用的 AI 编程质量棘轮与跨 Harness 收工门禁插件。**

用 AI 写代码最头疼的不是它不会写，而是它为了图省事经常干这些事：
- 往已经 1200 行的老文件里继续硬塞 300 行，造成改不动的巨石文件；
- 随手糊 `text-[11px]`、`: any`、生产环境的 `.unwrap()` 或裸 `except:` 吞报错；
- 写在 `CLAUDE.md` / `AGENTS.md` 里的软提示词一到上下文变长就被当耳旁风；而传统 Linter 往老项目里一放就报几百个红错，逼你停工返工。

**`code-ratchet` 用两个核心设计彻底治好这个痛点：**
1. **老债原地免死，新债零容忍**：`init` 一键将老文件当前的行数和历史坏味道拍照记入 `.ratchet.json`。老代码不动永远绿灯；谁敢让大文件多长一行、或多写一个坏味道，当场拦截。重构瘦身后跑 `tighten`，“咔哒”一声把上限永久往下锁死。
2. **一套代码，通吃主流 AI Harness**：内置多协议原生适配器，完整支持 **Claude Code**、**Codex CLI**、**OpenCode**、**Cursor**、**Cline**、**GitHub Copilot / VS Code Agent**、**Windsurf**、**Antigravity** 以及 **Git `pre-commit`**（兼容 Aider 等终端工具），纯 Node 原生实现、**0 第三方依赖**、单次检查仅需约 **30 毫秒**。

---

## 三十秒上手

### 1. 在电脑上挂载 AI 工具钩子（每台电脑只需跑一次）

```bash
# 自动检测本机已安装的 AI 工具并挂载收工钩子
npx code-ratchet install

# 或指定挂载目标
npx code-ratchet install --claude --codex --opencode --cursor --cline --windsurf
npx code-ratchet status
```

> 注：挂载到 Codex CLI 后，首次打开 Codex TUI 输入一次 `/hooks` 确认信任即可生效。

### 2. 在任意项目中开启保护（每个项目只需跑一次）

```bash
cd /path/to/your-project
npx code-ratchet init
```

生成 `.ratchet.json` 后即可全自动运行——每次 AI 改完代码准备收工时，若违规会自动把报错塞回给 AI 逼它当场拆文件、修干净再交差。**没有 `.ratchet.json` 的其他项目 25ms 内静默跳过，零打扰。**

---

## 已适配的主流 Harness 列表

| Harness | 原生拦截机制 | `code-ratchet install` 挂载位置 | 打回返工协议 |
| :--- | :--- | :--- | :--- |
| **Claude Code** | `Stop` 钩子 / `.claude-plugin` | `~/.claude/settings.json` | `{"decision":"block","reason":"..."}` |
| **Codex CLI** | `Stop` 钩子 | `~/.codex/config.toml` (`[[hooks.Stop]]`) | `{"decision":"block","reason":"..."}` |
| **T3 Code / Botdeck 等编排台** | 穿透复用底层 CLI 钩子 (`--t3code`) | 自动同时配置 `~/.claude` + `~/.codex` | 子进程每轮收工自动拦截返工 |
| **OpenCode** | 原生 JS 插件 (`session.idle`) | `~/.config/opencode/plugins/code-ratchet.mjs` | 调用 `client.session.prompt` 自动追问重修 |
| **Factory Droid** | `Stop` 钩子 | `~/.factory/settings.json` (`hooks.Stop`) | `{"decision":"block","reason":"..."}` |
| **Cursor** | `stop` 钩子 | `~/.cursor/hooks.json` | `{"followup_message":"..."}` |
| **Cline** | `PreToolUse` (拦截 `attempt_completion`) | `~/Documents/Cline/Hooks/PreToolUse` | `{"cancel":true,"errorMessage":"..."}` |
| **GitHub Copilot / VS Code** | 项目级 `Stop` 钩子 | `npx code-ratchet install --copilot .` | `exit 2` + `stderr` 自动打回 |
| **Windsurf (Cascade)** | `pre_run_command` (守门 `git commit`) | `~/.codeium/windsurf/hooks.json` | `exit 2` + `stderr` (`show_output: true`) |
| **AWS Kiro** | `Stop` 钩子 (`v1`) | `~/.kiro/hooks/code-ratchet.json` | `exit 2` + `stderr` |
| **Antigravity** | `Stop` 钩子插件 | `~/.gemini/config/plugins/code-ratchet` | `{"decision":"continue","reason":"..."}` |
| **Git / Aider / Augment (通用兜底)** | `pre-commit` 钩子 | `npx code-ratchet install --git-hook .` | 非零退出码拦截脏提交 |

---

## 开箱自动识别的前后端语言规则

`init` 会自动扫描 `src`、`src-tauri/src`、`crates`、`internal`、`cmd`、`pkg`、`backend`、`server`、`services` 等前后端目录：

- **全语言通用**：单文件行数水位线（新文件默认上限 **800 行**，超标老文件按现状冻结）。若某个核心模块确实内聚偏长，可在文件前 10 行写注释 `// ratchet-max-lines: 1500` 或 `// ratchet-ignore-file` 单独扩容/豁免。
- **前端 / TS / Tailwind / Tauri**：禁止新增 `: any` / `as any`、禁止新增 Tailwind 任意像素魔法值（自动提示项目 CSS Token）、禁止 `<button>` 非法嵌套、Tauri 前后端 IPC 命令双向对账。
- **Rust**：禁止在生产代码新增 `.unwrap()`（遇到 `#[cfg(test)]` 或 `#[cfg(all(test, ...))]` 自动停手，绝不误伤单测）。
- **Go**：禁止在非 `cmd/` 业务包新增 `panic(`。
- **Python**：禁止新增裸 `except:` 吞异常与无错误码的裸 `# type: ignore`。
- **Java / Kotlin**：禁止新增 `.printStackTrace()` 与 Kotlin `!!` 强行非空断言。
- **C# / .NET**：禁止新增空 `catch {}` 块。
- **C / C++**：禁止新增 `gets / strcpy / strcat / sprintf` 高危调用。
- **PHP / Ruby**：禁止遗留 `var_dump / dd`、`binding.pry / debugger` 调试代码。

---

## 常用命令

```bash
npx code-ratchet init [dir]              # 初始化项目并冻结现有历史基线
npx code-ratchet check [dir] [--changed] # 检查是否违规（超大仓库可加 --changed 仅扫改动文件）
npx code-ratchet tighten [dir]           # 重构清理后永久下调水位线
npx code-ratchet update [dir]            # 手动调整规则后重新测量基线
npx code-ratchet status                  # 查看本机各 Harness 钩子安装状态
npx code-ratchet uninstall --all         # 一键干净卸载所有已挂载钩子
```

单行豁免：若某一行确实需要特殊写法，在该行注释里加上 `ratchet-ignore`（或 `ratchet-ignore:<规则ID>`）即可精准放行。

## 开源协议

MIT
