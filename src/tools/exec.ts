/** Execution tools: exec, exec_poll, test_run, diagnose */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { execCommand, execBackground, pollBg, killBg, bgCount } from '../lib/exec.js';
import { detectTestFramework, runTests, diagnose } from '../lib/verify.js';

export function registerExecTools(server: McpServer, session: Session): void {
  // 15. exec
  server.registerTool('nexus_exec', {
    description: 'Run a command with timeout, ring-buffer output, and secret redaction. Process-group killed on timeout.',
    inputSchema: {
      command: z.string().describe('Command to execute'),
      args: z.array(z.string()).optional().describe('Command arguments (as array, not shell-interpolated)'),
      timeoutMs: z.number().int().min(1000).max(600000).default(30000),
      background: z.boolean().default(false).describe('Run in background (returns a job ID)'),
      allowDangerous: z.boolean().default(false).describe('Allow dangerous commands (rm -rf, etc.)'),
    },
    annotations: { openWorldHint: true },
  }, async (args: any) => {
    const cwd = session.config.root;
    if (args.background) {
      const id = execBackground({ cwd, command: args.command, args: args.args, timeoutMs: args.timeoutMs });
      return ok(`Background job started: ${id}`, { jobId: id, command: args.command });
    }
    const result = await execCommand({ cwd, command: args.command, args: args.args, timeoutMs: args.timeoutMs, allowDangerous: args.allowDangerous });
    const text = `[${result.exitCode ?? 'null'}] ${args.command} (${result.durationMs}ms${result.timedOut ? ', TIMED OUT' : ''})\nstdout:\n${result.stdout || '(empty)'}\nstderr:\n${result.stderr || '(empty)'}`;
    return ok(text, { exitCode: result.exitCode, signal: result.signal, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs, timedOut: result.timedOut, truncated: result.truncated, suspectedInteractive: result.suspectedInteractive });
  });

  // 16. exec_poll
  server.registerTool('nexus_exec_poll', {
    description: 'Poll, list, or kill background exec jobs.',
    inputSchema: { action: z.enum(['poll', 'kill', 'list']).describe('Action to perform'), jobId: z.string().optional() },
    annotations: { readOnlyHint: true },
  }, async (args: any) => {
    const action = args.action as string;
    if (action === 'list') { return ok(`Background jobs: ${bgCount()}`, { count: bgCount() }); }
    const id = args.jobId as string;
    if (!id) return err('jobId required for poll/kill', 'VALIDATION');
    if (action === 'kill') { const killed = killBg(id); return ok(killed ? `Killed ${id}` : `Job ${id} not found`, { jobId: id, killed }); }
    const info = pollBg(id); if (!info) return err(`Job ${id} not found`, 'PATH_NOT_FOUND');
    return ok(`Job ${id}: ${info.command} (pid ${info.pid}, started ${new Date(info.startedAt).toISOString()})`, info);
  });

  // 17. test_run
  server.registerTool('nexus_test_run', {
    description: 'Detect framework (jest/vitest/pytest/cargo/go) and run tests. Returns structured pass/fail counts and failures.',
    inputSchema: { scope: z.string().optional().describe('Test file, pattern, or test name'), timeoutMs: z.number().int().min(5000).max(600000).default(60000) },
    annotations: { openWorldHint: true },
  }, async (args: any) => {
    const fws = await detectTestFramework(session.config.root);
    if (fws.length === 0) return err('No test framework detected. Check for package.json/Cargo.toml/go.mod.', 'GIT_STATE_UNSUPPORTED', 'Supported: jest, vitest, pytest, cargo, go test.');
    const fw = fws[0]!;
    const result = await runTests(session.config.root, fw, args.scope, args.timeoutMs);
    const text = `${fw}: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped (${result.durationMs}ms, exit ${result.exitCode})\n${result.failures.length > 0 ? '\nFailures:\n' + result.failures.map(f => '  ' + (f.file ? f.file + ': ' : '') + f.name + (f.message ? '\n    ' + f.message.slice(0, 200) : '')).join('\n') : ''}`;
    return ok(text, { ...result, stdout: undefined, stderr: undefined });
  });

  // 18. diagnose
  server.registerTool('nexus_diagnose', {
    description: 'Run typecheck (tsc) and linter (eslint). Parses output into structured diagnostics {file, line, col, severity, rule, message}.',
    inputSchema: { files: z.array(z.string()).optional().describe('Files to check (default: all)'), tsc: z.boolean().default(true), eslint: z.boolean().default(true) },
    annotations: { openWorldHint: true },
  }, async (args: any) => {
    const results = await diagnose(session.config.root, { tsc: args.tsc, eslint: args.eslint, files: args.files });
    if (results.length === 0) return ok('No issues found (or tools not available).', { clean: true, sources: [] });
    const allDiags = results.flatMap(r => r.diagnostics);
    const text = results.map(r => `### ${r.source} (exit ${r.exitCode}, ${r.diagnostics.length} issues)\n${r.diagnostics.slice(0, 20).map(d => `  ${d.severity} ${d.file}:${d.line}:${d.col} ${d.code ?? ''} ${d.message}`).join('\n')}${r.diagnostics.length > 20 ? `\n  ... and ${r.diagnostics.length - 20} more` : ''}`).join('\n\n');
    return ok(text, { totalDiagnostics: allDiags.length, sources: results.map(r => ({ source: r.source, count: r.diagnostics.length, exitCode: r.exitCode })), diagnostics: allDiags.slice(0, 50) });
  });
}
