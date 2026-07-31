/**
 * Indexer — orchestrates walker + parser + persistence + import resolution.
 * Incremental: files re-parsed only when mtime+size change.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CodeIndexSnapshot, FileIndex, WorkspaceConfig } from '../types.js';
import { parseFile } from './parser.js';
import { walkWorkspace } from './walker.js';
import { headHash, readTextFile } from './fsx.js';
import type { Gitignore } from './gitignore.js';
import { log } from './log.js';

const INDEX_VERSION = 1;

export class CodeIndex {
  private config: WorkspaceConfig;
  private gitignore: Gitignore;
  private snapshot: CodeIndexSnapshot | null = null;
  private indexPath: string;

  constructor(config: WorkspaceConfig, gitignore: Gitignore) {
    this.config = config;
    this.gitignore = gitignore;
    this.indexPath = path.join(config.stateDir, 'index.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      const data = JSON.parse(raw) as CodeIndexSnapshot;
      if (data.version === INDEX_VERSION && data.root === this.config.root) {
        this.snapshot = data;
        log.info('index loaded', { files: Object.keys(data.files).length });
      }
    } catch { this.snapshot = null; }
  }

  isReady(): boolean { return this.snapshot !== null; }
  getSnapshot(): CodeIndexSnapshot | null { return this.snapshot; }


  async build(force: boolean, onProgress?: (done: number, total: number) => void): Promise<{ filesIndexed: number; filesSkipped: number; durationMs: number; symbols: number; edges: number }> {
    const start = Date.now();
    const walkResult = await walkWorkspace(this.config.root, this.gitignore, { maxFiles: this.config.maxWalkFiles, respectGitignore: this.config.respectGitignore });
    const oldFiles = this.snapshot?.files ?? {};
    const newFiles: Record<string, FileIndex> = {};
    let symbols = 0, edges = 0, skipped = 0;
    const indexable = walkResult.files.filter(f => f.language !== null);
    const total = indexable.length;

    for (let i = 0; i < indexable.length; i++) {
      const entry = indexable[i]!;
      if (i % 100 === 0 && onProgress) onProgress(i, total);
      const old = oldFiles[entry.relPath];
      if (!force && old && old.sizeBytes === entry.sizeBytes && old.mtimeMs === entry.mtimeMs) {
        newFiles[entry.relPath] = old;
        symbols += old.symbols.length;
        edges += old.imports.length + old.calls.length;
        continue;
      }
      try {
        const readResult = await readTextFile(entry.absPath, this.config.maxFileBytes);
        if (readResult.binary) { skipped++; continue; }
        const parseResult = parseFile(entry.relPath, readResult.text);
        const hash = await headHash(entry.absPath);
        const fi: FileIndex = {
          file: entry.relPath, language: parseResult.language, sizeBytes: entry.sizeBytes,
          mtimeMs: entry.mtimeMs, headHash: hash, symbols: parseResult.symbols,
          imports: parseResult.imports, calls: parseResult.calls, parseBackend: 'lexical',
          parseErrors: parseResult.parseErrors, skipped: false,
        };
        newFiles[entry.relPath] = fi;
        symbols += fi.symbols.length;
        edges += fi.imports.length + fi.calls.length;
      } catch (e) {
        newFiles[entry.relPath] = {
          file: entry.relPath, language: entry.language ?? 'unknown',
          sizeBytes: entry.sizeBytes, mtimeMs: entry.mtimeMs, headHash: '',
          symbols: [], imports: [], calls: [], parseBackend: 'lexical',
          parseErrors: 1, skipped: true, skipReason: (e as Error).message,
        };
        skipped++;
      }
    }
    if (onProgress) onProgress(total, total);
    this.resolveImports(newFiles);
    const snapshot: CodeIndexSnapshot = {
      version: INDEX_VERSION, builtAt: new Date().toISOString(), root: this.config.root, files: newFiles,
      stats: { fileCount: walkResult.files.length, indexedCount: Object.keys(newFiles).length, skippedCount: skipped, symbolCount: symbols, edgeCount: edges, durationMs: Date.now() - start },
    };
    this.snapshot = snapshot;
    await this.save();
    log.info('index built', snapshot.stats);
    return { filesIndexed: Object.keys(newFiles).length, filesSkipped: skipped, durationMs: Date.now() - start, symbols, edges };
  }

  private resolveImports(files: Record<string, FileIndex>): void {
    const fileSet = new Set(Object.keys(files));
    for (const [relPath, fi] of Object.entries(files)) {
      for (const imp of fi.imports) { imp.to = this.resolveSpecifier(relPath, imp.specifier, fileSet); }
    }
  }

  private resolveSpecifier(importer: string, specifier: string, fileSet: Set<string>): string | null {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const importerDir = path.posix.dirname(importer);
      // Strip .js/.jsx/.mjs/.cjs extension (TS ESM convention: import from './foo.js')
      const bareSpec = specifier.replace(/\.(?:js|jsx|mjs|cjs|d\.ts)$/, '');
      const resolved = path.posix.normalize(path.posix.join(importerDir, bareSpec));
      const exts = ['.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.go','.rs','.c','.cpp','.h','.hpp','.lua','.rb','.php','.json'];
      if (fileSet.has(resolved)) return resolved;
      for (const ext of exts) { if (fileSet.has(resolved + ext)) return resolved + ext; }
      for (const ext of exts) { const idx = `${resolved}/index${ext}`; if (fileSet.has(idx)) return idx; }
    }
    return null;
  }

  private async save(): Promise<void> {
    if (!this.snapshot) return;
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      await fs.writeFile(this.indexPath, JSON.stringify(this.snapshot));
    } catch (e) { log.error('index save failed', { error: (e as Error).message }); }
  }
}
