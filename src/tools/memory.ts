/** Memory tools: write, search, forget */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';

export function registerMemoryTools(server: McpServer, session: Session): void {
  // 19. memory_write
  server.registerTool('nexus_memory_write', {
    description: 'Store a persistent memory: knowledge, decision, gotcha, or preference. Survives across sessions.',
    inputSchema: {
      key: z.string().describe('Short identifier (e.g. "auth-flow", "test-command")'),
      value: z.string().describe('The memory content'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      namespace: z.string().default('default').describe('Namespace (isolates memories by project/area)'),
    },
    annotations: { idempotentHint: true },
  }, async (args: any) => {
    const entry = session.memory.write(args.namespace, args.key, args.value, args.tags ?? []);
    await session.memory.save();
    return ok(`Memory stored: ${entry.id} (${entry.key} in ${entry.namespace})`, { id: entry.id, key: entry.key, namespace: entry.namespace, createdAt: entry.createdAt });
  });

  // 20. memory_search
  server.registerTool('nexus_memory_search', {
    description: 'Recall memories by text query, tags, or namespace.',
    inputSchema: {
      text: z.string().optional().describe('Search text (matches key or value)'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      namespace: z.string().optional().describe('Filter by namespace'),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const results = session.memory.search({ text: args.text, tags: args.tags, namespace: args.namespace, limit: args.limit });
    const text = results.length > 0 ? results.map(e => `[${e.id}] ${e.namespace}/${e.key}: ${e.value.slice(0, 200)}`).join('\n') : 'No memories found.';
    return ok(text, { results, total: results.length });
  });

  // 21. memory_forget
  server.registerTool('nexus_memory_forget', {
    description: 'Delete memories by ID or text match. Audit-logged. DESTRUCTIVE.',
    inputSchema: { idOrText: z.string().describe('Memory ID or text to match and remove') },
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async (args: any) => {
    const removed = session.memory.forget(args.idOrText);
    await session.memory.save();
    if (removed === 0) return err(`No memories matched: ${args.idOrText}`, 'PATH_NOT_FOUND');
    return ok(`Forgot ${removed} memory/memories matching: ${args.idOrText}`, { removed });
  });
}
