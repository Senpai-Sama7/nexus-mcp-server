/**
 * Memory store — namespaced KV with atomic persistence + LRU caps.
 * Survives across sessions. Prevents cross-project leakage via
 * workspace-namespaced files.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './fsx.js';
import { log } from './log.js';

export interface MemoryEntry {
  id: string;  namespace: string;  key: string;
 value: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export class MemoryStore {
  private stateDir: string;
  private storePath: string;
  private entries: MemoryEntry[] = [];
  private maxEntries: number;
  private dirty = false;

  constructor(stateDir: string, maxEntries = 500) {
    this.stateDir = stateDir;
    this.storePath = path.join(stateDir, 'memory.json');
    this.maxEntries = maxEntries;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.entries)) this.entries = data.entries;
      log.info('memory loaded', { count: this.entries.length });
    } catch { this.entries = []; }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    try {
      await fs.mkdir(this.stateDir, { recursive: true });
      await writeFileAtomic(this.storePath, JSON.stringify({ entries: this.entries }));
      this.dirty = false;
    } catch (e) { log.error('memory save failed', { error: (e as Error).message }); }
  }

  write(namespace: string, key: string, value: string, tags: string[] = []): MemoryEntry {
    const existing = this.entries.find(e => e.namespace === namespace && e.key === key);
    const now = new Date().toISOString();
    if (existing) { existing.value = value; existing.tags = tags; existing.updatedAt = now; this.dirty = true; return existing; }
    const entry: MemoryEntry = { id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, namespace, key, value, tags, createdAt: now, updatedAt: now };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.dirty = true;
    return entry;
  }

  search(query: { text?: string; tags?: string[]; namespace?: string; limit?: number }): MemoryEntry[] {
    let results = this.entries;
    if (query.namespace) results = results.filter(e => e.namespace === query.namespace);
    if (query.tags?.length) results = results.filter(e => query.tags!.some(t => e.tags.includes(t)));
    if (query.text) {
      const q = query.text.toLowerCase();
      results = results.filter(e => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q));
    }
    results = [...results].reverse();
    const limit = query.limit ?? 50;
    return results.slice(0, limit);
  }

  forget(idOrQuery: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.id !== idOrQuery && !e.key.includes(idOrQuery) && !e.value.includes(idOrQuery));
    const removed = before - this.entries.length;
    if (removed > 0) this.dirty = true;
    return removed;
  }

  count(): number { return this.entries.length; }
}
