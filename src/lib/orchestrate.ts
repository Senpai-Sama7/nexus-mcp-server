/**
 * Orchestration — DAG task management + parallel fan-out.
 * Provides a shared blackboard for multi-agent coordination.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './fsx.js';
import { log } from './log.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependsOn: string[];
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export class TaskDAG {
  private stateDir: string;
  private tasksDir: string;
  private tasks: Map<string, TaskNode> = new Map();

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    this.tasksDir = path.join(stateDir, 'tasks');
  }

  async load(): Promise<void> {
    try {
      const files = await fs.readdir(this.tasksDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const t = JSON.parse(await fs.readFile(path.join(this.tasksDir, f), 'utf8')) as TaskNode;
          this.tasks.set(t.id, t);
        } catch { /* corrupt */ }
      }
      log.info('tasks loaded', { count: this.tasks.size });
    } catch { /* dir doesn't exist */ }
  }

  async submit(nodes: Omit<TaskNode, 'status' | 'createdAt' | 'updatedAt'>[]): Promise<{ submitted: number; errors: string[] }> {
    const errors: string[] = [];
    const now = new Date().toISOString();
    const newIds = new Set(nodes.map(n => n.id));
    // Validate: no cycles (Kahn's), no unknown deps, no dup ids
    for (const node of nodes) {
      if (this.tasks.has(node.id)) { errors.push(`Duplicate task id: ${node.id}`); continue; }
      for (const dep of node.dependsOn) {
        if (!this.tasks.has(dep) && !newIds.has(dep)) { errors.push(`Task ${node.id} depends on unknown task: ${dep}`); }
      }
    }
    if (errors.length > 0) return { submitted: 0, errors };
    // Cycle detection
    const adj = new Map<string, string[]>();
    for (const node of nodes) adj.set(node.id, node.dependsOn);
    const visited = new Map<string, number>();
    const hasCycle = (id: string, path: Set<string>): boolean => {
      if (path.has(id)) return true;
      if (visited.get(id) === 2) return false;
      path.add(id);
      for (const dep of adj.get(id) ?? []) { if (hasCycle(dep, new Set(path))) return true; }
      path.delete(id);
      visited.set(id, 2);
      return false;
    };
    for (const node of nodes) { if (hasCycle(node.id, new Set())) { errors.push(`Cycle detected involving task: ${node.id}`); } }
    if (errors.length > 0) return { submitted: 0, errors };

    for (const node of nodes) {
      const t: TaskNode = { ...node, status: 'pending', createdAt: now, updatedAt: now };
      this.tasks.set(t.id, t);
      await this.saveTask(t);
    }
    return { submitted: nodes.length, errors };
  }

  async update(id: string, status: TaskStatus, result?: string, error?: string): Promise<TaskNode | null> {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.status = status;
    if (result !== undefined) task.result = result;
    if (error !== undefined) task.error = error;
    task.updatedAt = new Date().toISOString();
    await this.saveTask(task);
    // Unblock dependents
    if (status === 'completed') {
      for (const [, t] of this.tasks) {
        if (t.dependsOn.includes(id) && t.status === 'blocked') {
          const allDone = t.dependsOn.every(d => this.tasks.get(d)?.status === 'completed');
          if (allDone) { t.status = 'pending'; t.updatedAt = new Date().toISOString(); await this.saveTask(t); }
        }
      }
    }
    if (status === 'failed') {
      for (const [, t] of this.tasks) {
        if (t.dependsOn.includes(id) && t.status === 'pending') { t.status = 'blocked'; t.error = `Dependency ${id} failed`; t.updatedAt = new Date().toISOString(); await this.saveTask(t); }
      }
    }
    return task;
  }

  getStatus(): { ready: TaskNode[]; blocked: TaskNode[]; inProgress: TaskNode[]; completed: TaskNode[]; failed: TaskNode[] } {
    const result = { ready: [] as TaskNode[], blocked: [] as TaskNode[], inProgress: [] as TaskNode[], completed: [] as TaskNode[], failed: [] as TaskNode[] };
    for (const [, t] of this.tasks) {
      if (t.status === 'pending') {
 const allDone = t.dependsOn.every(d => this.tasks.get(d)?.status === 'completed');
        (allDone ? result.ready : result.blocked).push(t);
      } else if (t.status === 'in_progress') result.inProgress.push(t);
      else if (t.status === 'completed') result.completed.push(t);
      else if (t.status === 'failed') result.failed.push(t);
      else result.blocked.push(t);
    }
    return result;
  }

  private async saveTask(t: TaskNode): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true });
    await writeFileAtomic(path.join(this.tasksDir, `${t.id}.json`), JSON.stringify(t));
  }
}

/** Parallel fan-out: run a function over items with concurrency limit. */
export async function fanOut<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>, concurrency = 4): Promise<{ results: R[]; errors: (Error | null)[] }> {
  const results: R[] = new Array(items.length);
  const errors: (Error | null)[] = new Array(items.length).fill(null);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i]!, i); } catch (e) { errors[i] = e as Error; }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return { results, errors };
}
