import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skippedDirectories = new Set(['.git', 'node_modules', '.next', '.expo', 'dist', 'out', 'cache', 'coverage']);
const run = promisify(execFile);
const hasGitCheckout = existsSync(join(repoRoot, '.git'));
/** Newline used when splitting file contents into lines. */
const newline = '\n';
/** Single backslash used to escape regex metacharacters. */
const backslash = '\\';

async function gitignoreLines(): Promise<readonly string[]> {
  return (await readFile(join(repoRoot, '.gitignore'), 'utf8')).split(newline);
}

/** Letters, digits and a few glob-safe symbols pass through unescaped; everything else is quoted. */
function isSafeRegExpCharacter(character: string): boolean {
  return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.includes(character);
}

/** Translates one gitignore glob into a regular expression source (star, double-star, directory patterns). */
function toRegExpSource(glob: string): string {
  const segments = glob.split('/');
  const parts: string[] = [];
  segments.forEach((segment, index) => {
    if (segment === '**') {
      parts.push('(?:[^/]+/)*');
      return;
    }
    let source = '';
    for (const character of segment) {
      if (character === '*') source += '[^/]*';
      else if (isSafeRegExpCharacter(character)) source += character;
      else source += backslash + character;
    }
    parts.push(index === segments.length - 1 ? source : source + '/');
  });
  return parts.join('');
}

/** True when one gitignore line matches the repo-relative POSIX path. */
function matchesPattern(target: string, rawLine: string): boolean {
  const line = rawLine.trim();
  if (line === '' || line.startsWith('#')) return false;
  const negated = line.startsWith('!');
  const body = negated ? line.slice(1) : line;
  if (body === '') return false;
  const directoryOnly = body.endsWith('/');
  const glob = directoryOnly ? body.slice(0, -1) : body;
  // Patterns without a slash match in any directory, exactly like Git.
  const prefix = glob.includes('/') ? '^' : '^(?:.*/)?';
  const suffix = directoryOnly ? '(?:/.*)?$' : '$';
  return new RegExp(prefix + toRegExpSource(glob) + suffix).test(target);
}

/** Last matching line wins, mirroring Git's rule for the patterns used in this repo. */
function isIgnored(target: string, lines: readonly string[]): boolean {
  let ignored = false;
  for (const line of lines) {
    if (matchesPattern(target, line)) ignored = !line.trim().startsWith('!');
  }
  return ignored;
}

/** Every on-disk file inside a private/problems directory, as a repo-relative POSIX path. */
async function findOnDiskPrivateProblemFiles(maxDepth = 6): Promise<readonly string[]> {
  const found: string[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) await walk(full, depth + 1);
        continue;
      }
      if (current.endsWith(sep + 'private' + sep + 'problems')) found.push(full);
    }
  };
  await walk(repoRoot, 0);
  return found.map((file) => relative(repoRoot, file).split(sep).join('/'));
}

async function trackedPrivateProblemFiles(): Promise<readonly string[]> {
  const { stdout } = await run('git', ['ls-files'], { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 });
  return String(stdout)
    .split(newline)
    .map((line) => line.trim())
    .filter((line) => line.includes('private/problems/'));
}

describe('problem bank secret hygiene (answerPlain / salt must never enter Git)', () => {
  it('ignores every copy of private problem material, wherever it lives', async () => {
    const lines = await gitignoreLines();
    const secrets = [
      'packages/private/problems/1.yaml',
      'packages/private/problems/30.yaml',
      'packages/backend/private/problems/1.yaml',
      'packages/backend/problems/1.secrets.yaml',
      'packages/backend/.problem-secrets/7.yaml',
      'packages/experimental/private/problems/9.yaml',
    ];
    for (const secret of secrets) {
      expect(isIgnored(secret, lines), secret + ' must be ignored by .gitignore').toBe(true);
    }
  });

  it('keeps public problem data, sources and env examples committable', async () => {
    const lines = await gitignoreLines();
    const publicPaths = [
      'packages/backend/problems/1.yaml',
      'packages/problems/1.yaml',
      'packages/backend/src/cli/problem-seed.ts',
      'packages/backend/README.md',
      '.env.example',
      'packages/contracts/.env.example',
    ];
    for (const publicPath of publicPaths) {
      expect(isIgnored(publicPath, lines), publicPath + ' must stay committable').toBe(false);
    }
  });

  it('leaves no private problem file on disk committable', async () => {
    const files = await findOnDiskPrivateProblemFiles();
    expect(files.length).toBeGreaterThan(0);
    const lines = await gitignoreLines();
    expect(files.filter((file) => !isIgnored(file, lines))).toEqual([]);
  });

  it.skipIf(!hasGitCheckout)('tracks no private problem file in git', async () => {
    expect(await trackedPrivateProblemFiles()).toEqual([]);
  });
});
