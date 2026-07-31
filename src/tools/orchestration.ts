/** Orchestration tools: task_submit, task_update, task_status, fanout */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { fanOut } from '../lib/orchestrate.js';
import { execCommand } from '../lib/exec.js';

export function registerOrchestrationTools(server: McpServer, session: Session): void {
  // 22. task_submit
  server.registerTool('nexus_task_submit', {
    description: 'Submit a task DAG (directed acyclic graph). Validates cycles. Persists across restarts.',
    inputSchema: {
      nodes: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), dependsOn: z.array(z.string()).default([]) })).min(1),
    },
    annotations: { idempotentHint: true },
  }, async (args: any) => {
    const result = await session.tasks.submit(args.nodes);
    if (result.errors.length > 0) return err(result.errors.join('; '), 'TASK_CYCLE');
    return ok(`Submitted ${result.submitted} tasks.`, result);
  });

  // 23. task_update
  server.registerTool('nexus_task_update', {
    description: 'Update task status (completed/failed/in_progress). Unblocks dependents.',
    inputSchema: { id: z.string(), status: z.enum(['in_progress', 'completed', 'failed']), result: z.string().optional(), error: z.string().optional() },
  }, async (args: any) => {
    const task = await session.tasks.update(args.id, args.status, args.result, args.error);
    if (!task) return err(`Task not found: ${args.id}`, 'TASK_NOT_FOUND');
    return ok(`Task ${task.id} → ${task.status}`, { id: task.id, status: task.status });
  });

  // 24. task_status
  server.registerTool('nexus_task_status', {
    description: 'View task DAG: ready, blocked, in_progress, completed, failed.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async () => {
    const status = session.tasks.getStatus();
    const counts = { ready: status.ready.length, blocked: status.blocked.length, inProgress: status.inProgress.length, completed: status.completed.length, failed: status.failed.length };
    const next = status.ready[0];
    const text = `Tasks: ${counts.ready} ready, ${counts.blocked} blocked, ${counts.inProgress} in-progress, ${counts.completed} done, ${counts.failed} failed.${next ? '\nNext actionable: ' + next.id + ' — ' + next.title : ''}`;
    return ok(text, { ...counts, ready: status.ready, blocked: status.blocked, inProgress: status.inProgress, completed: status.completed, failed: status.failed, nextActionable: next?.id });
  });

  // 25. fanout
  server.registerTool('nexus_fanout', {
    description: 'Parallel map: run a command over multiple items with concurrency limit.',
    inputSchema: {
      command: z.string().describe('Command template (use $ITEM as placeholder)'),
      items: z.array(z.string()).min(1).describe('Items to substitute for $ITEM'),
      concurrency: z.number().int().min(1).max(8).default(4),
      timeoutMs: z.number().int().min(1000).max(300000).default(30000),
    },
    annotations: { openWorldHint: true },
  }, async (args: any) => {
    const { results, errors } = await fanOut(
      args.items as string[],
      async (item) => {
        const cmd = args.command.replace(/\$ITEM/g, item);
        const parts = cmd.split(/\s+/);
        const result = await execCommand({ cwd: session.config.root, command: parts[0]!, args: parts.slice(1), timeoutMs: args.timeoutMs });
        return { exitCode: result.exitCode, stdout: result.stdout.slice(0, 1000), stderr: result.stderr.slice(0, 500), durationMs: result.durationMs };
      },
      args.concurrency
    );
    const text = results.map((r, i) => `[${r?.exitCode ?? 'err'}] ${args.items[i]}: ${(r?.stdout ?? errors[i]?.message ?? '').slice(0, 200)}`).join('\n');
    return ok(text, { total: args.items.length, results, errors: errors.filter(Boolean) });
  });
}
