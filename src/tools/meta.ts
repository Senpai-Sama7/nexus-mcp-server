/** Meta tools: server_status, guide */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok } from './common.js';
import { bgCount } from '../lib/exec.js';

export function registerMetaTools(server: McpServer, session: Session): void {
  // 29. server_status
  server.registerTool('nexus_server_status', {
    description: 'Server self-diagnostics: index age, backend, caps, state dirs, version.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async () => {
    const snap = session.index.getSnapshot();
    const status = {
      version: '1.0.0',
      root: session.config.root,
      indexReady: snap !== null,
      indexBuiltAt: snap?.builtAt,
      indexedFiles: snap?.stats.indexedCount ?? 0,
      symbolCount: snap?.stats.symbolCount ?? 0,
      edgeCount: snap?.stats.edgeCount ?? 0,
      memoryCount: session.memory.count(),
      bgJobs: bgCount(),
      parseBackend: 'lexical',
      stateDir: session.config.stateDir,
    };
    const text = `NEXUS v${status.version}\nRoot: ${status.root}\nIndex: ${status.indexReady ? status.indexedFiles + ' files, ' + status.symbolCount + ' symbols (built ' + status.indexBuiltAt + ')' : 'not built'}\nMemory: ${status.memoryCount} entries\nBackground jobs: ${status.bgJobs}\nBackend: ${status.parseBackend}\nState: ${status.stateDir}`;
    return ok(text, status);
  });

  // 30. guide
  server.registerTool('nexus_guide', {
    description: 'On-demand playbook: recommended workflows, recipes, and gotchas for using NEXUS effectively.',
    inputSchema: { topic: z.string().optional().describe('Specific topic (e.g. "refactor", "debug", "new-feature")') },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const topic = args.topic as string | undefined;
    const guides: Record<string, string> = {
      default: `## NEXUS Quick Start\n1. nexus_index_build — build the code index\n2. nexus_repo_map — see the project at a glance\n3. nexus_find_symbols — locate functions/classes\n4. nexus_impact_analysis — check blast radius before editing\n5. nexus_snapshot — checkpoint before risky changes\n6. nexus_memory_write — record decisions/gotchas\n7. nexus_test_run — verify your changes`,
      refactor: `## Refactoring Workflow\n1. nexus_index_build (force:true if stale)\n2. nexus_find_symbols name:"oldName" — locate the symbol\n3. nexus_impact_analysis target:"oldName" mode:"symbol" — see blast radius\n4. nexus_snapshot files:[...] — checkpoint affected files\n5. nexus_rename_symbol file:... oldName:... newName:... (preview first!)\n6. Review preview, then apply:true\n7. nexus_test_run — verify`,
      debug: `## Debugging Workflow\n1. nexus_diagnose — run typecheck + linter\n2. nexus_test_run — run tests, see structured failures\n3. nexus_search pattern:"error message" — find relevant code\n4. nexus_call_graph symbol:... direction:callers — trace callers\n5. nexus_memory_write key:... value:... — record the fix`,
      'new-feature': `## New Feature Workflow\n1. nexus_workspace_overview — understand the project\n2. nexus_repo_map — see structure + top symbols\n3. nexus_context_pack focusFiles:[...] — get focused context\n4. nexus_dependency_graph file:... — understand dependencies\n5. nexus_snapshot — checkpoint before starting\n6. Implement (using nexus_read_span, nexus_search for details)\n7. nexus_test_run — verify\n8. nexus_secret_scan — check no secrets leaked\n9. nexus_memory_write — record decisions`,
    };
    const guide = guides[topic ?? 'default'] ?? guides.default!;
    return ok(guide, { topic: topic ?? 'default' });
  });
}
