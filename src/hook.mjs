import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { CONFIG_NAME, listGitChangedRelFiles, runCheck } from './core.mjs';

export const HARNESS_NAMES = [
  'antigravity',
  'claude',
  'codex',
  'droid',
  'opencode',
  'cursor',
  'cline',
  'copilot',
  'windsurf',
  'kiro',
];

export function detectHarness(payload, explicitHarness) {
  if (explicitHarness) {
    const norm = explicitHarness.toLowerCase();
    if (HARNESS_NAMES.includes(norm)) {
      return norm;
    }
  }
  if (!payload || typeof payload !== 'object') return 'antigravity';
  if ('clineVersion' in payload || 'preToolUse' in payload || Array.isArray(payload.workspaceRoots)) {
    return 'cline';
  }
  if (
    typeof payload.hook_event_name === 'string' &&
    (payload.hook_event_name.includes('cascade') || payload.hook_event_name.startsWith('pre_'))
  ) {
    return 'windsurf';
  }
  if (
    payload.hook_event_name === 'stop' ||
    'loop_count' in payload ||
    Array.isArray(payload.workspace_roots)
  ) {
    return 'cursor';
  }
  if (
    'terminationReason' in payload ||
    'continuationActive' in payload ||
    Array.isArray(payload.workspacePaths)
  ) {
    return 'antigravity';
  }
  if (payload.hook_event_name === 'Stop' || 'stop_hook_active' in payload) {
    return 'claude';
  }
  return 'antigravity';
}

export function shouldBypassHook(harness, payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (harness === 'antigravity') {
    if (payload.terminationReason && payload.terminationReason !== 'NO_TOOL_CALL') {
      return true;
    }
    if (payload.continuationActive && Number(payload.executionNum ?? 0) >= 2) {
      return true;
    }
    return false;
  }
  if (harness === 'cursor') {
    if (payload.status && payload.status !== 'completed') return true;
    if (Number(payload.loop_count ?? 0) >= 2) return true;
    return false;
  }
  if (harness === 'cline') {
    const toolName =
      payload.toolName ??
      payload.preToolUse?.toolName ??
      payload.tool_call?.name ??
      '';
    // Only gate Cline when it tries to call attempt_completion to wrap up the task
    if (toolName && toolName !== 'attempt_completion') {
      return true;
    }
    return false;
  }
  if (harness === 'windsurf') {
    // Gate git commit commands in Windsurf Cascade pre_run_command
    const cmdLine =
      payload.tool_info?.command_line ??
      payload.tool_info?.command ??
      payload.command ??
      '';
    if (cmdLine && !/\bgit\s+commit\b/.test(cmdLine)) {
      return true;
    }
    return false;
  }
  // Claude Code, Codex CLI, Copilot Agent all use stop_hook_active
  if (payload.stop_hook_active === true) {
    return true;
  }
  return false;
}

export function collectCandidateDirs(payload, fallbackCwd = process.cwd()) {
  const candidates = [
    payload?.cwd,
    payload?.workspaceInfo?.rootPath,
    ...(Array.isArray(payload?.workspacePaths) ? payload.workspacePaths : []),
    ...(Array.isArray(payload?.workspace_roots) ? payload.workspace_roots : []),
    ...(Array.isArray(payload?.workspaceRoots) ? payload.workspaceRoots : []),
  ].filter(Boolean);
  if (candidates.length === 0 && fallbackCwd) {
    candidates.push(fallbackCwd);
  }
  return [...new Set(candidates.map(d => path.resolve(d)))];
}

export function formatAllowResult(harness) {
  if (
    harness === 'claude' ||
    harness === 'codex' ||
    harness === 'droid' ||
    harness === 'copilot' ||
    harness === 'windsurf' ||
    harness === 'kiro'
  ) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (harness === 'cline') {
    return { stdout: `${JSON.stringify({ cancel: false })}\n`, stderr: '', exitCode: 0 };
  }
  // Antigravity & Cursor expect {}
  return { stdout: '{}\n', stderr: '', exitCode: 0 };
}

export function formatBlockResult(harness, reason) {
  if (harness === 'claude' || harness === 'codex' || harness === 'droid') {
    return { stdout: `${JSON.stringify({ decision: 'block', reason })}\n`, stderr: '', exitCode: 0 };
  }
  if (harness === 'cursor') {
    return { stdout: `${JSON.stringify({ followup_message: reason })}\n`, stderr: '', exitCode: 0 };
  }
  if (harness === 'cline') {
    return {
      stdout: `${JSON.stringify({ cancel: true, errorMessage: reason })}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  if (harness === 'copilot' || harness === 'windsurf' || harness === 'kiro') {
    return { stdout: '', stderr: `${reason}\n`, exitCode: 2 };
  }
  // Antigravity
  return { stdout: `${JSON.stringify({ decision: 'continue', reason })}\n`, stderr: '', exitCode: 0 };
}

export function evaluateHookResult(rawStdin, options = {}) {
  let payload = {};
  const trimmed = (rawStdin ?? '').trim();
  if (trimmed) {
    try {
      payload = JSON.parse(trimmed);
    } catch {
      const fallback = detectHarness({}, options.harness);
      return formatAllowResult(fallback);
    }
  }

  const harness = detectHarness(payload, options.harness);
  if (shouldBypassHook(harness, payload)) {
    return formatAllowResult(harness);
  }

  const dirs = collectCandidateDirs(payload, options.cwd).filter(dir => {
    if (!fs.existsSync(path.join(dir, CONFIG_NAME))) return false;
    const changed = listGitChangedRelFiles(dir);
    return changed === null ? true : changed.size > 0;
  });

  if (dirs.length === 0) {
    return formatAllowResult(harness);
  }

  const allErrors = [];
  for (const dir of dirs) {
    const res = runCheck(dir);
    if (!res.ok && !res.skipped) {
      const prefix = dirs.length > 1 ? `[${path.basename(dir)}] ` : '';
      allErrors.push(...res.errors.map(e => `${prefix}${e}`));
    }
  }

  if (allErrors.length === 0) {
    return formatAllowResult(harness);
  }

  const details = allErrors.slice(0, 10).map(e => `- ${e}`).join('\n');
  const more = allErrors.length > 10 ? `\n- ... (${allErrors.length - 10} more violations omitted)` : '';
  const reason = `[code-ratchet] Blocked ${allErrors.length} new regression(s). Fix them before finishing:\n${details}${more}`;
  return formatBlockResult(harness, reason);
}

export function evaluateHookPayload(rawStdin, options = {}) {
  return evaluateHookResult(rawStdin, options).stdout;
}

export function runHookCli(explicitHarness) {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  try {
    const res = evaluateHookResult(raw, { harness: explicitHarness });
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.exitCode !== 0) process.exit(res.exitCode);
  } catch {
    const fallback = detectHarness({}, explicitHarness);
    const allow = formatAllowResult(fallback);
    if (allow.stdout) process.stdout.write(allow.stdout);
  }
}
