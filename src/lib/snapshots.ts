/**
 * Snapshot/restore — checkpoint files before edits, rollback on failure.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, readTextFile } from './fsx.js';
import { log } from './log.js';

interface SnapshotEntry { relPath: string; content: string; }
interface SnapshotManifest { id: string; createdAt: string; files: SnapshotEntry[]; }

export class SnapshotStore {
  private stateDir: string;
  private snapshotDir: string;
  private maxBytes: number;

  constructor(stateDir: string, maxBytes = 10 * 1024 * 1024) {
    this.stateDir = stateDir;
    this.snapshotDir = path.join(stateDir, 'snapshots');
    this.maxBytes = maxBytes;
  }

  async create(id: string, files: { relPath: string; absPath: string }[]): Promise<{ id: string; fileCount: number; bytes: number }> {
 await fs.mkdir(this.snapshotDir, { recursive: true });
    const entries: SnapshotEntry[] = [];
    let bytes = 0;
    for (const { relPath, absPath } of files) {
      try {
        const read = await readTextFile(absPath);
        if (read.binary) continue;
        entries.push({ relPath, content: read.text });
        bytes += read.sizeBytes;
        if (bytes > this.maxBytes) { log.warn('snapshot cap reached', { bytes }); break; }
      } catch { /* file may not exist yet */ }
    }
    const manifest: SnapshotManifest = { id, createdAt: new Date().toISOString(), files: entries };
    await writeFileAtomic(path.join(this.snapshotDir, `${id}.json`), JSON.stringify(manifest));
    log.info('snapshot created', { id, files: entries.length, bytes });
    return { id, fileCount: entries.length, bytes };
  }

  async restore(id: string, root: string): Promise<{ restored: number; failed: string[] }> {
    const manifestPath = path.join(this.snapshotDir, `${id}.json`);
    let manifest: SnapshotManifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as SnapshotManifest;
    } catch {
      return { restored: 0, failed: [`Snapshot not found: ${id}`] };
    }
    let restored = 0;
    const failed: string[] = [];
    for (const entry of manifest.files) {
      try {
        const absPath = path.join(root, entry.relPath.split('/').join(path.sep));
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await writeFileAtomic(absPath, entry.content);
        restored++;
      } catch (e) { failed.push(`${entry.relPath}: ${(e as Error).message}`); }
    }
    log.info('snapshot restored', { id, restored, failed: failed.length });
    return { restored, failed };
  }

  async list(): Promise<{ id: string; createdAt: string; fileCount: number }[]> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      const results: { id: string; createdAt: string; fileCount: number }[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const m = JSON.parse(await fs.readFile(path.join(this.snapshotDir, f), 'utf8')) as SnapshotManifest;
          results.push({ id: m.id, createdAt: m.createdAt, fileCount: m.files.length });
        } catch { /* corrupt */ }
      }
      return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch { return []; }
  }
}
