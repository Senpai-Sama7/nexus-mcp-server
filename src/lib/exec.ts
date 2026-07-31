/**
 * Exec engine — process-group management with timeout, ring-buffer output,
 * and dangerous-command gating.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { redactSecretsInText } from './secrets.js';
import { log } from './log.js';

export interface ExecOptions {
  cwd: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  keepAnsi?: boolean;
  allowDangerous?: boolean;
  background?: boolean;
}

export interface ExecResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;  command: string;
  suspectedInteractive: boolean;
}

const DANGEROUS = [/(?:^|\s)rm\s+-rf?\s+\/(?:\s|$)/, /mkfs/, /:\(\)\s*\{\s*:|:\|:&\s*\};:/, /dd\s+.*of=\/dev\//, /git\s+push\s+--force/];

function isDangerous(cmd: string): boolean {
  return DANGEROUS.some(re => re.test(cmd));
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function execCommand(opts: ExecOptions): Promise<ExecResult> {
  const maxOutput = opts.maxOutputBytes ?? 65536;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const cmd = opts.command;
  const args = opts.args ?? [];

  if (!opts.allowDangerous && isDangerous(cmd + ' ' + args.join(' '))) {
    return Promise.resolve({
      exitCode: null, signal: null, stdout: '', stderr: 'Command blocked by dangerous-command filter. Pass allowDangerous:true to override.',
      truncated: false, timedOut: false, durationMs: 0, command: cmd, suspectedInteractive: false,
    });
  }

  return new Promise((resolve) => {
    const start = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env, CI: '1', TERM: 'dumb' },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      resolve({ exitCode: null, signal: null, stdout: '', stderr: `Failed to spawn: ${(e as Error).message}. PATH=${process.env.PATH ?? 'unset'}`, truncated: false, timedOut: false, durationMs: 0, command: cmd, suspectedInteractive: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    const head = { stdout: '', stderr: '' };
    const tail = { stdout: [] as string[], stderr: [] as string[] };

    const onData = (stream: NodeJS.ReadableStream | null, which: 'stdout' | 'stderr') => (chunk: Buffer) => {
      let text = chunk.toString('utf8');
      if (!opts.keepAnsi) text = stripAnsi(text);
      text = redactSecretsInText(text);
      const bytes = Buffer.byteLength(text);
      if (which === 'stdout') { stdoutBytes += bytes; } else { stderrBytes += bytes; }
      const cur = which === 'stdout' ? stdoutBytes : stderrBytes;
      const headMax = Math.floor(maxOutput / 2);
      if (cur <= headMax) { if (which === 'stdout') head.stdout += text; else head.stderr += text; }
      else { const arr = which === 'stdout' ? tail.stdout : tail.stderr; arr.push(text); if (arr.join('').length > headMax) arr.shift(); }
    };

    child.stdout?.on('data', onData(child.stdout, 'stdout'));
    child.stderr?.on('data', onData(child.stderr, 'stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const msg = err.message;
      const isENOENT = (err as NodeJS.ErrnoException).code === 'ENOENT';
      resolve({
        exitCode: null, signal: null, stdout: '',
        stderr: isENOENT ? `Command not found: ${cmd}. PATH=${process.env.PATH ?? 'unset'}` : msg,
        truncated: false, timedOut: false, durationMs: Date.now() - start, command: cmd, suspectedInteractive: false,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const out = head.stdout + (tail.stdout.length ? '...[truncated]...\n' + tail.stdout.join('') : '');
      const err = head.stderr + (tail.stderr.length ? '...[truncated]...\n' + tail.stderr.join('') : '');
      resolve({
        exitCode: code, signal: signal, stdout: out, stderr: err,
        truncated: stdoutBytes > maxOutput || stderrBytes > maxOutput,
        timedOut, durationMs: Date.now() - start, command: cmd,
        suspectedInteractive: stderr.includes('not a terminal') || stdout.includes('is not a tty'),
      });
    });
  });
}

// Background exec registry
const bgRegistry = new Map<string, { process: ChildProcess; startedAt: number; cwd: string; command: string }>();
let bgCounter = 0;

export function execBackground(opts: ExecOptions): string {
  const id = `bg-${++bgCounter}`;
  const cmd = opts.command;
  const args = opts.args ?? [];
  const child = spawn(cmd, args, {
    cwd: opts.cwd, env: { ...process.env, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  bgRegistry.set(id, { process: child, startedAt: Date.now(), cwd: opts.cwd, command: cmd });
  child.on('close', () => { bgRegistry.delete(id); });
  log.info('bg exec started', { id, command: cmd });
  return id;
}

export function pollBg(id: string): { running: boolean; pid: number | undefined; startedAt: number; cwd: string; command: string } | null {
  const entry = bgRegistry.get(id);
  if (!entry) return null;
  return { running: true, pid: entry.process.pid, startedAt: entry.startedAt, cwd: entry.cwd, command: entry.command };
}

export function killBg(id: string): boolean {
  const entry = bgRegistry.get(id);
  if (!entry) return false;
  try { if (process.platform !== 'win32' && entry.process.pid) process.kill(-entry.process.pid, 'SIGTERM'); else entry.process.kill('SIGTERM'); } catch { entry.process.kill('SIGTERM'); }
  return true;
}

export function bgCount(): number { return bgRegistry.size; }
