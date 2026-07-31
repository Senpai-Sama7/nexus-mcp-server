/**
 * Verify engine — framework detection + test/lint/typecheck output parsing.
 * Detects: jest, vitest, pytest, cargo, go test, tsc, eslint, ruff, mypy.
 * Parses output into structured diagnostics, never throws.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execCommand } from './exec.js';
import type { Diagnostic, TestFailure } from '../types.js';
import { log } from './log.js';

export type Framework = 'jest' | 'vitest' | 'pytest' | 'cargo' | 'go' | 'mocha' | 'phpunit' | 'unknown';

export async function detectTestFramework(cwd: string): Promise<Framework[]> {
  const found: Framework[] = [];
  const checks: { fw: Framework; files: string[] }[] = [
    { fw: 'jest', files: ['jest.config.js', 'jest.config.ts', 'jest.config.cjs', 'jest.config.mjs'] },
    { fw: 'vitest', files: ['vitest.config.ts', 'vitest.config.js', 'vite.config.ts'] },
    { fw: 'pytest', files: ['pytest.ini', 'setup.cfg', 'pyproject.toml', 'tox.ini'] },
    { fw: 'cargo', files: ['Cargo.toml'] },
    { fw: 'go', files: ['go.mod'] },
    { fw: 'phpunit', files: ['phpunit.xml', 'phpunit.xml.dist'] },
  ];
  for (const { fw, files } of checks) {
    for (const f of files) { try { await fs.access(path.join(cwd, f)); found.push(fw); break; } catch {} }
  }
  // Check package.json for test scripts
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    const testScript = pkg.scripts?.test ?? '';
    if (testScript.includes('jest')) found.push('jest');
    if (testScript.includes('vitest')) found.push('vitest');
    if (testScript.includes('mocha')) found.push('mocha');
  } catch {}
  return [...new Set(found)];
}

export interface TestRunResult {
  framework: Framework;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: TestFailure[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export async function runTests(cwd: string, framework: Framework, scope?: string, timeoutMs = 60000): Promise<TestRunResult> {
  let cmd: string;
  let args: string[];
  switch (framework) {
    case 'jest': cmd = 'npx'; args = ['jest', '--json', '--no-coverage', scope ?? ''].filter(Boolean); break;
    case 'vitest': cmd = 'npx'; args = ['vitest', 'run', '--reporter=json', scope ?? ''].filter(Boolean); break;
    case 'pytest': cmd = 'python3'; args = ['-m', 'pytest', '--tb=short', '-q', scope ?? ''].filter(Boolean); break;
    case 'cargo': cmd = 'cargo'; args = ['test', scope ?? ''].filter(Boolean); break;
    case 'go': cmd = 'go'; args = ['test', '-v', scope ?? './...'].filter(Boolean); break;
    default: cmd = 'npx'; args = ['test', scope ?? ''].filter(Boolean);
  }
  const result = await execCommand({ cwd, command: cmd, args, timeoutMs, maxOutputBytes: 131072 });
  const failures = parseTestFailures(framework, result.stdout + '\n' + result.stderr);
  const { passed, failed, skipped } = parseTestCounts(framework, result.stdout + '\n' + result.stderr);
  return { framework, passed, failed, skipped, durationMs: result.durationMs, failures, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated };
}

function parseTestCounts(fw: Framework, output: string): { passed: number; failed: number; skipped: number } {
  let passed = 0, failed = 0, skipped = 0;
  // Jest: "Tests: 3 passed, 1 failed, 0 skipped"
  const jestMatch = output.match(/Tests:\s+(\d+)\s+passed,?\s*(\d+)?\s*(?:failed)?,?\s*(\d+)?\s*(?:skipped|todo)?/i);
  if (jestMatch) { passed = parseInt(jestMatch[1] ?? '0'); failed = parseInt(jestMatch[2] ?? '0') || 0; skipped = parseInt(jestMatch[3] ?? '0') || 0; }
  // Pytest: "3 passed, 1 failed in 2.3s"
  const pyMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/);
  if (pyMatch && !jestMatch) { passed = parseInt(pyMatch[1] ?? '0'); failed = parseInt(pyMatch[2] ?? '0') || 0; skipped = parseInt(pyMatch[3] ?? '0') || 0; }
  // Go: "--- PASS: TestFoo" / "--- FAIL: TestBar"
  if (fw === 'go') { passed = (output.match(/--- PASS:/g) ?? []).length; failed = (output.match(/--- FAIL:/g) ?? []).length; skipped = (output.match(/--- SKIP:/g) ?? []).length; }
  return { passed, failed, skipped };
}

function parseTestFailures(fw: Framework, output: string): TestFailure[] {
  const failures: TestFailure[] = [];
  // Jest JSON output
  try { const jestJson = JSON.parse(output); if (jestJson.testResults) { for (const tr of jestJson.testResults) { for (const a of tr.assertionResults ?? []) { if (a.status === 'failed') failures.push({ name: a.fullName ?? a.title, file: tr.name, message: a.failureMessages?.[0] ?? '' }); } } return failures; } } catch {}
  // Pytest: "____ test_name[foo] ____" followed by traceback
  const pyFails = output.matchAll(/_{2,}\s+(.+?)\s+_{2,}([\s\S]*?)(?=_{2,}|$)/g);
  for (const m of pyFails) { failures.push({ name: m[1]!.trim(), message: m[2]!.trim().slice(0, 500) }); }
  // Go: "--- FAIL: TestName"
  const goFails = output.matchAll(/--- FAIL:\s+(\S+)/g);
  for (const m of goFails) { failures.push({ name: m[1]!.trim(), message: '' }); }
  return failures.slice(0, 50);
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  source: string;
  exitCode: number | null;
  durationMs: number;
}

export async function diagnose(cwd: string, opts: { tsc?: boolean; eslint?: boolean; ruff?: boolean; mypy?: boolean; files?: string[] } = {}): Promise<DiagnoseResult[]> {
  const results: DiagnoseResult[] = [];
  const files = opts.files ?? [];
  const fileArgs = files.length > 0 ? files : ['.'];
  if (opts.tsc ?? true) {
    const r = await execCommand({ cwd, command: 'npx', args: ['tsc', '--noEmit', '--pretty', 'false'], timeoutMs: 30000, maxOutputBytes: 65536 });
    const diags = parseTscOutput(r.stdout, r.stderr);
    if (diags.length > 0 || r.exitCode !== 0) results.push({ diagnostics: diags, source: 'tsc', exitCode: r.exitCode, durationMs: r.durationMs });
  }
  if (opts.eslint ?? true) {
    const r = await execCommand({ cwd, command: 'npx', args: ['eslint', ...fileArgs, '--format', 'compact'], timeoutMs: 30000, maxOutputBytes: 65536 });
    const diags = parseEslintOutput(r.stdout, r.stderr);
    if (diags.length > 0) results.push({ diagnostics: diags, source: 'eslint', exitCode: r.exitCode, durationMs: r.durationMs });
  }
  return results;
}

function parseTscOutput(stdout: string, stderr: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const output = stdout + '\n' + stderr;
  // "file.ts(12,3): error TS2339: Property 'foo' does not exist."
  const matches = output.matchAll(/^([^\s](?:[^()]+))\((\d+),(\d+)\):\s+(error|warning)\s+(\w+):\s+(.+)$/gm);
  for (const m of matches) {
    diags.push({ file: m[1]!.trim(), line: parseInt(m[2] ?? '0'), col: parseInt(m[3] ?? '0'), severity: m[4] as 'error' | 'warning', source: 'tsc', code: m[5], message: m[6]!.trim() });
  }
  return diags.slice(0, 100);
}

function parseEslintOutput(stdout: string, stderr: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const output = stdout + '\n' + stderr;
  // Compact: "path:line:col: severity message [rule]"
  const matches = output.matchAll(/^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)(?:\s+\[([^\]]+)\])?$/gm);
  for (const m of matches) {
    diags.push({ file: m[1]!.trim(), line: parseInt(m[2] ?? '0'), col: parseInt(m[3] ?? '0'), severity: m[4] as 'error' | 'warning', source: 'eslint', code: m[6], message: m[5]!.trim() });
  }
  return diags.slice(0, 100);
}
