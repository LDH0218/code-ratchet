import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const CONFIG_NAME = '.ratchet.json';
export const DEFAULT_MAX_LINES = 800;
export const DEFAULT_MAX_FN_LINES = 120;

// Tiered file-size caps by responsibility: tight on UI, moderate on scripts, generous on backend engines
export const DEFAULT_TIER_MAX_LINES = {
  '.tsx': 450,
  '.jsx': 450,
  '.vue': 450,
  '.svelte': 450,
  '.ts': 600,
  '.js': 600,
  '.mjs': 600,
  '.cjs': 600,
  '.css': 600,
  '.scss': 600,
  '.rs': 900,
  '.go': 900,
  '.py': 900,
  '.java': 900,
  '.kt': 900,
  '.kts': 900,
  '.scala': 900,
  '.cs': 900,
  '.c': 900,
  '.cc': 900,
  '.cpp': 900,
  '.cxx': 900,
  '.h': 900,
  '.hpp': 900,
  '.rb': 900,
  '.php': 900,
  '.swift': 900,
  '.dart': 900,
  '.ex': 900,
  '.exs': 900,
  '.zig': 900,
};

// Tests, pure DTO/contract/schema definitions, migrations, and generated code are exempt from line/function caps
export const DEFAULT_SIZE_EXCLUDES = [
  '_tests.rs',
  'tests.rs',
  '_test.rs',
  '_test.go',
  '_test.py',
  '/test_',
  '.test.',
  '.spec.',
  'Test.java',
  'Test.kt',
  '/tests/',
  '/Tests/',
  '/__tests__/',
  'dto.rs',
  'dto.ts',
  'dto.py',
  'dto.go',
  'contracts.ts',
  'schema.ts',
  'schema.rs',
  'types.ts',
  '.d.ts',
  '.gen.',
  '.pb.',
  '_generated.',
  '/generated/',
  '/migrations/',
];

export const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.svelte-kit', '.turbo', 'coverage', 'venv', '.venv', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', 'vendor', '.build', '.gradle', '.mvn',
  '.dart_tool', 'cmake-build-debug', 'cmake-build-release', 'Pods',
]);

export const DEFAULT_SOURCE_EXTS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte',
  '.rs', '.go', '.py',
  '.java', '.kt', '.kts', '.scala',
  '.cs',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp',
  '.rb', '.php', '.swift', '.dart', '.ex', '.exs', '.zig',
  '.css', '.scss',
];

const MARKUP_EXTS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.html']);
const BRACE_FN_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.rs', '.go', '.java', '.kt', '.cs', '.c', '.cc', '.cpp', '.cxx', '.swift', '.dart', '.php',
]);

export function parseHeaderDirectives(content) {
  let ignoreFile = false;
  let customMaxLines = null;
  const head = content.split('\n', 10);
  for (const line of head) {
    if (line.includes('ratchet-ignore-file')) ignoreFile = true;
    const m = line.match(/ratchet-max-lines:\s*(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (n > 0) customMaxLines = n;
    }
  }
  return { ignoreFile, customMaxLines };
}

export function isSizeExemptPath(rel, excludeList = DEFAULT_SIZE_EXCLUDES) {
  const normalized = `/${rel}`;
  return excludeList.some(ex => (ex.startsWith('/') ? normalized.includes(ex) : rel.includes(ex)));
}

export function defaultCapForFile(rel, fileSizeCfg = {}) {
  const ext = path.extname(rel);
  const tiers = fileSizeCfg.tierMaxLines ?? DEFAULT_TIER_MAX_LINES;
  if (tiers && typeof tiers[ext] === 'number') return tiers[ext];
  return fileSizeCfg.defaultMaxLines ?? DEFAULT_MAX_LINES;
}

function stripStringsAndLineComment(line) {
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let inTick = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (!inSingle && !inDouble && !inTick && ch === '/' && next === '/') break;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (!inDouble && !inTick && ch === "'") inSingle = !inSingle;
    else if (!inSingle && !inTick && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === '`') inTick = !inTick;
    else if (!inSingle && !inDouble && !inTick) out += ch;
  }
  return out;
}

function detectBraceFnName(trimmed) {
  let m =
    trimmed.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)/) ||
    trimmed.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/) ||
    trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/) ||
    trimmed.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  if (m) return m[1];
  m = trimmed.match(
    /^(?:(?:public|private|protected|internal|static|final|override|virtual|async|suspend|inline)\s+)+(?:[\w<>[\]?,.\s]+?\s+)?([A-Za-z_]\w*)\s*\(/
  );
  if (m && !['if', 'for', 'while', 'switch', 'catch', 'match'].includes(m[1])) return m[1];
  return null;
}

export function scanFunctions(content, ext) {
  if (parseHeaderDirectives(content).ignoreFile) return [];
  const lines = content.split('\n');
  const rustTestStop = ext === '.rs' ? /^\s*#\[cfg\((?:test\b|all\([^)]*\btest\b)/ : null;

  if (ext === '.py') {
    const fns = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : '';
      if (line.includes('ratchet-ignore') || prevLine.includes('ratchet-ignore')) continue;
      const m = line.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
      if (!m) continue;
      const indent = m[1].length;
      const name = m[2];
      const overrideMatch = `${prevLine}\n${line}`.match(/ratchet-max-fn-lines:\s*(\d+)/);
      const customCap = overrideMatch ? Number(overrideMatch[1]) : null;
      let lastCodeLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j];
        const trimmed = sub.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const subIndent = sub.match(/^(\s*)/)[1].length;
        if (subIndent <= indent) break;
        lastCodeLine = j;
      }
      fns.push({ name, startLine: i + 1, lines: lastCodeLine - i + 1, customCap });
    }
    return fns;
  }

  if (!BRACE_FN_EXTS.has(ext)) return [];

  const fns = [];
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (rustTestStop && rustTestStop.test(raw)) break;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    const prevLine = i > 0 ? lines[i - 1] : '';
    const candidateName = braceDepth <= 1 ? detectBraceFnName(trimmed) : null;
    const cleaned = stripStringsAndLineComment(raw);

    if (
      candidateName &&
      !raw.includes('ratchet-ignore') &&
      !prevLine.includes('ratchet-ignore')
    ) {
      // Find opening brace on this line or within next 6 signature lines
      let openLine = -1;
      let sigDepth = braceDepth;
      for (let k = i; k < Math.min(lines.length, i + 7); k++) {
        const seg = stripStringsAndLineComment(lines[k]);
        if (seg.includes('{')) {
          openLine = k;
          break;
        }
        if (seg.endsWith(';')) break;
      }
      if (openLine !== -1) {
        let depth = sigDepth;
        let endLine = openLine;
        for (let k = openLine; k < lines.length; k++) {
          if (rustTestStop && k > openLine && rustTestStop.test(lines[k])) break;
          const seg = stripStringsAndLineComment(lines[k]);
          for (const ch of seg) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
          }
          if (depth <= sigDepth) {
            endLine = k;
            break;
          }
        }
        const overrideMatch = `${prevLine}\n${raw}`.match(/ratchet-max-fn-lines:\s*(\d+)/);
        const customCap = overrideMatch ? Number(overrideMatch[1]) : null;
        fns.push({
          name: candidateName,
          startLine: i + 1,
          lines: endLine - i + 1,
          customCap,
        });
      }
    }

    for (const ch of cleaned) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
  }
  return fns;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function relPath(root, full) {
  return toPosix(path.relative(root, full));
}

function hasAnyExt(files, exts) {
  const set = new Set(exts);
  return files.some(f => set.has(path.extname(f)));
}

function hasRootFileWithSuffix(root, suffix) {
  try {
    return fs.readdirSync(root).some(name => name.endsWith(suffix));
  } catch {
    return false;
  }
}

export function listGitChangedRelFiles(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  try {
    const out = execSync('git status --porcelain -uall', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).toString('utf8');
    const changed = new Set();
    for (const raw of out.split('\n')) {
      if (raw.length < 4) continue;
      let filePart = raw.slice(3).trim();
      const arrowIdx = filePart.indexOf(' -> ');
      if (arrowIdx !== -1) filePart = filePart.slice(arrowIdx + 4).trim();
      if (filePart.startsWith('"') && filePart.endsWith('"')) {
        filePart = filePart.slice(1, -1);
      }
      if (filePart) changed.add(toPosix(filePart));
    }
    return changed;
  } catch {
    return null;
  }
}

export function walkSourceFiles(root, roots, exts, ignorePaths = []) {
  const extSet = new Set(exts);
  const out = [];

  function isIgnoredRel(rel) {
    return ignorePaths.some(prefix => {
      const clean = prefix.replace(/\/$/, '');
      return rel === clean || rel.startsWith(`${clean}/`);
    });
  }

  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = relPath(root, full);
      if (isIgnoredRel(rel)) continue;
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        if (extSet.size === 0 || extSet.has(path.extname(entry.name))) {
          out.push(full);
        }
      }
    }
  }

  for (const r of roots) {
    const abs = path.resolve(root, r);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) out.push(abs);
    else visit(abs);
  }
  return [...new Set(out)].sort();
}

function fileMatchesRule(rel, rule) {
  if (rule.roots?.length) {
    const inRoot = rule.roots.some(r => {
      const clean = r.replace(/\/$/, '');
      return clean === '.' || rel === clean || rel.startsWith(`${clean}/`);
    });
    if (!inRoot) return false;
  }
  if (rule.extensions?.length) {
    if (!rule.extensions.includes(path.extname(rel))) return false;
  }
  if (rule.exclude?.length) {
    if (rule.exclude.some(ex => rel.includes(ex))) return false;
  }
  return true;
}

export function scanPattern(content, rule) {
  if (parseHeaderDirectives(content).ignoreFile) return [];
  const re = new RegExp(rule.pattern, rule.flags ?? 'g');
  const stopRe = rule.stopAtPattern ? new RegExp(rule.stopAtPattern) : null;
  const hits = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (stopRe && stopRe.test(line)) break;
    if (line.includes('ratchet-ignore') && (!line.includes('ratchet-ignore:') || line.includes(`ratchet-ignore:${rule.id}`))) {
      continue;
    }
    if (rule.skipCommentLines !== false && /^\s*(\/\/|#|\/\*|\*|--\s)/.test(line)) {
      continue;
    }
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      hits.push({ line: i + 1, match: m[0] });
    }
  }
  return hits;
}

export function scanNestedButton(content) {
  const issues = [];
  const lines = content.split('\n');
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line) || line.includes('ratchet-ignore')) continue;
    const opens = [...line.matchAll(/<button(?=\s|>|$)/g)].length;
    const closes = [...line.matchAll(/<\/button>/g)].length;
    const nestedRole =
      (depth > 0 && /role=["']button["']/.test(line)) ||
      (opens > 0 && /<button[^>]*>.*role=["']button["']/.test(line));
    if (depth > 0 && opens > 0) {
      issues.push({ line: i + 1, message: 'Nested <button> element detected' });
    }
    if (opens > 1 && closes === 0) {
      issues.push({ line: i + 1, message: 'Unclosed nested <button> on single line' });
    }
    if (nestedRole) {
      issues.push({ line: i + 1, message: 'Nested role="button" inside <button> detected' });
    }
    depth = Math.max(0, depth + opens - closes);
  }
  return issues;
}

function parseRustHandlers(libRs) {
  const blockMatch = libRs.match(/tauri::generate_handler!\s*\[([\s\S]*?)\]/);
  if (!blockMatch) return null;
  const names = new Set();
  for (const rawLine of blockMatch[1].split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    for (const part of line.split(',')) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const ident = cleaned.split('::').pop()?.trim();
      if (ident && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) names.add(ident);
    }
  }
  return names;
}

function parseContractCommands(contractsTs) {
  const start = contractsTs.indexOf('export interface CommandMap {');
  if (start === -1) return new Set();
  let braceDepth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = start; i < contractsTs.length; i++) {
    const ch = contractsTs[i];
    if (ch === '{') {
      if (braceDepth === 0) bodyStart = i + 1;
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  if (bodyStart === -1 || bodyEnd === -1) return new Set();
  const body = contractsTs.slice(bodyStart, bodyEnd);
  const names = new Set();
  let depth = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '');
    if (depth === 0) {
      const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
      if (m) names.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
  }
  return names;
}

export function checkTauriIpc(root, cfg) {
  const rustEntry = path.resolve(root, cfg.rustEntry ?? 'src-tauri/src/lib.rs');
  if (!fs.existsSync(rustEntry)) return { errors: [], count: 0 };
  const rustCommands = parseRustHandlers(fs.readFileSync(rustEntry, 'utf8'));
  if (!rustCommands) return { errors: [], count: 0 };

  const contractsFile = path.resolve(root, cfg.contractsFile ?? 'src/lib/contracts.ts');
  const contractCommands = fs.existsSync(contractsFile)
    ? parseContractCommands(fs.readFileSync(contractsFile, 'utf8'))
    : new Set();

  const srcFiles = walkSourceFiles(root, [cfg.srcRoot ?? 'src'], ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte']);
  const directInvokes = new Map();
  const re = /\binvoke\s*(?:<[^>]*>)?\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
  for (const file of srcFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(re)) {
        const cmd = m[1];
        if (!directInvokes.has(cmd)) directInvokes.set(cmd, []);
        directInvokes.get(cmd).push(`${relPath(root, file)}:${i + 1}`);
      }
    }
  }

  const allFrontend = new Set([...contractCommands, ...directInvokes.keys()]);
  const errors = [];
  for (const cmd of allFrontend) {
    if (!rustCommands.has(cmd)) {
      const sites = directInvokes.get(cmd)?.join(', ') ?? (cfg.contractsFile ?? 'src/lib/contracts.ts');
      errors.push(`[tauri-ipc] Frontend invokes/declares '${cmd}' (${sites}), missing in ${cfg.rustEntry ?? 'src-tauri/src/lib.rs'}`);
    }
  }
  for (const cmd of rustCommands) {
    if (!allFrontend.has(cmd)) {
      errors.push(`[tauri-ipc] Rust registers '${cmd}' in ${cfg.rustEntry ?? 'src-tauri/src/lib.rs'}, unused/undeclared in frontend`);
    }
  }
  return { errors, count: rustCommands.size };
}

function detectThemeHints(root) {
  const hints = {};
  const candidates = ['src/index.css', 'src/app.css', 'src/globals.css', 'app/globals.css', 'src/styles/globals.css'];
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const css = fs.readFileSync(full, 'utf8');
    for (const m of css.matchAll(/--text-([a-z0-9-]+)\s*:\s*(\d+(?:\.\d+)?px)\s*;/gi)) {
      hints[`text-[${m[2]}]`] = `text-${m[1]}`;
    }
    for (const m of css.matchAll(/--radius-([a-z0-9-]+)\s*:\s*(\d+(?:\.\d+)?px)\s*;/gi)) {
      hints[`rounded-[${m[2]}]`] = `rounded-${m[1]}`;
    }
  }
  if (!hints['rounded-[14px]']) hints['rounded-[14px]'] = 'rounded-xl';
  return hints;
}

export function detectProjectProfile(root) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null;
  const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };

  const candidateDirs = [
    'src', 'src-tauri/src', 'crates', 'internal', 'cmd', 'pkg', 'app',
    'backend', 'server', 'services', 'lib', 'Sources', 'packages',
  ];
  const discoveredRoots = candidateDirs.filter(d => fs.existsSync(path.join(root, d)));
  const roots = discoveredRoots.length > 0 ? discoveredRoots : ['.'];

  const allFiles = walkSourceFiles(root, roots, DEFAULT_SOURCE_EXTS);
  const hasTailwind = Boolean(allDeps.tailwindcss || allDeps['@tailwindcss/vite'] || allDeps['@tailwindcss/postcss']);
  const hasTs = fs.existsSync(path.join(root, 'tsconfig.json')) || Boolean(allDeps.typescript) || hasAnyExt(allFiles, ['.ts', '.tsx']);
  const hasTauri = fs.existsSync(path.join(root, 'src-tauri', 'src', 'lib.rs'));
  const hasRust = fs.existsSync(path.join(root, 'Cargo.toml')) || hasTauri || hasAnyExt(allFiles, ['.rs']);
  const hasGo = fs.existsSync(path.join(root, 'go.mod')) || hasAnyExt(allFiles, ['.go']);
  const hasPython =
    fs.existsSync(path.join(root, 'pyproject.toml')) ||
    fs.existsSync(path.join(root, 'requirements.txt')) ||
    hasAnyExt(allFiles, ['.py']);
  const hasJvm =
    fs.existsSync(path.join(root, 'pom.xml')) ||
    fs.existsSync(path.join(root, 'build.gradle')) ||
    fs.existsSync(path.join(root, 'build.gradle.kts')) ||
    hasAnyExt(allFiles, ['.java', '.kt']);
  const hasKotlin = hasAnyExt(allFiles, ['.kt']);
  const hasDotnet = hasRootFileWithSuffix(root, '.sln') || hasRootFileWithSuffix(root, '.csproj') || hasAnyExt(allFiles, ['.cs']);
  const hasCpp = fs.existsSync(path.join(root, 'CMakeLists.txt')) || hasAnyExt(allFiles, ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp']);
  const hasPhp = fs.existsSync(path.join(root, 'composer.json')) || hasAnyExt(allFiles, ['.php']);
  const hasRuby = fs.existsSync(path.join(root, 'Gemfile')) || hasAnyExt(allFiles, ['.rb']);

  const hasMarkup = hasAnyExt(allFiles, [...MARKUP_EXTS]);
  const hasCss = hasAnyExt(allFiles, ['.css', '.scss']);

  const frontendSizeRoots = fs.existsSync(path.join(root, 'src', 'features'))
    ? ['src/features']
    : discoveredRoots.includes('src')
      ? ['src']
      : [];
  const otherSizeRoots = roots.filter(r => r !== 'src');
  const fileSizeRoots = [...new Set([...frontendSizeRoots, ...otherSizeRoots])];
  const effectiveSizeRoots = fileSizeRoots.length > 0 ? fileSizeRoots : roots;

  const patterns = [];

  if (hasTailwind) {
    patterns.push({
      id: 'tailwind-arbitrary-px',
      description: 'Disallow new Tailwind arbitrary px/rem values (prefer theme tokens)',
      roots: frontendSizeRoots.length ? frontendSizeRoots : roots,
      extensions: ['.tsx', '.jsx', '.vue', '.svelte', '.ts', '.js'],
      pattern: '(?<![\\w-])(text|rounded|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|h|w|min-h|max-h|min-w|max-w)-\\[\\d+(?:\\.\\d+)?(?:px|rem|em)\\]',
      hints: detectThemeHints(root),
      budget: {},
    });
  } else if (hasCss && hasMarkup) {
    patterns.push({
      id: 'css-important',
      description: 'Disallow new !important overrides',
      roots,
      extensions: ['.css', '.scss', '.vue', '.svelte'],
      pattern: '!important\\b',
      budget: {},
    });
  }

  if (hasTs) {
    patterns.push({
      id: 'ts-explicit-any',
      description: 'Disallow new explicit any annotations',
      roots,
      extensions: ['.ts', '.tsx'],
      exclude: ['.d.ts'],
      pattern: '(?::\\s*any\\b|\\bas\\s+any\\b)',
      budget: {},
    });
  }

  if (hasRust) {
    patterns.push({
      id: 'rust-unwrap',
      description: 'Disallow new .unwrap() in production Rust code (use ?, unwrap_or, or explicit error handling)',
      roots,
      extensions: ['.rs'],
      exclude: ['tests/', '_tests.rs', 'tests.rs', '_test.rs'],
      stopAtPattern: '^\\s*#\\[cfg\\((?:test\\b|all\\([^)]*\\btest\\b)',
      pattern: '\\.unwrap\\s*\\(\\s*\\)',
      budget: {},
    });
  }

  if (hasGo) {
    patterns.push({
      id: 'go-panic',
      description: 'Disallow new panic() in Go business logic (return error instead)',
      roots,
      extensions: ['.go'],
      exclude: ['_test.go', 'cmd/'],
      pattern: '\\bpanic\\s*\\(',
      budget: {},
    });
  }

  if (hasPython) {
    patterns.push({
      id: 'python-bare-except',
      description: 'Disallow new bare except: clauses (catch specific Exception types)',
      roots,
      extensions: ['.py'],
      exclude: ['tests/', 'test_', '_test.py'],
      pattern: '^\\s*except\\s*:',
      budget: {},
    });
    patterns.push({
      id: 'python-bare-type-ignore',
      description: 'Disallow new bare # type: ignore without error codes',
      roots,
      extensions: ['.py'],
      skipCommentLines: false,
      pattern: '#\\s*type:\\s*ignore(?!\\[)',
      budget: {},
    });
  }

  if (hasJvm) {
    patterns.push({
      id: 'jvm-print-stacktrace',
      description: 'Disallow new .printStackTrace() calls (use structured logger)',
      roots,
      extensions: ['.java', '.kt'],
      exclude: ['src/test/', 'Test.java', 'Test.kt'],
      pattern: '\\.printStackTrace\\s*\\(',
      budget: {},
    });
  }

  if (hasKotlin) {
    patterns.push({
      id: 'kotlin-not-null-assert',
      description: 'Disallow new !! non-null assertions in Kotlin production code',
      roots,
      extensions: ['.kt'],
      exclude: ['src/test/', 'Test.kt'],
      pattern: '!!(?!=)',
      budget: {},
    });
  }

  if (hasDotnet) {
    patterns.push({
      id: 'csharp-empty-catch',
      description: 'Disallow new empty catch {} blocks',
      roots,
      extensions: ['.cs'],
      exclude: ['Tests/', '.Tests/'],
      pattern: '\\bcatch\\b[^\\{]*\\{\\s*\\}',
      budget: {},
    });
  }

  if (hasCpp) {
    patterns.push({
      id: 'cpp-unsafe-cstr',
      description: 'Disallow unsafe C buffer functions (gets/strcpy/strcat/sprintf)',
      roots,
      extensions: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp'],
      pattern: '\\b(gets|strcpy|strcat|sprintf)\\s*\\(',
      budget: {},
    });
  }

  if (hasPhp) {
    patterns.push({
      id: 'php-debug-dump',
      description: 'Disallow leftover var_dump/dd debug calls',
      roots,
      extensions: ['.php'],
      exclude: ['tests/'],
      pattern: '\\b(var_dump|dd)\\s*\\(',
      budget: {},
    });
  }

  if (hasRuby) {
    patterns.push({
      id: 'ruby-binding-pry',
      description: 'Disallow leftover binding.pry / debugger breakpoints',
      roots,
      extensions: ['.rb'],
      exclude: ['spec/', 'test/'],
      pattern: '\\b(binding\\.pry|byebug|debugger)\\b',
      budget: {},
    });
  }

  const stackTags = [
    hasTailwind && 'tailwind',
    hasTs && 'typescript',
    hasMarkup && 'frontend-markup',
    hasTauri && 'tauri',
    hasRust && 'rust',
    hasGo && 'go',
    hasPython && 'python',
    hasJvm && 'jvm',
    hasKotlin && 'kotlin',
    hasDotnet && 'dotnet',
    hasCpp && 'c/c++',
    hasPhp && 'php',
    hasRuby && 'ruby',
  ].filter(Boolean);

  return {
    stackTags,
    config: {
      version: 1,
      roots,
      extensions: DEFAULT_SOURCE_EXTS,
      ignore: ['src-tauri/target', 'scripts'],
      fileSize: {
        defaultMaxLines: DEFAULT_MAX_LINES,
        tierMaxLines: {
          '.tsx': 450, '.jsx': 450, '.vue': 450, '.svelte': 450,
          '.ts': 600, '.js': 600, '.mjs': 600,
          '.rs': 900, '.go': 900, '.py': 900, '.java': 900, '.kt': 900, '.cs': 900, '.cpp': 900,
        },
        roots: effectiveSizeRoots,
        exclude: DEFAULT_SIZE_EXCLUDES,
        maxLines: {},
      },
      functionSize: {
        enabled: true,
        defaultMaxLines: DEFAULT_MAX_FN_LINES,
        maxLines: {},
      },
      nestedButton: hasMarkup,
      ...(hasTauri ? { tauriIpc: { rustEntry: 'src-tauri/src/lib.rs', srcRoot: 'src', contractsFile: 'src/lib/contracts.ts' } } : {}),
      patterns,
      extraChecks: [],
    },
  };
}

export function measureConfig(root, config, filterRelSet = null) {
  const ignore = config.ignore ?? [];
  const fileSizeRoots = config.fileSize?.roots ?? config.roots ?? ['.'];
  const fileSizeExts = config.fileSize?.extensions ?? config.extensions ?? DEFAULT_SOURCE_EXTS;
  const fileSizeExclude = config.fileSize?.exclude ?? DEFAULT_SIZE_EXCLUDES;

  const rawSizeFiles = walkSourceFiles(root, fileSizeRoots, fileSizeExts, ignore).filter(file => {
    const key = relPath(root, file);
    if (isSizeExemptPath(key, fileSizeExclude)) return false;
    return !filterRelSet || filterRelSet.has(key);
  });

  const currentMaxLines = {};
  const allLineCounts = {};
  const customLineCaps = {};
  const fnEnabled = config.functionSize?.enabled !== false;
  const fnDefaultCap = config.functionSize?.defaultMaxLines ?? DEFAULT_MAX_FN_LINES;
  const allFnLengths = {};
  const currentMaxFnLines = {};
  const customFnCaps = {};

  for (const file of rawSizeFiles) {
    const key = relPath(root, file);
    const content = fs.readFileSync(file, 'utf8');
    const { ignoreFile, customMaxLines } = parseHeaderDirectives(content);
    if (ignoreFile) continue;
    if (customMaxLines) customLineCaps[key] = customMaxLines;
    const lines = content.split('\n').length;
    allLineCounts[key] = lines;
    const effDefault = customMaxLines ?? defaultCapForFile(key, config.fileSize);
    if (lines > effDefault) currentMaxLines[key] = lines;

    if (fnEnabled) {
      const fns = scanFunctions(content, path.extname(key));
      for (const fn of fns) {
        const fnKey = `${key}::${fn.name}`;
        const prev = allFnLengths[fnKey] ?? 0;
        if (fn.lines > prev) {
          allFnLengths[fnKey] = fn.lines;
          if (fn.customCap) customFnCaps[fnKey] = fn.customCap;
        }
        const effFnCap = fn.customCap ?? fnDefaultCap;
        if (fn.lines > effFnCap) {
          currentMaxFnLines[fnKey] = Math.max(currentMaxFnLines[fnKey] ?? 0, fn.lines);
        }
      }
    }
  }

  const allRoots = config.roots ?? ['.'];
  const allFiles = walkSourceFiles(root, allRoots, config.extensions ?? DEFAULT_SOURCE_EXTS, ignore).filter(file => {
    if (!filterRelSet) return true;
    return filterRelSet.has(relPath(root, file));
  });

  const nestedIssues = [];
  if (config.nestedButton) {
    for (const file of allFiles) {
      if (!MARKUP_EXTS.has(path.extname(file))) continue;
      const key = relPath(root, file);
      const content = fs.readFileSync(file, 'utf8');
      if (parseHeaderDirectives(content).ignoreFile) continue;
      for (const issue of scanNestedButton(content)) {
        nestedIssues.push({ file: key, ...issue });
      }
    }
  }

  const patternResults = [];
  for (const rule of config.patterns ?? []) {
    const ruleFiles = walkSourceFiles(
      root,
      rule.roots ?? allRoots,
      rule.extensions ?? config.extensions ?? DEFAULT_SOURCE_EXTS,
      ignore
    ).filter(file => !filterRelSet || filterRelSet.has(relPath(root, file)));
    const counts = {};
    const details = {};
    for (const file of ruleFiles) {
      const key = relPath(root, file);
      if (!fileMatchesRule(key, rule)) continue;
      const hits = scanPattern(fs.readFileSync(file, 'utf8'), rule);
      if (hits.length > 0) {
        counts[key] = hits.length;
        details[key] = hits;
      }
    }
    patternResults.push({ rule, files: ruleFiles, counts, details });
  }

  return {
    sizeFiles: rawSizeFiles,
    allLineCounts,
    customLineCaps,
    currentMaxLines,
    allFnLengths,
    customFnCaps,
    currentMaxFnLines,
    nestedIssues,
    patternResults,
  };
}

export function initConfig(root) {
  const { stackTags, config } = detectProjectProfile(root);
  const m = measureConfig(root, config);
  config.fileSize.maxLines = m.currentMaxLines;
  config.functionSize.maxLines = m.currentMaxFnLines;
  for (let i = 0; i < config.patterns.length; i++) {
    config.patterns[i].budget = m.patternResults[i].counts;
  }
  const outPath = path.join(root, CONFIG_NAME);
  fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { outPath, stackTags, config };
}

export function tightenConfig(root, allowRaise = false) {
  const cfgPath = path.join(root, CONFIG_NAME);
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`${CONFIG_NAME} not found; run 'code-ratchet init' first`);
  }
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const m = measureConfig(root, config);

  const nextMaxLines = {};
  for (const [file, lines] of Object.entries(m.currentMaxLines)) {
    const prev = config.fileSize?.maxLines?.[file];
    nextMaxLines[file] = allowRaise || prev === undefined ? lines : Math.min(prev, lines);
  }
  config.fileSize = { ...(config.fileSize ?? {}), maxLines: nextMaxLines };

  if (config.functionSize?.enabled !== false) {
    const nextMaxFns = {};
    for (const [fnKey, lines] of Object.entries(m.currentMaxFnLines)) {
      const prev = config.functionSize?.maxLines?.[fnKey];
      nextMaxFns[fnKey] = allowRaise || prev === undefined ? lines : Math.min(prev, lines);
    }
    config.functionSize = {
      enabled: true,
      defaultMaxLines: config.functionSize?.defaultMaxLines ?? DEFAULT_MAX_FN_LINES,
      ...(config.functionSize ?? {}),
      maxLines: nextMaxFns,
    };
  }

  for (let i = 0; i < (config.patterns ?? []).length; i++) {
    const rule = config.patterns[i];
    const counts = m.patternResults[i].counts;
    const nextBudget = {};
    for (const [file, count] of Object.entries(counts)) {
      const prev = rule.budget?.[file];
      nextBudget[file] = allowRaise || prev === undefined ? count : Math.min(prev, count);
    }
    rule.budget = nextBudget;
  }

  fs.writeFileSync(cfgPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { cfgPath, config };
}

export function runCheck(root, options = {}) {
  const cfgPath = path.join(root, CONFIG_NAME);
  if (!fs.existsSync(cfgPath)) {
    return { skipped: true, ok: true, errors: [], tightenHints: [], summary: 'no .ratchet.json' };
  }
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const filterRelSet = options.changedOnly ? listGitChangedRelFiles(root) : null;
  const m = measureConfig(root, config, filterRelSet);
  const errors = [];
  const tightenHints = [];

  // 1. Tiered file line-count watermarks
  for (const [file, lines] of Object.entries(m.allLineCounts)) {
    const tierCap = defaultCapForFile(file, config.fileSize);
    const cap = m.customLineCaps?.[file] ?? config.fileSize?.maxLines?.[file] ?? tierCap;
    if (lines > cap) {
      errors.push(
        `[file-size] ${file}: ${lines} lines > cap ${cap} lines (extract focused modules, or add '// ratchet-max-lines: <N>' in the file header if genuinely cohesive)`
      );
    } else if (config.fileSize?.maxLines?.[file] && lines < config.fileSize.maxLines[file] && !m.customLineCaps?.[file]) {
      tightenHints.push(`${file} reduced to ${lines} lines (watermark ${config.fileSize.maxLines[file]})`);
    }
  }

  // 2. Single-function length watermarks (only enforced when functionSize section is present in .ratchet.json)
  if (config.functionSize && config.functionSize.enabled !== false) {
    const fnDefault = config.functionSize.defaultMaxLines ?? DEFAULT_MAX_FN_LINES;
    for (const [fnKey, lines] of Object.entries(m.allFnLengths)) {
      const cap = m.customFnCaps?.[fnKey] ?? config.functionSize.maxLines?.[fnKey] ?? fnDefault;
      if (lines > cap) {
        errors.push(
          `[function-size] ${fnKey}: ${lines} lines > cap ${cap} lines (split into smaller helper functions, or add '// ratchet-max-fn-lines: <N>' above signature)`
        );
      } else if (config.functionSize.maxLines?.[fnKey] && lines < config.functionSize.maxLines[fnKey] && !m.customFnCaps?.[fnKey]) {
        tightenHints.push(`fn ${fnKey} reduced to ${lines} lines (watermark ${config.functionSize.maxLines[fnKey]})`);
      }
    }
  }

  // 3. Anti-pattern ratchets
  for (const { rule, files, counts, details } of m.patternResults) {
    for (const file of files) {
      const key = relPath(root, file);
      if (!fileMatchesRule(key, rule)) continue;
      const current = counts[key] ?? 0;
      const allowed = rule.budget?.[key] ?? 0;
      if (current > allowed) {
        const examples = (details[key] ?? [])
          .slice(0, 6)
          .map(({ line, match }) => {
            const hint = rule.hints?.[match];
            return `L${line} ${match}${hint ? ` (prefer ${hint})` : ''}`;
          })
          .join(', ');
        errors.push(`[${rule.id}] ${key}: ${current} > baseline ${allowed}\n    examples: ${examples}`);
      } else if (current < allowed) {
        tightenHints.push(`${rule.id} · ${key} reduced to ${current} (baseline ${allowed})`);
      }
    }
  }

  // 4. Interactive nested-button check
  for (const issue of m.nestedIssues) {
    errors.push(`[nested-button] ${issue.file}:${issue.line} ${issue.message}`);
  }

  // 5. Optional Tauri bidirectional IPC sync
  let ipcCount = 0;
  if (config.tauriIpc) {
    const ipc = checkTauriIpc(root, config.tauriIpc);
    ipcCount = ipc.count;
    errors.push(...ipc.errors);
  }

  // 6. Optional custom fast project checks
  for (const extra of config.extraChecks ?? []) {
    if (!extra?.command) continue;
    try {
      execSync(extra.command, {
        cwd: root,
        stdio: 'pipe',
        timeout: (extra.timeoutSec ?? 10) * 1000,
      });
    } catch (err) {
      const out = `${err.stdout?.toString?.() ?? ''}\n${err.stderr?.toString?.() ?? ''}`.trim().slice(0, 600);
      errors.push(`[extra:${extra.name ?? extra.command}] failed\n    ${out || err.message}`);
    }
  }

  const summary = `files=${m.sizeFiles.length}, rules=${(config.patterns ?? []).length}${ipcCount ? `, ipc=${ipcCount}` : ''}`;
  return { skipped: false, ok: errors.length === 0, errors, tightenHints, summary };
}
