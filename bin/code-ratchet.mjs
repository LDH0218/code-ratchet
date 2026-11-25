#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { CONFIG_NAME, initConfig, relPath, runCheck, tightenConfig } from '../src/core.mjs';
import { runHookCli } from '../src/hook.mjs';
import {
  GLOBAL_HARNESSES,
  detectInstalledHarnesses,
  installCopilotRepoHook,
  installGitHook,
  installHarness,
  uninstallCopilotRepoHook,
  uninstallGitHook,
  uninstallHarness,
} from '../src/installer.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[arg.slice(2)] = argv[++i];
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printHelp() {
  console.log(`code-ratchet — Zero-dependency polyglot quality ratchet for AI coding harnesses

Usage:
  code-ratchet init [dir]                  Auto-detect stack & freeze legacy baselines in .ratchet.json
  code-ratchet check [dir] [--changed]     Verify no file-size or anti-pattern baseline regressed
  code-ratchet tighten [dir]               Lower watermarks permanently after refactoring
  code-ratchet update [dir]                Re-measure baselines after editing .ratchet.json rules
  code-ratchet status                      Show detected AI harnesses & hook installation status
  code-ratchet install [options]           Install hooks (--all | --claude | --codex | --t3code | --opencode | --droid | --cursor | --cline | --windsurf | --kiro | --antigravity | --copilot | --git-hook)
  code-ratchet uninstall [options]         Cleanly remove installed hooks
  code-ratchet hook [--harness <name>]     Stdin/stdout hook adapter (invoked automatically by harnesses)
`);
}

function resolveGlobalTargets(positional, flags) {
  const chosen = new Set();
  if (flags.t3code || positional.includes('t3code')) {
    chosen.add('claude');
    chosen.add('codex');
  }
  for (const name of GLOBAL_HARNESSES) {
    if (flags[name] || positional.includes(name)) chosen.add(name);
  }
  const repoOnly = Boolean(flags['git-hook'] || flags.copilot || positional.includes('copilot'));
  if (flags.all || (chosen.size === 0 && !repoOnly)) {
    for (const item of detectInstalledHarnesses()) {
      if (item.detected) chosen.add(item.target);
    }
  }
  return [...chosen];
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0] ?? (flags.help ? 'help' : 'check');

  if (cmd === 'help' || flags.help) {
    printHelp();
    return;
  }

  if (cmd === 'hook') {
    runHookCli(typeof flags.harness === 'string' ? flags.harness : undefined);
    return;
  }

  if (cmd === 'status') {
    const list = detectInstalledHarnesses();
    console.log('[code-ratchet] Harness status:');
    for (const item of list) {
      const state = item.configured ? 'INSTALLED' : item.detected ? 'detected (not installed)' : 'not found';
      console.log(`  - ${item.target.padEnd(13)} ${state}  (${item.configPath})`);
    }
    return;
  }

  if (cmd === 'install') {
    const repoArg = positional.find(
      p => !GLOBAL_HARNESSES.includes(p) && p !== 'install' && p !== 'copilot' && p !== 't3code'
    );
    const repo = path.resolve(repoArg ?? process.cwd());
    if (flags['git-hook']) {
      const res = installGitHook(repo);
      console.log(`[code-ratchet] Installed Git pre-commit hook -> ${res.path}`);
    }
    if (flags.copilot || positional.includes('copilot')) {
      const res = installCopilotRepoHook(repo);
      console.log(`[code-ratchet] Installed Copilot / VS Code Agent Stop hook -> ${res.path}`);
    }
    const targets = resolveGlobalTargets(positional.slice(1), flags);
    if (targets.length === 0 && !flags['git-hook'] && !flags.copilot && !positional.includes('copilot')) {
      console.log('[code-ratchet] No local harnesses detected. Pass explicit flags like --claude, --opencode, or --codex.');
      return;
    }
    for (const target of targets) {
      const res = installHarness(target);
      console.log(`[code-ratchet] Installed ${res.target} hook -> ${res.path}`);
      if (res.note) console.log(`  Note: ${res.note}`);
    }
    return;
  }

  if (cmd === 'uninstall') {
    const repoArg = positional.find(p => !GLOBAL_HARNESSES.includes(p) && p !== 'uninstall' && p !== 'copilot');
    const repo = path.resolve(repoArg ?? process.cwd());
    if (flags['git-hook']) {
      const res = uninstallGitHook(repo);
      if (res.removed) console.log(`[code-ratchet] Removed Git pre-commit hook (${res.path})`);
    }
    if (flags.copilot || positional.includes('copilot')) {
      const res = uninstallCopilotRepoHook(repo);
      if (res.removed) console.log(`[code-ratchet] Removed Copilot Stop hook (${res.path})`);
    }
    const explicit = GLOBAL_HARNESSES.filter(name => flags[name] || positional.includes(name));
    const list = explicit.length > 0 ? explicit : flags.all || (!flags['git-hook'] && !flags.copilot) ? GLOBAL_HARNESSES : [];
    for (const target of list) {
      const res = uninstallHarness(target);
      if (res.removed) console.log(`[code-ratchet] Uninstalled ${res.target} hook (${res.path})`);
    }
    return;
  }

  const root = path.resolve(positional[1] ?? process.cwd());

  if (cmd === 'init') {
    const { outPath, stackTags, config } = initConfig(root);
    console.log(`[code-ratchet] Initialized ${relPath(root, outPath)}`);
    console.log(`  Detected stack : ${stackTags.join(', ') || 'generic'}`);
    console.log(`  Watermarked    : ${Object.keys(config.fileSize.maxLines).length} oversized file(s) (default cap ${config.fileSize.defaultMaxLines} lines)`);
    console.log(`  Active rules   : ${config.patterns.map(p => p.id).join(', ') || 'none'}`);
    if (config.tauriIpc) console.log('  Tauri IPC sync : enabled');
    return;
  }

  if (cmd === 'tighten' || cmd === 'update') {
    const { cfgPath } = tightenConfig(root, cmd === 'update');
    console.log(`[code-ratchet] ${cmd === 'update' ? 'Updated' : 'Tightened'} baseline ${relPath(root, cfgPath)}`);
    return;
  }

  if (cmd === 'check') {
    const res = runCheck(root, { changedOnly: Boolean(flags.changed) });
    if (res.skipped) {
      console.log(`[code-ratchet] No ${CONFIG_NAME} found, skipping.`);
      return;
    }
    if (!res.ok) {
      console.error(`\n[code-ratchet] Check failed with ${res.errors.length} violation(s):\n`);
      for (const e of res.errors) console.error(`  ✗ ${e}`);
      console.error('');
      process.exit(1);
    }
    console.log(`[code-ratchet] PASS (${res.summary})`);
    if (res.tightenHints.length > 0) {
      console.log(`[code-ratchet] ${res.tightenHints.length} metric(s) improved below baseline — run 'code-ratchet tighten' to lock them in.`);
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(2);
}

main();
