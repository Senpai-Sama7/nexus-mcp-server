/**
 * Secret detection + indirect prompt-injection guard.
 *
 * Two threat models:
 *  1. SECRETS — credentials that must never be exfiltrated into context.
 *     Findings are always REDACTED so even the scan report is model-safe.
 *  2. INJECTION — text crafted to hijack the agent. Policy: inform, don't
 *     censor — annotate results so content is treated as untrusted data.
 */

export interface SecretFinding {
  file: string;
  line: number;
  kind: string;
  redacted: string;
  entropy?: number;
}

interface Detector {
  kind: string;
  regex: RegExp;
  group?: number; // capture group carrying the secret (default 0)
}

const DETECTORS: Detector[] = [
  { kind: 'aws-access-key', regex: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { kind: 'github-token', regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { kind: 'github-fine-grained', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { kind: 'openai-key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/g },
  { kind: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { kind: 'google-api-key', regex: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { kind: 'gcp-oauth', regex: /\bya29\.[0-9A-Za-z_\-]+\b/g },
  { kind: 'slack-token', regex: /\bxox[baprs]-[0-9A-Za-z\-]{10,}\b/g },
  { kind: 'stripe-key', regex: /\b[sr]k_(live|test)_[0-9A-Za-z]{16,}\b/g },
  { kind: 'jwt', regex: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g },
  { kind: 'private-key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: 'connection-string', regex: /\b(?:postgres|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"]{8,}/gi },
  { kind: 'generic-secret', regex: /\b(?:api[_-]?key|secret|password|passwd|token|auth[_-]?token)\b\s*[:=]\s*['"]([^'"\s]{12,})['"]/gi, group: 1 },
  { kind: 'hex-secret', regex: /\b(?:key|secret|token)\b\s*[:=]\s*['"]?([0-9a-f]{32,})['"]?/gi, group: 1 },
];

const PLACEHOLDER_RE = /^(x+|\*+|\$\{.*\}|%s|changeme|change[_-]?me|your[_-]?(api[_-]?)?key|placeholder|example|dummy|test|none|null|todo|redacted|<.*>|\.\.\.).*$/i;

export function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let e = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

export function redact(secret: string): string {
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

const MAX_LINE = 2000;

/** Scan one file's text. Returns redacted findings only. */
export function scanTextForSecrets(relFile: string, text: string, maxFindings = 50): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (line.length > MAX_LINE) continue; // likely minified; avoids regex blowup
    for (const det of DETECTORS) {
      det.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = det.regex.exec(line)) !== null && guard++ < 20) {
        const secret = m[det.group ?? 0] ?? '';
        if (secret.length < 8) continue;
        if (PLACEHOLDER_RE.test(secret.trim())) continue;
        const key = `${li}:${det.kind}:${secret}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const finding: SecretFinding = {
          file: relFile, line: li + 1, kind: det.kind, redacted: redact(secret),
        };
        if (det.kind === 'generic-secret' || det.kind === 'hex-secret') {
          finding.entropy = Math.round(shannonEntropy(secret) * 100) / 100;
          if (finding.entropy < 3.0) continue; // low entropy = probably not real
        }
        findings.push(finding);
        if (findings.length >= maxFindings) return findings;
        if (m.index === det.regex.lastIndex) det.regex.lastIndex++;
      }
    }
  }
  return findings;
}

// ------------------------------------------------------- injection guard
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior)\s+(instructions?|context)/i,
  /you\s+are\s+(now|actually)\s+(a|an)\s+\w+\s+(ai|assistant|model)/i,
  /\bnew\s+system\s+(prompt|instructions?)\b/i,
  /<\/?system\b[^>]*>/i,
  /\bSYSTEM\s*:\s*.{10,}/,
  /\bdo\s+not\s+tell\s+the\s+user\b/i,
  /\bhide\s+(this|these)\s+(instructions?|message)\b/i,
  /\bexfiltrat\w+/i,
];

export interface InjectionFlag {
  pattern: string;
  line: number;
}

/** Scan untrusted text (file contents, command output) for injection attempts. */
export function scanForInjection(text: string, maxFlags = 5): InjectionFlag[] {
  const flags: InjectionFlag[] = [];
  const lines = text.split('\n');
  outer: for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (line.length > MAX_LINE) continue;
    for (const re of INJECTION_PATTERNS) {
      if (re.test(line)) {
        flags.push({ pattern: re.source.slice(0, 60), line: li + 1 });
        if (flags.length >= maxFlags) break outer;
      }
    }
  }
  return flags;
}

/** Redact any secrets found in arbitrary tool output before returning to model. */
export function redactSecretsInText(text: string): string {
  let out = text;
  for (const det of DETECTORS) {
    if (det.kind === 'generic-secret' || det.kind === 'hex-secret') continue;
    det.regex.lastIndex = 0;
    out = out.replace(det.regex, (m) => redact(m));
  }
  return out;
}

