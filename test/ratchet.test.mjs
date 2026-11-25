import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { defaultCapForFile, initConfig, isSizeExemptPath, runCheck, scanFunctions, tightenConfig } from '../src/core.mjs';
import { detectHarness, evaluateHookResult } from '../src/hook.mjs';
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

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-ratchet-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('polyglot init freezes legacy debt, blocks new violations, and respects Rust #[cfg(all(test, unix))]', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "demo"\n');
    fs.writeFileSync(path.join(root, 'go.mod'), 'module demo\n');
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(root, 'src', 'lib.rs'),
      [
        'pub fn legacy() -> i32 { Some(1).unwrap() }',
        '#[cfg(all(test, unix))]',
        'mod tests {',
        '  fn t() { Some(1).unwrap(); Some(2).unwrap(); }',
        '}',
      ].join('\n') + '\n'
    );
    fs.writeFileSync(path.join(root, 'src', 'svc.go'), 'package src\nfunc Ok() error { return nil }\n');
    fs.writeFileSync(path.join(root, 'src', 'job.py'), 'def ok():\n    return True\n');

    const { stackTags, config } = initConfig(root);
    assert.ok(stackTags.includes('rust'));
    assert.ok(stackTags.includes('go'));
    assert.ok(stackTags.includes('python'));

    const rustRule = config.patterns.find(p => p.id === 'rust-unwrap');
    assert.equal(rustRule.budget['src/lib.rs'], 1);
    assert.equal(runCheck(root).ok, true);

    fs.appendFileSync(path.join(root, 'src', 'svc.go'), 'func Boom() { panic("x") }\n');
    fs.appendFileSync(path.join(root, 'src', 'job.py'), 'def bad():\n  try:\n    pass\n  except:\n    pass\n');
    const failed = runCheck(root);
    assert.equal(failed.ok, false);
    assert.equal(failed.errors.length, 2);

    fs.writeFileSync(path.join(root, 'src', 'svc.go'), 'package src\nfunc Ok() error { return nil }\n');
    fs.writeFileSync(path.join(root, 'src', 'job.py'), 'def ok():\n    return True\n');
    fs.writeFileSync(path.join(root, 'src', 'lib.rs'), 'pub fn clean() -> i32 { 1 }\n');
    const { config: tightened } = tightenConfig(root);
    assert.deepEqual(tightened.patterns.find(p => p.id === 'rust-unwrap').budget, {});
  });
});

test('multi-harness adapter speaks Claude, Codex, Cursor, Cline, Copilot, Windsurf, and Antigravity protocols', () => {
  withTempDir(repo => {
    execSync('git init', { cwd: repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const x = 1;\n');
    initConfig(repo);
    execSync('git add .', { cwd: repo, stdio: 'ignore' });
    execSync('git -c user.name="t" -c user.email="t@t" commit -m "init"', { cwd: repo, stdio: 'ignore' });

    // Introduce explicit any violation
    fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const x: any = 1;\n');

    // 1. Antigravity
    const agy = evaluateHookResult(JSON.stringify({ cwd: repo, terminationReason: 'NO_TOOL_CALL' }));
    assert.equal(agy.exitCode, 0);
    assert.equal(JSON.parse(agy.stdout).decision, 'continue');

    // 2. Claude Code & loop guard
    const claude = evaluateHookResult(JSON.stringify({ cwd: repo, hook_event_name: 'Stop', stop_hook_active: false }));
    assert.equal(JSON.parse(claude.stdout).decision, 'block');
    assert.equal(
      evaluateHookResult(JSON.stringify({ cwd: repo, hook_event_name: 'Stop', stop_hook_active: true })).stdout,
      ''
    );

    // 3. Codex CLI
    const codex = evaluateHookResult(JSON.stringify({ cwd: repo }), { harness: 'codex' });
    assert.equal(JSON.parse(codex.stdout).decision, 'block');

    // 4. Cursor
    const cursor = evaluateHookResult(
      JSON.stringify({ workspace_roots: [repo], hook_event_name: 'stop', status: 'completed', loop_count: 0 })
    );
    assert.match(JSON.parse(cursor.stdout).followup_message, /ts-explicit-any/);

    // 5. Cline PreToolUse: passes write_to_file, blocks attempt_completion
    const clineWrite = evaluateHookResult(
      JSON.stringify({ clineVersion: '3.36.0', workspaceRoots: [repo], toolName: 'write_to_file' })
    );
    assert.deepEqual(JSON.parse(clineWrite.stdout), { cancel: false });

    const clineComplete = evaluateHookResult(
      JSON.stringify({ clineVersion: '3.36.0', workspaceRoots: [repo], toolName: 'attempt_completion' })
    );
    const clineCompleteJson = JSON.parse(clineComplete.stdout);
    assert.equal(clineCompleteJson.cancel, true);
    assert.match(clineCompleteJson.errorMessage, /ts-explicit-any/);

    // 6. GitHub Copilot / VS Code Agent Stop hook: exitCode 2 + stderr
    const copilot = evaluateHookResult(JSON.stringify({ cwd: repo }), { harness: 'copilot' });
    assert.equal(copilot.exitCode, 2);
    assert.match(copilot.stderr, /ts-explicit-any/);

    // 7. Windsurf Cascade pre_run_command: ignores npm test, blocks git commit
    const wsTest = evaluateHookResult(
      JSON.stringify({ cwd: repo, hook_event_name: 'pre_run_command', tool_info: { command_line: 'npm test' } })
    );
    assert.equal(wsTest.exitCode, 0);
    const wsCommit = evaluateHookResult(
      JSON.stringify({ cwd: repo, hook_event_name: 'pre_run_command', tool_info: { command_line: 'git commit -m "wip"' } })
    );
    assert.equal(wsCommit.exitCode, 2);
    assert.match(wsCommit.stderr, /ts-explicit-any/);
  });
});

test('OpenCode native plugin prompts session on session.idle when regressions exist and stops after max retries', async () => {
  await withTempDir(async tmp => {
    const fakeHome = path.join(tmp, 'home');
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    execSync('git init', { cwd: repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(repo, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    initConfig(repo);
    execSync('git add .', { cwd: repo, stdio: 'ignore' });
    execSync('git -c user.name="t" -c user.email="t@t" commit -m "init"', { cwd: repo, stdio: 'ignore' });

    const { path: pluginPath } = installHarness('opencode', { homeDir: fakeHome });
    const mod = await import(pathToFileURL(pluginPath).href);
    const prompts = [];
    const pluginInstance = await mod.CodeRatchetPlugin({
      directory: repo,
      client: {
        session: {
          prompt: async req => {
            prompts.push(req);
          },
        },
      },
    });

    // Clean state -> 0 prompts
    await pluginInstance.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(prompts.length, 0);

    // Violating state -> prompts up to 2 times, then stops looping on 3rd
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a: any = 1;\n');
    await pluginInstance.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    await pluginInstance.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    await pluginInstance.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0].path.id, 's1');
    assert.match(prompts[0].body.parts[0].text, /ts-explicit-any/);
  });
});

test('installer idempotently installs and cleanly uninstalls all 7 global harnesses + Copilot + Git hooks', () => {
  withTempDir(fakeHome => {
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } }, null, 2)
    );
    fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.codex', 'config.toml'), 'model = "gpt-5.4"\n');
    fs.mkdirSync(path.join(fakeHome, '.config', 'opencode'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.factory'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, 'Documents', 'Cline'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.codeium', 'windsurf'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.kiro'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.gemini', 'config'), { recursive: true });

    for (const target of GLOBAL_HARNESSES) {
      installHarness(target, { homeDir: fakeHome });
      installHarness(target, { homeDir: fakeHome });
    }

    const statuses = detectInstalledHarnesses({ homeDir: fakeHome });
    assert.equal(statuses.length, 9);
    assert.ok(!statuses.some(s => s.target === 'gemini'), 'Gemini CLI must not be present');
    assert.ok(statuses.every(s => s.configured), 'All 9 global harnesses should be configured');

    for (const target of GLOBAL_HARNESSES) {
      uninstallHarness(target, { homeDir: fakeHome });
    }

    const after = detectInstalledHarnesses({ homeDir: fakeHome });
    assert.ok(after.every(s => !s.configured), 'All 7 global harnesses should be cleanly uninstalled');

    const repo = path.join(fakeHome, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    execSync('git init', { cwd: repo, stdio: 'ignore' });
    installCopilotRepoHook(repo);
    installGitHook(repo);
    assert.ok(fs.existsSync(path.join(repo, '.github', 'hooks', 'code-ratchet.json')));
    assert.ok(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit')));
    uninstallCopilotRepoHook(repo);
    uninstallGitHook(repo);
    assert.ok(!fs.existsSync(path.join(repo, '.github', 'hooks', 'code-ratchet.json')));
    assert.ok(!fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit')));
  });
});

test('detectHarness handles explicit overrides and payload signatures without gemini', () => {
  assert.equal(detectHarness({}, 'codex'), 'codex');
  assert.equal(detectHarness({ clineVersion: '3.36.0' }), 'cline');
  assert.equal(detectHarness({ hook_event_name: 'pre_run_command' }), 'windsurf');
  assert.equal(detectHarness({ hook_event_name: 'stop' }), 'cursor');
  assert.equal(detectHarness({ hook_event_name: 'Stop' }), 'claude');
  assert.equal(detectHarness({ continuationActive: false }), 'antigravity');
});

test('tiered caps, DTO/test exemptions, function-size ratchet, and /ratchet slash commands work end-to-end', async () => {
  await withTempDir(async root => {
    // 1. Tiered caps: UI 450, TS 600, Rust/Go/Py 900
    assert.equal(defaultCapForFile('src/features/App.tsx'), 450);
    assert.equal(defaultCapForFile('src/lib/store.ts'), 600);
    assert.equal(defaultCapForFile('src-tauri/src/engine.rs'), 900);

    // 2. DTO, contracts, schema, generated, and frontend test files are auto-exempt
    assert.equal(isSizeExemptPath('src-tauri/src/commands/dto.rs'), true);
    assert.equal(isSizeExemptPath('src/lib/contracts.ts'), true);
    assert.equal(isSizeExemptPath('src/store/chat.test.mjs'), true);
    assert.equal(isSizeExemptPath('api/service.pb.go'), true);
    assert.equal(isSizeExemptPath('src/features/chat.tsx'), false);

    // 3. Function-size ratchet blocks newly added >120-line mega-functions
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'svc.ts'), 'export function small() {\n  return 1;\n}\n');
    initConfig(root);
    assert.equal(runCheck(root).ok, true);

    const megaBody = Array.from({ length: 130 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    fs.writeFileSync(path.join(root, 'src', 'svc.ts'), `export function megaFn() {\n${megaBody}\n  return v0;\n}\n`);
    const res = runCheck(root);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some(e => e.includes('[function-size] src/svc.ts::megaFn')));

    // Function-level escape hatch allows intentional cohesive function
    fs.writeFileSync(
      path.join(root, 'src', 'svc.ts'),
      `// ratchet-max-fn-lines: 160\nexport function megaFn() {\n${megaBody}\n  return v0;\n}\n`
    );
    assert.equal(runCheck(root).ok, true);
    assert.equal(scanFunctions('def py_fn():\n  a = 1\n  return a\n', '.py')[0].lines, 3);

    // 4. Slash command /ratchet installed & removed cleanly
    const fakeHome = path.join(root, 'home');
    installHarness('claude', { homeDir: fakeHome });
    installHarness('cursor', { homeDir: fakeHome });
    installHarness('opencode', { homeDir: fakeHome });
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'ratchet.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.cursor', 'commands', 'ratchet.md')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.config', 'opencode', 'commands', 'ratchet.md')));
    uninstallHarness('claude', { homeDir: fakeHome });
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'ratchet.md')));
  });
});
