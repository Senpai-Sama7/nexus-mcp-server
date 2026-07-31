/**
 * Path jail — every filesystem touch goes through here.
 *
 * Rules:
 *  - All inputs are treated as workspace-relative unless absolute.
 *  - We resolve symlinks (realpath) BEFORE the boundary check so a symlink
 *    pointing at /etc/passwd cannot escape the jail.
 *  - Comparison is case-folded on case-insensitive filesystems (macOS/Win).
 *  - Null bytes are rejected outright (path-injection hardening).
 *  - Sensitive file classes are detected here so every caller inherits them.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NexusError } from './errors.js';

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

export function normalizeCase(p: string): string {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

export interface Jail {
  root: string;               // realpath, normalized
  extraRoots: string[];       // realpaths, normalized
}

export async function createJail(root: string, extraRoots: string[] = []): Promise<Jail> {
  const real = await fs.realpath(root).catch(() => {
    throw new NexusError('PATH_NOT_FOUND', `Workspace root does not exist: ${root}`);
  });
  const extras: string[] = [];
  for (const r of extraRoots) {
    const rr = await fs.realpath(r).catch(() => null);
    if (rr) extras.push(normalizeCase(rr));
  }
  return { root: normalizeCase(real), extraRoots: extras };
}

function isInside(candidate: string, jail: Jail): boolean {
  const c = normalizeCase(candidate);
  if (c === jail.root) return true;
  if (c.startsWith(jail.root + path.sep)) return true;
  for (const r of jail.extraRoots) {
    if (c === r || c.startsWith(r + path.sep)) return true;
  }
  return false;
}

/**
 * Resolve `input` (relative to jail root or absolute) to an absolute path
 * guaranteed inside the jail. `mustExist` controls whether realpath is
 * required (for writes to new files, the PARENT must exist instead).
 */
export async function resolveInJail(jail: Jail, input: string, opts: { mustExist?: boolean } = {}): Promise<string> {
  if (!input || typeof input !== 'string') {
    throw new NexusError('PATH_INVALID', 'Path must be a non-empty string');
  }
  if (input.includes('\0')) {
    throw new NexusError('PATH_INVALID', 'Path contains a null byte');
  }
  const abs = path.isAbsolute(input) ? path.normalize(input) : path.normalize(path.join(jail.root, input));

  let resolved: string;
  try {
    resolved = await fs.realpath(abs);
  } catch {
    if (opts.mustExist) {
      throw new NexusError('PATH_NOT_FOUND', `Path does not exist: ${input}`);
    }
    // For not-yet-existing paths: verify the nearest existing ancestor.
    let dir = path.dirname(abs);
    // Guard against infinite loop at filesystem root.
    for (let i = 0; i < 64; i++) {
      try {
        const realDir = await fs.realpath(dir);
        resolved = path.join(realDir, path.relative(dir, abs));
        break;
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) {
          throw new NexusError('PATH_NOT_FOUND', `No existing ancestor for path: ${input}`);
        }
        dir = parent;
      }
    }
    if (!resolved!) {
      throw new NexusError('PATH_NOT_FOUND', `Cannot resolve path: ${input}`);
    }
  }

  if (!isInside(resolved, jail)) {
    throw new NexusError(
      'PATH_OUTSIDE_WORKSPACE',
      `Path escapes the workspace: ${input}`,
      'Only paths inside the workspace root (or explicitly granted roots) are allowed.',
    );
  }
  return resolved;
}

/** Convert an absolute (jailed) path to workspace-relative, posix-style. */
export function toRelative(jail: Jail, abs: string): string {
  const rel = path.relative(jail.root, abs);
  return rel.split(path.sep).join('/');
}

export function toAbsolute(jail: Jail, rel: string): string {
  return path.join(jail.root, rel.split('/').join(path.sep));
}

// ------------------------------------------------------------- sensitivity
const SENSITIVE_BASENAMES = new Set([
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'known_hosts', 'authorized_keys',
  '.netrc', '.npmrc', '.pypirc', '.dockercfg', '.git-credentials',
]);
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i, /\.keystore$/i, /\.jks$/i,
  /(^|[.\-_])credentials?([.\-_]|$)/i,
  /(^|[.\-_])secrets?([.\-_]|$)/i,
  /service-?account.*\.json$/i,
  /\.htpasswd$/i,
];

export function isSensitivePath(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? relPath;
  if (SENSITIVE_BASENAMES.has(base.toLowerCase())) return true;
  return SENSITIVE_PATTERNS.some((re) => re.test(base));
}

/** Refuse access when the path is sensitive unless explicitly allowed. */
export function guardSensitive(relPath: string, allowSensitive: boolean, mode: 'read' | 'write'): void {
  if (!isSensitivePath(relPath)) return;
  if (mode === 'write') {
    throw new NexusError(
      'PATH_SENSITIVE',
      `Refusing to write sensitive file: ${relPath}`,
      'Sensitive files (env, keys, credentials) are never written by NEXUS.',
    );
  }
  if (!allowSensitive) {
    throw new NexusError(
      'PATH_SENSITIVE',
      `Sensitive file blocked: ${relPath}`,
      'Pass allowSensitive:true only if you really need this file; prefer inspecting it yourself.',
    );
  }
}

/** POSIX-style join for workspace-relative paths. */
export function joinRel(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
}
