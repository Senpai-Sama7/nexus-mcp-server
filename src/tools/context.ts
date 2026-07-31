/** Context tools: repo_map, context_pack */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { renderRepoMap, buildContextPack } from '../lib/context.js';

export function registerContextTools(server: McpServer, session: Session): void {
  // 10. repo_map
  server.registerTool('nexus_repo_map', {
    description: 'Ranked repo map within a token budget. Shows top symbols per file, PageRank-ordered. Most important context feature.',
    inputSchema: { maxTokens: z.number().int().min(100).max(8192).default(2048).describe('Token budget for the map'), focusFiles: z.array(z.string()).optional().describe('Files to prioritize') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built. Call nexus_index_build first.', 'DIRTY_INDEX');
    const result = renderRepoMap(snap, { maxTokens: args.maxTokens as number, focusFiles: args.focusFiles as string[] | undefined });
    return ok(result.map, { tokensEstimate: result.tokensEstimate, fileCount: result.fileCount, totalFiles: result.totalFiles, truncated: result.truncated });
  });

  // 11. context_pack
  server.registerTool('nexus_context_pack', {
    description: 'Task-focused context bundle: repo map slice + symbol outlines of focus files + related files.',
    inputSchema: { focusFiles: z.array(z.string()).min(1).describe('Files the agent is working on'), maxTokens: z.number().int().min(500).max(32768).default(8192) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const result = buildContextPack(snap, { focusFiles: args.focusFiles as string[], maxTokens: args.maxTokens as number });
    return ok(result.pack, { tokens: result.tokens, filesIncluded: result.filesIncluded });
  });
}
