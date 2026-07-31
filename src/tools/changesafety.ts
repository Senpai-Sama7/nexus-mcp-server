/** Change safety tools: impact_analysis, git_diff, snapshot, restore */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { buildFileGraph, reachableBackward, buildCallGraph } from '../lib/graph.js';
import { getGitDiff } from '../lib/git.js';
import { resolveInJail, toRelative } from '../lib/paths.js';

export function registerChangeSafetyTools(server: McpServer, session: Session): void {
  // 12. impact_analysis
  server.registerTool('nexus_impact_analysis', {
    description: 'Blast radius of editing a symbol or file: what else would be affected? Uses reverse reachability on the dependency/call graph.',
    inputSchema: { target: z.string().describe('Symbol name or file path'), mode: z.enum(['file', 'symbol']).default('file') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const mode = args.mode as 'file' | 'symbol';
    const target = args.target as string;
    if (mode === 'file') {
      const g = buildFileGraph(snap);
      if (!g.nodes.has(target)) return err(`File not in graph: ${target}`, 'PATH_NOT_FOUND');
      const affected = reachableBackward(g, target);
      const testFiles = [...affected].filter(f => f.includes('test') || f.includes('spec') || f.includes('__test'));
      const text = `Impact of editing ${target}:\n  Affected files: ${affected.size}\n  Test files affected: ${testFiles.length}\n${[...affected].sort().map(f => '  ' + f).join('\n')}`;
      return ok(text, { target, mode, affectedFiles: [...affected].sort(), affectedCount: affected.size, testFilesAffected: testFiles.length });
    } else {
      const g = buildCallGraph(snap);
      const start = [...g.nodes.keys()].filter(n => n.toLowerCase().includes(target.toLowerCase()));
      if (start.length === 0) return err(`Symbol not found: ${target}`, 'SYMBOL_NOT_FOUND');
      const affected = reachableBackward(g, start[0]!);
      const text = `Impact of changing ${start[0]}:\n  Affected functions: ${affected.size}\n${[...affected].sort().map(f => '  ' + f).join('\n')}`;
      return ok(text, { target: start[0], mode, affectedSymbols: [...affected].sort(), affectedCount: affected.size });
    }
  });

  // 13. git_diff
  server.registerTool('nexus_git_diff', {
    description: 'Smart git diff: stat summary + paginated hunks. Binary files flagged.',
    inputSchema: { staged: z.boolean().default(false).describe('Show staged changes') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const diff = await getGitDiff(session.config.root, { staged: args.staged as boolean });
    const text = `Diff (${diff.filesChanged} files, +${diff.insertions} -${diff.deletions})${diff.truncated ? ' [truncated]' : ''}${diff.binaryFiles.length > 0 ? '\nBinary: ' + diff.binaryFiles.join(', ') : ''}\n\n${diff.diff || '(no changes)'}`;
    return ok(text, { ...diff, diff: undefined });
  });

  // 14. snapshot
  server.registerTool('nexus_snapshot', {
    description: 'Checkpoint files before editing. Creates a restore point with full file contents.',
    inputSchema: { id: z.string().describe('Snapshot ID (use a descriptive name)'), files: z.array(z.string()).min(1).describe('Files to snapshot (workspace-relative)') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const files = (args.files as string[]).map(f => ({ relPath: f, absPath: '' }));
    for (const f of files) { f.absPath = await resolveInJail(session.jail, f.relPath, { mustExist: true }); }
    const result = await session.snapshots.create(args.id as string, files);
    return ok(`Snapshot created: ${result.id} (${result.fileCount} files, ${result.bytes} bytes)`, result);
  });

  // 15. restore
  server.registerTool('nexus_restore', {
    description: 'Restore files from a snapshot. Overwrites current content. DESTRUCTIVE.',
    inputSchema: { id: z.string().describe('Snapshot ID to restore') },
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async (args: any) => {
    const result = await session.snapshots.restore(args.id as string, session.config.root);
    if (result.restored === 0 && result.failed.length > 0) return err(result.failed[0]!, 'SNAPSHOT_NOT_FOUND');
    return ok(`Restored ${result.restored} files from snapshot ${args.id}${result.failed.length > 0 ? ' (' + result.failed.length + ' failed)' : ''}`, result);
  });
}
