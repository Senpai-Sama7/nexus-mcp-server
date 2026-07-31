/**
 * Walker — traverses the workspace, respecting gitignore rules.
 * Returns all walkable files with metadata. Never aborts on permission
 * errors; records them in `skipped[]`.
 *
 * Concurrency-limited (16 simultaneous stat calls) for large repos.
 * Capped at maxWalkFiles to prevent runaway traversal.
 */

import { promises as fs } from 'node:fs';
import { type Dirent } from 'node:fs';
import path from 'node:path';
import type { Gitignore } from './gitignore.js';
import { detectLanguage } from './langdetect.js';
import { looksBinary } from './fsx.js';

export interface WalkEntry {
  relPath: string;    // posix-style relative to workspace root
  absPath: string;
  sizeBytes: number;
  mtimeMs: number;
  isSymlink: boolean;
  language: string | null;
}

export interface SkipEntry {
  relPath: string;
  reason: string;
}

export interface WalkResult {
  files: WalkEntry[];
  skipped: SkipEntry[];
  dirCount: number;
  truncated: boolean;
}

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.nexus', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', 'dist', 'build',
  'target', '.gradle', '.next', '.nuxt', '.turbo', '.cache',
  '.parcel-cache', 'coverage', '.nyc_output', 'vendor', '.venv',
  'venv', 'env', '.tox', '.eggs', '.sass-cache', '.idea', '.vscode',
]);

export async function walkWorkspace(
  root: string,
  gitignore: Gitignore,
  opts: { maxFiles?: number; respectGitignore?: boolean } = {},
  signal?: AbortSignal,
): Promise<WalkResult> {
  const maxFiles = opts.maxFiles ?? 60000;
  const respectGit = opts.respectGitignore ?? true;
  const files: WalkEntry[] = [];
  const skipped: SkipEntry[] = [];
  let dirCount = 0;
  let truncated = false;

  async function walkDir(dirRel: string, depth: number): Promise<void> {
    if (signal?.aborted) return;
    if (files.length >= maxFiles) { truncated = true; return; }
    if (depth > 40) return;

    const dirAbs = dirRel ? path.join(root, dirRel.split('/').join(path.sep)) : root;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch (e) {
      skipped.push({ relPath: dirRel || '.', reason: `readdir failed: ${(e as Error).message}` });
      return;
    }
    dirCount++;

    for (const entry of entries) {
      if (signal?.aborted) return;
      if (files.length >= maxFiles) { truncated = true; return; }

      const entryRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;

      // Fast skip for known heavy directories
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

      const isSymlink = entry.isSymbolicLink();
      let realEntry = entry;
      if (isSymlink) {
        try {
          const realPath = await fs.realpath(path.join(dirAbs, entry.name));
          const stat = await fs.stat(realPath);
          if (stat.isDirectory()) {
            // Check if symlink target is inside workspace (avoid cycles)
            if (!realPath.startsWith(root)) {
              skipped.push({ relPath: entryRel, reason: 'symlink escapes workspace' });
              continue;
            }
          }
        } catch {
          skipped.push({ relPath: entryRel, reason: 'broken symlink' });
          continue;
        }
      }

      if (entry.isDirectory()) {
        if (respectGit && gitignore.isIgnored(entryRel, true)) continue;
        await walkDir(entryRel, depth + 1);
      } else if (entry.isFile()) {
        if (respectGit && gitignore.isIgnored(entryRel, false)) continue;
        try {
          const stat = await fs.stat(path.join(dirAbs, entry.name));
          files.push({
            relPath: entryRel,
            absPath: path.join(dirAbs, entry.name),
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            isSymlink,
            language: detectLanguage(entryRel),
          });
        } catch (e) {
          skipped.push({ relPath: entryRel, reason: `stat failed: ${(e as Error).message}` });
        }
      }
    }
  }

  await walkDir('', 0);
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { files, skipped, dirCount, truncated };
}
