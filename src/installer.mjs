import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_PATH = path.join(PKG_ROOT, 'bin', 'code-ratchet.mjs');
const CORE_PATH = path.join(PKG_ROOT, 'src', 'core.mjs');
const MARKER = 'code-ratchet';
const BLOCK_START = '# >>> code-ratchet >>>';
const BLOCK_END = '# <<< code-ratchet <<<';

export const GLOBAL_HARNESSES = [
  'claude',
  'codex',
  'opencode',
  'droid',
  'cursor',
  'cline',
  'windsurf',
  'kiro',
  'antigravity',
];

function quoteCmdPath(p) {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildHookCommand(harness, binPath = BIN_PATH) {
  return `node ${quoteCmdPath(binPath)} hook --harness ${harness}`;
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function stripManagedBlock(text) {
  const re = new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`, 'g');
  return text.replace(re, '\n').replace(/\n{3,}/g, '\n\n');
}

function isOurEntry(entry) {
  return JSON.stringify(entry ?? '').includes(MARKER);
}

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function buildOpenCodePluginSource(corePath) {
  const coreUrl = pathToFileURL(corePath).href;
  return `// Managed by code-ratchet — zero-dependency OpenCode Stop/Idle guardrail plugin
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_NAME, listGitChangedRelFiles, runCheck } from ${JSON.stringify(coreUrl)};

export const CodeRatchetPlugin = async ({ client, directory }) => {
  const retries = new Map();

  return {
    event: async ({ event }) => {
      if (!event || event.type !== 'session.idle') return;
      const sessionID = event.properties?.sessionID ?? event.data?.sessionID;
      const root = directory || process.cwd();
      if (!sessionID || !root || !fs.existsSync(path.join(root, CONFIG_NAME))) return;

      const changed = listGitChangedRelFiles(root);
      if (changed !== null && changed.size === 0) {
        retries.delete(sessionID);
        return;
      }

      const res = runCheck(root);
      if (res.ok || res.skipped) {
        retries.delete(sessionID);
        return;
      }

      const count = retries.get(sessionID) ?? 0;
      if (count >= 2) {
        retries.delete(sessionID);
        return;
      }
      retries.set(sessionID, count + 1);

      const details = res.errors.slice(0, 10).map(e => '- ' + e).join('\\n');
      const more = res.errors.length > 10 ? '\\n- ... (' + (res.errors.length - 10) + ' more omitted)' : '';
      const text = '[code-ratchet] Blocked ' + res.errors.length + ' new regression(s). Fix them before finishing:\\n' + details + more;

      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: false,
          parts: [{ type: 'text', text }],
        },
      });
    },
  };
};

export default CodeRatchetPlugin;
`;
}

export function installHarness(target, options = {}) {
  const home = options.homeDir ?? os.homedir();
  const binPath = options.binPath ?? BIN_PATH;
  const corePath = options.corePath ?? CORE_PATH;

  if (target === 'antigravity') {
    const pluginDir = path.join(home, '.gemini', 'config', 'plugins', 'code-ratchet');
    copyDirRecursive(PKG_ROOT, pluginDir);
    return { target, path: pluginDir, installed: true };
  }

  if (target === 'claude') {
    const cfgPath = path.join(home, '.claude', 'settings.json');
    const data = readJsonSafe(cfgPath);
    data.hooks = data.hooks ?? {};
    const list = Array.isArray(data.hooks.Stop) ? data.hooks.Stop.filter(item => !isOurEntry(item)) : [];
    list.push({
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: buildHookCommand('claude', binPath),
          timeout: 20,
        },
      ],
    });
    data.hooks.Stop = list;
    writeJsonAtomic(cfgPath, data);
    return { target, path: cfgPath, installed: true };
  }

  if (target === 'codex') {
    const cfgPath = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    let content = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
    content = stripManagedBlock(content).trimEnd();

    let featuresSnippet = '';
    if (!/^\s*\[features\]/m.test(content)) {
      featuresSnippet = '[features]\nhooks = true\n\n';
    } else if (!/^\s*hooks\s*=\s*true/m.test(content)) {
      content = content.replace(/^(\s*\[features\]\s*)$/m, '$1\nhooks = true');
    }

    const cmd = buildHookCommand('codex', binPath).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const block = [
      BLOCK_START,
      `${featuresSnippet}[[hooks.Stop]]`,
      'matcher = ""',
      '[[hooks.Stop.hooks]]',
      'type = "command"',
      `command = "${cmd}"`,
      'timeout = 20',
      'statusMessage = "Running code-ratchet guardrails..."',
      BLOCK_END,
    ].join('\n');

    const finalText = content ? `${content}\n\n${block}\n` : `${block}\n`;
    fs.writeFileSync(cfgPath, finalText, 'utf8');
    return { target, path: cfgPath, installed: true, note: 'Run /hooks once in Codex TUI to trust the hook.' };
  }

  if (target === 'opencode') {
    const pluginPath = path.join(home, '.config', 'opencode', 'plugins', 'code-ratchet.mjs');
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.writeFileSync(pluginPath, buildOpenCodePluginSource(corePath), 'utf8');
    return { target, path: pluginPath, installed: true };
  }

  if (target === 'droid') {
    const cfgPath = path.join(home, '.factory', 'settings.json');
    const data = readJsonSafe(cfgPath);
    data.hooks = data.hooks ?? {};
    const list = Array.isArray(data.hooks.Stop) ? data.hooks.Stop.filter(item => !isOurEntry(item)) : [];
    list.push({
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: buildHookCommand('droid', binPath),
        },
      ],
    });
    data.hooks.Stop = list;
    writeJsonAtomic(cfgPath, data);
    return { target, path: cfgPath, installed: true };
  }

  if (target === 'kiro') {
    const cfgPath = path.join(home, '.kiro', 'hooks', 'code-ratchet.json');
    writeJsonAtomic(cfgPath, {
      version: 'v1',
      hooks: [
        {
          name: 'code-ratchet',
          trigger: 'Stop',
          action: {
            type: 'command',
            command: buildHookCommand('kiro', binPath),
          },
        },
      ],
    });
    return { target, path: cfgPath, installed: true };
  }

  if (target === 'cursor') {
    const cfgPath = path.join(home, '.cursor', 'hooks.json');
    const data = readJsonSafe(cfgPath);
    if (!data.version) data.version = 1;
    data.hooks = data.hooks ?? {};
    const list = Array.isArray(data.hooks.stop) ? data.hooks.stop.filter(item => !isOurEntry(item)) : [];
    list.push({
      command: buildHookCommand('cursor', binPath),
    });
    data.hooks.stop = list;
    writeJsonAtomic(cfgPath, data);
    return { target, path: cfgPath, installed: true };
  }

  if (target === 'cline') {
    const hookFile = path.join(home, 'Documents', 'Cline', 'Hooks', 'PreToolUse');
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    let existing = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, 'utf8') : '';
    if (existing && !existing.includes(MARKER)) {
      throw new Error(
        `Existing custom Cline PreToolUse hook found at ${hookFile}; chain '${buildHookCommand('cline', binPath)}' manually to avoid overwriting.`
      );
    }
    const script = [
      '#!/usr/bin/env sh',
      BLOCK_START,
      `exec ${buildHookCommand('cline', binPath)}`,
      BLOCK_END,
      '',
    ].join('\n');
    fs.writeFileSync(hookFile, script, { encoding: 'utf8', mode: 0o755 });
    try {
      fs.chmodSync(hookFile, 0o755);
    } catch {
      /* ignore on Windows */
    }
    return { target, path: hookFile, installed: true };
  }

  if (target === 'windsurf') {
    const cfgPath = path.join(home, '.codeium', 'windsurf', 'hooks.json');
    const data = readJsonSafe(cfgPath);
    data.hooks = data.hooks ?? {};
    const list = Array.isArray(data.hooks.pre_run_command)
      ? data.hooks.pre_run_command.filter(item => !isOurEntry(item))
      : [];
    list.push({
      command: buildHookCommand('windsurf', binPath),
      show_output: true,
    });
    data.hooks.pre_run_command = list;
    writeJsonAtomic(cfgPath, data);
    return { target, path: cfgPath, installed: true };
  }

  throw new Error(`Unsupported global harness target: ${target}`);
}

export function uninstallHarness(target, options = {}) {
  const home = options.homeDir ?? os.homedir();

  if (target === 'antigravity') {
    const pluginDir = path.join(home, '.gemini', 'config', 'plugins', 'code-ratchet');
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    return { target, path: pluginDir, removed: true };
  }

  if (target === 'claude') {
    const cfgPath = path.join(home, '.claude', 'settings.json');
    if (!fs.existsSync(cfgPath)) return { target, path: cfgPath, removed: false };
    const data = readJsonSafe(cfgPath);
    if (Array.isArray(data.hooks?.Stop)) {
      data.hooks.Stop = data.hooks.Stop.filter(item => !isOurEntry(item));
      if (data.hooks.Stop.length === 0) delete data.hooks.Stop;
      if (data.hooks && Object.keys(data.hooks).length === 0) delete data.hooks;
      writeJsonAtomic(cfgPath, data);
    }
    return { target, path: cfgPath, removed: true };
  }

  if (target === 'codex') {
    const cfgPath = path.join(home, '.codex', 'config.toml');
    if (!fs.existsSync(cfgPath)) return { target, path: cfgPath, removed: false };
    const cleaned = stripManagedBlock(fs.readFileSync(cfgPath, 'utf8')).trimEnd();
    fs.writeFileSync(cfgPath, cleaned ? `${cleaned}\n` : '', 'utf8');
    return { target, path: cfgPath, removed: true };
  }

  if (target === 'opencode') {
    const pluginPath = path.join(home, '.config', 'opencode', 'plugins', 'code-ratchet.mjs');
    if (!fs.existsSync(pluginPath)) return { target, path: pluginPath, removed: false };
    fs.rmSync(pluginPath, { force: true });
    return { target, path: pluginPath, removed: true };
  }

  if (target === 'droid') {
    const cfgPath = path.join(home, '.factory', 'settings.json');
    if (!fs.existsSync(cfgPath)) return { target, path: cfgPath, removed: false };
    const data = readJsonSafe(cfgPath);
    if (Array.isArray(data.hooks?.Stop)) {
      data.hooks.Stop = data.hooks.Stop.filter(item => !isOurEntry(item));
      if (data.hooks.Stop.length === 0) delete data.hooks.Stop;
      if (data.hooks && Object.keys(data.hooks).length === 0) delete data.hooks;
      writeJsonAtomic(cfgPath, data);
    }
    return { target, path: cfgPath, removed: true };
  }

  if (target === 'kiro') {
    const cfgPath = path.join(home, '.kiro', 'hooks', 'code-ratchet.json');
    if (!fs.existsSync(cfgPath)) return { target, path: cfgPath, removed: false };
    fs.rmSync(cfgPath, { force: true });
    return { target, path: cfgPath, removed: true };
  }

  if (target === 'cursor') {
    const cfgPath = path.join(home, '.cursor', 'hooks.json');
    if (!fs.existsSync(cfgPath)) return { target, path: cfgPath, removed: false };
    const data = readJsonSafe(cfgPath);
    if (Array.isArray(data.hooks?.stop)) {
      data.hooks.stop = data.hooks.stop.filter(item => !isOurEntry(item));
      if (data.hooks.stop.length === 0) delete data.hooks.stop;
      writeJsonAtomic(cfgPath, data);
    }
    return { target, path: cfgPath, removed: true };
  }

  if (target === 'cline') {
    const hookFile = path.join(home, 'Documents', 'Cline', 'Hooks', 'PreToolUse');
    if (!fs.existsSync(hookFile)) return { target, path: hookFile, removed: false };
    const content = fs.readFileSync(hookFile, 'utf8');
    if (content.includes(MARKER)) {
      fs.rmSync(hookFile, { force: true });
      return { target, path: hookFile, removed: true };
    }
    return { target, path: hookFile, removed: false };
  }

  if (target === 'windsurf') {
    const cfgPath = path.join(home, '.codeium', 'windsurf', 'hooks.json');
    if (!fs.existsSync(cfgPath)) return { target, path: cfgPath, removed: false };
    const data = readJsonSafe(cfgPath);
    if (Array.isArray(data.hooks?.pre_run_command)) {
      data.hooks.pre_run_command = data.hooks.pre_run_command.filter(item => !isOurEntry(item));
      if (data.hooks.pre_run_command.length === 0) delete data.hooks.pre_run_command;
      if (data.hooks && Object.keys(data.hooks).length === 0) delete data.hooks;
      writeJsonAtomic(cfgPath, data);
    }
    return { target, path: cfgPath, removed: true };
  }

  throw new Error(`Unsupported global harness target: ${target}`);
}

export function installCopilotRepoHook(repoRoot, options = {}) {
  const binPath = options.binPath ?? BIN_PATH;
  const cfgPath = path.join(repoRoot, '.github', 'hooks', 'code-ratchet.json');
  const cmd = buildHookCommand('copilot', binPath);
  writeJsonAtomic(cfgPath, {
    version: 1,
    hooks: {
      Stop: [
        {
          type: 'command',
          command: cmd,
          windows: cmd,
          timeout: 20,
        },
      ],
    },
  });
  return { path: cfgPath, installed: true };
}

export function uninstallCopilotRepoHook(repoRoot) {
  const cfgPath = path.join(repoRoot, '.github', 'hooks', 'code-ratchet.json');
  if (!fs.existsSync(cfgPath)) return { path: cfgPath, removed: false };
  fs.rmSync(cfgPath, { force: true });
  return { path: cfgPath, removed: true };
}

export function installGitHook(repoRoot, options = {}) {
  const binPath = options.binPath ?? BIN_PATH;
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    throw new Error(`Not a Git repository: ${repoRoot}`);
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookFile = path.join(hooksDir, 'pre-commit');
  let existing = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, 'utf8') : '#!/bin/sh\n';
  existing = stripManagedBlock(existing).trimEnd();
  const block = [
    BLOCK_START,
    `node ${quoteCmdPath(binPath)} check --changed "${repoRoot.replace(/"/g, '\\"')}" || exit 1`,
    BLOCK_END,
  ].join('\n');
  fs.writeFileSync(hookFile, `${existing}\n\n${block}\n`, { encoding: 'utf8', mode: 0o755 });
  try {
    fs.chmodSync(hookFile, 0o755);
  } catch {
    /* ignore on Windows */
  }
  return { path: hookFile, installed: true };
}

export function uninstallGitHook(repoRoot) {
  const hookFile = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(hookFile)) return { path: hookFile, removed: false };
  const cleaned = stripManagedBlock(fs.readFileSync(hookFile, 'utf8')).trim();
  if (!cleaned || cleaned === '#!/bin/sh' || cleaned === '#!/usr/bin/env sh') {
    fs.rmSync(hookFile, { force: true });
  } else {
    fs.writeFileSync(hookFile, `${cleaned}\n`, 'utf8');
  }
  return { path: hookFile, removed: true };
}

export function detectInstalledHarnesses(options = {}) {
  const home = options.homeDir ?? os.homedir();
  return [
    {
      target: 'claude',
      detected: fs.existsSync(path.join(home, '.claude')),
      configured:
        fs.existsSync(path.join(home, '.claude', 'settings.json')) &&
        fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8').includes(MARKER),
      configPath: path.join(home, '.claude', 'settings.json'),
    },
    {
      target: 'codex',
      detected: fs.existsSync(path.join(home, '.codex')),
      configured:
        fs.existsSync(path.join(home, '.codex', 'config.toml')) &&
        fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').includes(MARKER),
      configPath: path.join(home, '.codex', 'config.toml'),
    },
    {
      target: 'opencode',
      detected:
        fs.existsSync(path.join(home, '.config', 'opencode')) ||
        fs.existsSync(path.join(home, '.local', 'share', 'opencode')),
      configured: fs.existsSync(path.join(home, '.config', 'opencode', 'plugins', 'code-ratchet.mjs')),
      configPath: path.join(home, '.config', 'opencode', 'plugins', 'code-ratchet.mjs'),
    },
    {
      target: 'droid',
      detected: fs.existsSync(path.join(home, '.factory')),
      configured:
        fs.existsSync(path.join(home, '.factory', 'settings.json')) &&
        fs.readFileSync(path.join(home, '.factory', 'settings.json'), 'utf8').includes(MARKER),
      configPath: path.join(home, '.factory', 'settings.json'),
    },
    {
      target: 'cursor',
      detected: fs.existsSync(path.join(home, '.cursor')),
      configured:
        fs.existsSync(path.join(home, '.cursor', 'hooks.json')) &&
        fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8').includes(MARKER),
      configPath: path.join(home, '.cursor', 'hooks.json'),
    },
    {
      target: 'cline',
      detected: fs.existsSync(path.join(home, 'Documents', 'Cline')),
      configured:
        fs.existsSync(path.join(home, 'Documents', 'Cline', 'Hooks', 'PreToolUse')) &&
        fs.readFileSync(path.join(home, 'Documents', 'Cline', 'Hooks', 'PreToolUse'), 'utf8').includes(MARKER),
      configPath: path.join(home, 'Documents', 'Cline', 'Hooks', 'PreToolUse'),
    },
    {
      target: 'windsurf',
      detected: fs.existsSync(path.join(home, '.codeium', 'windsurf')),
      configured:
        fs.existsSync(path.join(home, '.codeium', 'windsurf', 'hooks.json')) &&
        fs.readFileSync(path.join(home, '.codeium', 'windsurf', 'hooks.json'), 'utf8').includes(MARKER),
      configPath: path.join(home, '.codeium', 'windsurf', 'hooks.json'),
    },
    {
      target: 'kiro',
      detected: fs.existsSync(path.join(home, '.kiro')),
      configured: fs.existsSync(path.join(home, '.kiro', 'hooks', 'code-ratchet.json')),
      configPath: path.join(home, '.kiro', 'hooks', 'code-ratchet.json'),
    },
    {
      target: 'antigravity',
      detected:
        fs.existsSync(path.join(home, '.gemini', 'antigravity')) ||
        fs.existsSync(path.join(home, '.gemini', 'config')),
      configured: fs.existsSync(path.join(home, '.gemini', 'config', 'plugins', 'code-ratchet', 'plugin.json')),
      configPath: path.join(home, '.gemini', 'config', 'plugins', 'code-ratchet'),
    },
  ];
}
