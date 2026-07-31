/**
 * Gitignore engine with real git semantics:
 *  - per-directory .gitignore stacking (deeper files override shallower)
 *  - `!negation` re-includes
 *  - `**` (any depth), `*` (single segment), `?` (single char)
 *  - trailing `/` = directories only
 *  - leading `/` = anchored to the .gitignore's directory
 *  - `.git/info/exclude` honored
 *  - A file is ignored only if a matching pattern is NOT later negated.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

interface Rule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
  baseDir: string; // workspace-relative posix dir ('' = root)
  order: number;
}

const ALWAYS_IGNORE = [
  '.git/', '.hg/', '.svn/', '.nexus/snapshots/',
  'node_modules/', '.DS_Store', 'Thumbs.db',
];

function globToRegex(glob: string, anchored: boolean): RegExp {
  let re = '';
  let i = 0;
  const n = glob.length;
  while (i < n) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return new RegExp(anchored ? `^${re}` : `(^|/)${re}`);
}

export class Gitignore {
  private rules: Rule[] = [];
  private order = 0;
  private dirCache = new Map<string, boolean>();
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  async init(): Promise<void> {
    await this.addIgnoreFile('.gitignore', '');
    await this.addIgnoreFile('.git/info/exclude', '');
  }

  private async addIgnoreFile(relFile: string, baseDir: string): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.root, relFile), 'utf8');
      this.parseRules(raw, baseDir);
    } catch { /* absent is fine */ }
  }

  private parseRules(content: string, baseDir: string): void {
    for (const rawLine of content.split('\n')) {
      let line = rawLine;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line || line.startsWith('#')) continue;
      line = line.replace(/\s+$/, '');
      if (!line) continue;

      let negated = false;
      if (line.startsWith('!')) {
        negated = true;
        line = line.slice(1);
      } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
        line = line.slice(1);
      }

      let dirOnly = false;
      if (line.endsWith('/')) {
        dirOnly = true;
        line = line.slice(0, -1);
      }
      if (!line) continue;

      let anchored = false;
      if (line.startsWith('/')) {
        anchored = true;
        line = line.slice(1);
      } else if (line.includes('/')) {
        anchored = true;
      }

      this.rules.push({ regex: globToRegex(line, anchored), negated, dirOnly, baseDir, order: this.order++ });
    }
  }

  /** Lazily load .gitignore files stacked along the path's directories. */
  async warmDirs(relPath: string): Promise<void> {
    const parts = relPath.split('/');
    parts.pop();
    let cur = '';
    for (const dir of parts) {
      cur = cur ? `${cur}/${dir}` : dir;
      if (!this.dirCache.has(cur)) {
        this.dirCache.set(cur, true);
        await this.addIgnoreFile(`${cur}/.gitignore`, cur);
      }
    }
  }

  /** Synchronous check (call warmDirs first for deep paths). */
  isIgnored(relPath: string, isDir: boolean): boolean {
    for (const p of ALWAYS_IGNORE) {
      if (p.endsWith('/')) {
        if (relPath === p.slice(0, -1) || relPath.startsWith(p)) return true;
      } else if (relPath.split('/').pop() === p) {
        return true;
      }
    }
    let ignored = false;
    let bestOrder = -1;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDir) {
        const parts = relPath.split('/');
        for (let i = 1; i < parts.length; i++) {
          const prefix = parts.slice(0, i).join('/');
          const rel = rule.baseDir ? (prefix.startsWith(rule.baseDir + '/') ? prefix.slice(rule.baseDir.length + 1) : null) : prefix;
          if (rel !== null && rule.regex.test(rel) && rule.order > bestOrder) {
            ignored = !rule.negated;
            bestOrder = rule.order;
          }
        }
        continue;
      }
      let rel = relPath;
      if (rule.baseDir) {
        if (relPath === rule.baseDir || !relPath.startsWith(rule.baseDir + '/')) continue;
        rel = relPath.slice(rule.baseDir.length + 1);
      }
      if (rule.regex.test(rel) && rule.order > bestOrder) {
        ignored = !rule.negated;
        bestOrder = rule.order;
      }
    }
    return ignored;
  }
}

