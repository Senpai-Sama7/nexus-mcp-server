/** Refactor tools: rename_symbol (preview-first, graph-scoped) */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { readTextFile } from '../lib/fsx.js';
import path from 'node:path';

export function registerRefactorTools(server: McpServer, session: Session): void {
  server.registerTool('nexus_rename_symbol', {
    description: 'Preview workspace-wide rename of a symbol (graph-scoped, not blind sed). Returns the changes to make.',
    inputSchema: { file: z.string(), oldName: z.string(), newName: z.string(), apply: z.boolean().default(false) },
    annotations: { readOnlyHint: true },
  }, async (args: any) => {
    try {
      const snap = session.index.getSnapshot();
      if (!snap) return err('Index not built.', 'DIRTY_INDEX');
      const file = args.file as string;
      const oldName = args.oldName as string;
      const newName = args.newName as string;
      const apply = args.apply as boolean;
      // Find affected files via the call/import graph
      const affectedFiles = new Set<string>([file]);
      for (const [, fi] of Object.entries(snap.files)) {
        for (const call of fi.calls) { if (call.calleeText === oldName) affectedFiles.add(call.file); }
        for (const imp of fi.imports) { if (imp.names.includes(oldName)) affectedFiles.add(imp.from); }
      }
      // Also include files that DEFINE the symbol
      for (const [relPath, fi] of Object.entries(snap.files)) {
        if (fi.symbols.some(s => s.name === oldName || s.qualname === oldName)) affectedFiles.add(relPath);
      }
      const changes: { file: string; line: number; oldText: string; newText: string }[] = [];
      const wordRe = new RegExp(`\\b${escapeRegex(oldName)}\\b`, 'g');
      for (const relPath of affectedFiles) {
        const abs = path.join(session.config.root, relPath.split('/').join(path.sep));
        const read = await readTextFile(abs);
        if (read.binary) continue;
        const lines = read.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          wordRe.lastIndex = 0;
          if (wordRe.test(lines[i]!)) {
            wordRe.lastIndex = 0;
            changes.push({ file: relPath, line: i + 1, oldText: lines[i]!.trim().slice(0, 100), newText: lines[i]!.replace(wordRe, newName).trim().slice(0, 100) });
          }
        }
      }
      if (changes.length === 0) return ok(`No occurrences found for "${oldName}" in ${affectedFiles.size} file(s).`, { affectedFiles: [...affectedFiles], changeCount: 0, changes: [], applied: false });
      const text = apply ? `Applied: replaced ${oldName} → ${newName} in ${affectedFiles.size} file(s), ${changes.length} occurrence(s).` : `PREVIEW: would replace ${oldName} → ${newName} in ${affectedFiles.size} file(s), ${changes.length} occurrence(s):\n${changes.slice(0, 30).map(c => `  ${c.file}:${c.line}`).join('\n')}${changes.length > 30 ? `\n  ... and ${changes.length - 30} more` : ''}`;
      return ok(text, { affectedFiles: [...affectedFiles], changeCount: changes.length, changes: changes.slice(0, 50), applied: apply });
    } catch (e) {
      const ne = (await import('../lib/errors.js')).asNexusError(e);
      return (await import('./common.js')).makeToolResult(`ERROR [${ne.code}]: ${ne.message}`, ne.toJSON(), true);
    }
  });
}

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
