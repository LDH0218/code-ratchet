---
description: Initialize, check, or tighten code-ratchet guardrails (.ratchet.json)
argument-hint: "[init | check | tighten | update | status]"
---

Run `code-ratchet` for the current workspace based on `$ARGUMENTS` (if `$ARGUMENTS` is empty: run `check` when `.ratchet.json` exists, or `init` when `.ratchet.json` is absent):

```bash
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/bin/code-ratchet.mjs" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/bin/code-ratchet.mjs" ${ARGUMENTS:-check} .
elif [ -f "$HOME/.code-ratchet/runtime/bin/code-ratchet.mjs" ]; then
  node "$HOME/.code-ratchet/runtime/bin/code-ratchet.mjs" ${ARGUMENTS:-check} .
else
  npx code-ratchet ${ARGUMENTS:-check} .
fi
```

- If `check` reports regressions, refactor and fix every reported file-size, function-size, or anti-pattern violation, then re-run `check` to confirm PASS.
- If `check` reports metrics improved below baseline, run `tighten` to lock in the lower watermarks.
