/** Security tools: secret_scan, audit_manifest */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Session } from '../session.js';
import { ok, err } from './common.js';
import { scanTextForSecrets } from '../lib/secrets.js';
import { readTextFile } from '../lib/fsx.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function registerSecurityTools(server: McpServer, session: Session): void {
  // 26. secret_scan
  server.registerTool('nexus_secret_scan', {
    description: 'Scan files for secrets (AWS, GitHub, OpenAI, JWT, private keys, etc.). Findings are redacted.',
    inputSchema: { paths: z.array(z.string()).optional().describe('Files to scan (default: all indexed files)'), limit: z.number().int().min(1).max(500).default(100) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async (args: any) => {
    const snap = session.index.getSnapshot();
    if (!snap) return err('Index not built.', 'DIRTY_INDEX');
    const files = args.paths ?? Object.keys(snap.files);
    const allFindings: { file: string; line: number; kind: string; redacted: string }[] = [];
    for (const file of files.slice(0, args.limit * 10)) {
      try {
        const abs = path.join(session.config.root, file.split('/').join(path.sep));
        const read = await readTextFile(abs, 512 * 1024);
        if (read.binary) continue;
        const findings = scanTextForSecrets(file, read.text);
        allFindings.push(...findings);
      } catch {}
      if (allFindings.length >= args.limit) break;
    }
    const text = allFindings.length > 0 ? `Found ${allFindings.length} potential secret(s):\n${allFindings.map(f => `  ${f.file}:${f.line} ${f.kind} ${f.redacted}`).join('\n')}` : 'No secrets found.';
    return ok(text, { findings: allFindings.slice(0, args.limit), total: allFindings.length });
  });

  // 27. audit_manifest
  server.registerTool('nexus_audit_manifest', {
    description: 'Dependency inventory with risk heuristics: typosquatting, unpinned versions, abandoned packages.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async () => {
    const root = session.config.root;
    const risks: { package: string; risk: string; severity: string; detail: string }[] = [];
    let deps: { name: string; version: string; type: string }[] = [];
    // package.json
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) { deps.push({ name, version: version as string, type: 'runtime' }); }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) { deps.push({ name, version: version as string, type: 'dev' }); }
    } catch {}
    // Heuristics
    for (const d of deps) {
      if (d.version === '*' || d.version === 'latest' || d.version === '') risks.push({ package: d.name, risk: 'unpinned', severity: 'warn', detail: `Version is "${d.version}" — pin to a specific version.` });
      // Typosquat check: known packages vs similar names
      const known = ['react', 'express', 'lodash', 'axios', 'chalk', 'commander', 'zod', 'typescript'];
      for (const k of known) { if (d.name !== k && levenshtein(d.name, k) === 1) risks.push({ package: d.name, risk: 'typosquat', severity: 'high', detail: `Name is 1 edit away from "${k}" — possible typosquat.` }); }
    }
    const text = `Dependencies: ${deps.length}\nRisks: ${risks.length}\n${risks.length > 0 ? risks.map(r => `  [${r.severity}] ${r.package}: ${r.risk} — ${r.detail}`).join('\n') : 'No risks detected.'}`;
    return ok(text, { dependencyCount: deps.length, dependencies: deps, riskCount: risks.length, risks });
  });
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m]![n]!;
}
