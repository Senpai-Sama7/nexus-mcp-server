/**
 * Git wrapper — porcelain-based probes for diffs, state, branch.
 * Detects: not a repo, unborn HEAD, detached, merge/rebase in progress,
 * shallow clone, worktree, submodule. Never throws — returns gitState.
 */

import { execCommand } from './exec.js';

export interface GitState {
  isRepo: boolean;
  branch: string | null;  detached: boolean;  unbornHead: boolean;  merging: boolean;
  rebasing: boolean;
  shallow: boolean;
  hasWorktree: boolean;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
}

export async function getGitState(cwd: string): Promise<GitState> {
  const result = await execCommand({ cwd, command: 'git', args: ['status', '--porcelain=v2', '--branch'], timeoutMs: 5000 });
  const state: GitState = { isRepo: false, branch: null, detached: false, unbornHead: false, merging: false, rebasing: false, shallow: false, hasWorktree: false, stagedCount: 0, modifiedCount: 0, untrackedCount: 0 };
  if (!result.exitCode || result.exitCode !== 0) {
    if (result.stderr.includes('not a git repository')) return state;
    if (result.stderr.includes('fatal: not a git')) return state;
  }
  state.isRepo = true;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('# branch.head=')) {
      const val = line.slice(14).trim();
      if (val === '(detached)') state.detached = true; else state.branch = val;
    }
    if (line.startsWith('# branch.upstream=')) state.branch = state.branch;
    if (line.startsWith('#') && line.includes('unborn')) state.unbornHead = true;
    if (line.startsWith('1 ')) state.stagedCount++;
    if (line.startsWith('2 ')) state.stagedCount++;
    if (line.startsWith('? ')) state.untrackedCount++;
    if (line.startsWith('u ') || line.startsWith('1 ') && line.includes('.S')) state.modifiedCount++;
  }
  // Check for merge/rebase
  const mergeResult = await execCommand({ cwd, command: 'test', args: ['-d', '.git/MERGE_HEAD'], timeoutMs: 2000 });
  state.merging = mergeResult.exitCode === 0;
 const rebaseResult = await execCommand({ cwd, command: 'test', args: ['-d', '.git/rebase-merge'], timeoutMs: 2000 });
  state.rebasing = rebaseResult.exitCode === 0;
  return state;
}

export interface GitDiffResult {
  filesChanged: number;
  insertions: number;
  deletions: number;
  diff: string;
  binaryFiles: string[];
  truncated: boolean;
}

export async function getGitDiff(cwd: string, opts: { staged?: boolean; maxBytes?: number } = {}): Promise<GitDiffResult> {
  const args = ['diff', '--stat', '--numstat'];
  if (opts.staged) args.push('--cached');
  const statResult = await execCommand({ cwd, command: 'git', args, timeoutMs: 10000 });
  let filesChanged = 0, insertions = 0, deletions = 0;
  for (const line of statResult.stdout.split('\n')) {
    if (line.match(/^\d+\s+\d+\s+/)) {
      const parts = line.split('\t');
      if (parts.length >= 3) { insertions += parseInt(parts[0] ?? '0', 10) || 0; deletions += parseInt(parts[1] ?? '0', 10) || 0; filesChanged++; }
    }
  }
  const diffArgs = ['diff'];
  if (opts.staged) diffArgs.push('--cached');
  const diffResult = await execCommand({ cwd, command: 'git', args: diffArgs, timeoutMs: 10000, maxOutputBytes: opts.maxBytes ?? 65536 });
  const binaryFiles: string[] = [];
  for (const line of diffResult.stdout.split('\n')) { if (line.startsWith('Binary files')) binaryFiles.push(line); }
  return { filesChanged, insertions, deletions, diff: diffResult.stdout, binaryFiles, truncated: diffResult.truncated };
}
