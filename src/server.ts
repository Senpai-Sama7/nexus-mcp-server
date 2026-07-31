/**
 * NEXUS MCP Server — god-tier code intelligence for agentic coding agents.
 * 30 tools across 10 families: workspace, code intelligence, context,
 * change safety, execution, memory, orchestration, security, refactor, meta.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Session } from './session.js';
import { log } from './lib/log.js';
import { NexusError, asNexusError } from './lib/errors.js';
import { registerWorkspaceTools } from './tools/workspace.js';
import { registerCodeIntelTools } from './tools/codeintel.js';
import { registerContextTools } from './tools/context.js';
import { registerChangeSafetyTools } from './tools/changesafety.js';
import { registerExecTools } from './tools/exec.js';
import { registerMemoryTools } from './tools/memory.js';
import { registerOrchestrationTools } from './tools/orchestration.js';
import { registerSecurityTools } from './tools/security.js';
import { registerRefactorTools } from './tools/refactor.js';
import { registerMetaTools } from './tools/meta.js';

async function main() {
  const root = process.env.NEXUS_WORKSPACE || process.cwd();
  const session = await Session.create(root);
  const server = new McpServer(
    { name: 'nexus', version: '1.0.0' },
    { capabilities: { logging: {} }, instructions: 'NEXUS — deep code intelligence, change-impact awareness, persistent memory, engineered context, verified execution, and deterministic orchestration.' }
  );

  registerWorkspaceTools(server, session);
  registerCodeIntelTools(server, session);
  registerContextTools(server, session);
  registerChangeSafetyTools(server, session);
  registerExecTools(server, session);
  registerMemoryTools(server, session);
  registerOrchestrationTools(server, session);
  registerSecurityTools(server, session);
  registerRefactorTools(server, session);
  registerMetaTools(server, session);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('nexus server started', { root, tools: 30 });
}

main().catch((e) => { log.error('fatal', { error: (e as Error).message }); process.exit(1); });
