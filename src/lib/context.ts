/**
 * Context engine — repo map renderer + context packs.
 * The repo map renders the project as ranked file summaries within a
 * token budget, so the agent sees the whole project at a glance.
 * Inspired by Aider's repo map.
 */

import type { CodeIndexSnapshot } from '../types.js';
import { pageRank, buildFileGraph, type DiGraph } from './graph.js';
import { estimateTokens } from '../types.js';

export interface RepoMapOptions {
  maxTokens?: number;
  focusFiles?: string[];
  format?: 'tree' | 'flat';
}

export interface RepoMapResult {
  map: string;
  tokensEstimate: number;
  fileCount: number;
  totalFiles: number;
  truncated: boolean;
}

export function renderRepoMap(snapshot: CodeIndexSnapshot, opts: RepoMapOptions = {}, g?: DiGraph): RepoMapResult {
  const maxTokens = opts.maxTokens ?? 2048;
  const focusFiles = new Set(opts.focusFiles ?? []);
  const graph = g ?? buildFileGraph(snapshot);
  const ranks = pageRank(graph, { iterations: 30 });
  const scored = Object.entries(snapshot.files).map(([relPath, fi]) => {
    let score = ranks.get(relPath) ?? 0;
    if (focusFiles.has(relPath)) score += 1.0;
    if (fi.skipped) score = -1;
    return { relPath, fi, score };
  }).filter(x => x.score >= 0);
  scored.sort((a, b) => b.score - a.score);
  const lines: string[] = [];
  let tokens = 0;
  let fileCount = 0;
  for (const { relPath, fi } of scored) {
    const entry = renderFileEntry(relPath, fi);
    const entryTokens = estimateTokens(entry);
    if (tokens + entryTokens > maxTokens && fileCount > 0) break;
    lines.push(entry);
    tokens += entryTokens;
    fileCount++;
  }
  const map = opts.format === 'flat' ? lines.join('\n') : buildTree(lines, focusFiles);
  return { map, tokensEstimate: tokens, fileCount, totalFiles: scored.length, truncated: fileCount < scored.length };
}

function renderFileEntry(relPath: string, fi: { language: string; symbols: { kind: string; qualname: string; exported: boolean }[] }): string {
  const parts = relPath.split('/');
  const indent = '  '.repeat(parts.length - 1);
  const fileName = parts[parts.length - 1] ?? '';
  if (fi.symbols.length === 0) return `${indent}${fileName}`;
  const symStrs = fi.symbols.slice(0, 20).map(s => {
    const prefix = s.exported ? '+' : ' ';
    return `${prefix}${s.kind[0]!.toUpperCase()}${s.qualname}`;
  });
  return `${indent}${fileName} -> ${symStrs.join(', ')}`;
}

function buildTree(lines: string[], focusFiles: Set<string>): string {
  const tree: Record<string, string[]> = {};
  for (const line of lines) {
    const parts = line.split('/');
    const dir = parts.slice(0, -1).join('/') || '.';
    const rest = parts.slice(-1)[0] ?? '';
    if (!tree[dir]) tree[dir] = [];
    tree[dir].push(rest);
  }
  const out: string[] = [];
  const dirs = Object.keys(tree).sort();
  for (const dir of dirs) {
    if (dir !== '.') out.push(`${dir}/`);
    for (const entry of tree[dir]!) out.push(`  ${entry}`);
  }
  return out.join('\n');
}

export interface ContextPackOptions {
  focusFiles: string[];
  maxTokens?: number;
  includeSource?: boolean;
}

export function buildContextPack(snapshot: CodeIndexSnapshot, opts: ContextPackOptions): { pack: string; tokens: number; filesIncluded: string[] } {
  const maxTokens = opts.maxTokens ?? 8192;
  const focusFiles = opts.focusFiles;
  const related = new Set<string>(focusFiles);
  for (const file of focusFiles) {
    const fi = snapshot.files[file];
    if (!fi) continue;
    for (const imp of fi.imports) { if (imp.to) related.add(imp.to); }
    for (const [otherPath, otherFi] of Object.entries(snapshot.files)) {
      if (otherFi.imports.some(imp => imp.to === file)) related.add(otherPath);
    }
  }
  const subSnapshot: CodeIndexSnapshot = { ...snapshot, files: Object.fromEntries(Object.entries(snapshot.files).filter(([p]) => related.has(p))) };
  const mapResult = renderRepoMap(subSnapshot, { maxTokens: Math.floor(maxTokens * 0.3), focusFiles });
  const parts: string[] = [`# Context Pack - ${focusFiles.length} focus file(s), ${related.size} related\n`];
  parts.push('## Repo Map (focused)');
  parts.push('```');
  parts.push(mapResult.map);
  parts.push('```\n');
  let tokens = mapResult.tokensEstimate;
  if (opts.includeSource ?? true) {
    for (const file of focusFiles) {
      if (tokens > maxTokens) break;
      const fi = snapshot.files[file];
      if (!fi) continue;
      parts.push(`## ${file} (${fi.symbols.length} symbols)`);
      parts.push('Symbols: ' + fi.symbols.map(s => `${s.kind} ${s.qualname}`).join(', '));
      parts.push('');
    }
  }
  const pack = parts.join('\n');
  return { pack, tokens, filesIncluded: [...related] };
}
