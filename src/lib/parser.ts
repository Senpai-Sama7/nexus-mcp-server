/**
 * Parser — lexical extraction engine.
 * Pipeline: strip → extract symbols → extract imports → extract calls.
 * No native deps. Error-tolerant: broken code yields partial results.
 */

import type { SymbolInfo, ImportEdge, CallSite, SymbolKind } from '../types.js';
import { detectLanguage, getSpec, isExtractable } from './langdetect.js';
import { stripCommentsAndStrings } from './strip.js';
import { getPatterns, type SymbolPattern, type ImportPattern, type CallPattern } from './patterns.js';

export interface ParseResult {
  language: string;
  symbols: SymbolInfo[];
  imports: ImportEdge[];
  calls: CallSite[];
  parseErrors: number;
  backend: 'lexical';
}

const KEYWORDS = new Set([
  'if','else','for','while','do','return','break','continue','switch','case','default','try','catch','finally','throw','new','delete','typeof','instanceof','in','of','this','super','extends','implements','interface','enum','const','let','var','function','class','static','public','private','protected','abstract','final','async','await','yield','import','export','from','as','default','namespace','using','typedef','struct','union','extern','inline','virtual','override','readonly','get','set','declare','module','type','is','not','and','or','nil','null','true','false','undefined','void','int','float','double','char','bool','string','byte','long','short','signed','unsigned','auto','register','volatile','goto','sizeof','def','elif','lambda','pass','with','global','nonlocal','raise','assert','del','print','end','begin','then','require','unless','until','next','redo','retry','defined','self',
]);

function isValidIdent(name: string): boolean {
  if (!name || name.length < 1 || name.length > 200) return false;
  if (!/[A-Za-z_$]/.test(name[0]!)) return false;
  return !KEYWORDS.has(name);
}

function findEndLine(lines: string[], startIdx: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startIdx; i < lines.length && i < startIdx + 500; i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === '{') { depth++; foundOpen = true; }
      else if (ch === '}') { depth--; }
      else if (ch === ';' && !foundOpen) return i + 1;
    }
    if (foundOpen && depth <= 0) return i + 1;
  }
  return startIdx + 1;
}

const SCOPE_KINDS = new Set<SymbolKind>(['class','struct','interface','trait','impl','module']);

function extractSymbols(stripped: string, relFile: string, patterns: SymbolPattern[]): { symbols: SymbolInfo[]; scopeMap: Map<number, string> } {
  const lines = stripped.split('\n');
  const symbols: SymbolInfo[] = [];
  const scopeMap = new Map<number, string>();
  const seen = new Set<string>();
  let currentClass: string | null = null;
  let classDepth = -1;
  let braceDepth = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const lineNum = li + 1;
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    let declaredScope: string | null = null;
    for (const pat of patterns) {
      if (!SCOPE_KINDS.has(pat.kind as SymbolKind)) continue;
      pat.regex.lastIndex = 0;
      const m = pat.regex.exec(line);
      if (m) {
        const name = m[pat.nameGroup] ?? '';
        if (isValidIdent(name)) {
          declaredScope = name;
          currentClass = name;
          classDepth = braceDepth;
          const id = `${relFile}::${name}`;
          if (!seen.has(id)) {
            seen.add(id);
            symbols.push({ id, name, qualname: name, kind: pat.kind as SymbolKind, file: relFile, startLine: lineNum, endLine: findEndLine(lines, li), exported: pat.exportedPrefix ? line.includes(pat.exportedPrefix) : false });
          }
          break;
        }
      }
    }
    if (currentClass) scopeMap.set(lineNum, currentClass);
    for (const pat of patterns) {
      if (SCOPE_KINDS.has(pat.kind as SymbolKind) && declaredScope) continue;
      if (pat.requiresClassScope && !currentClass) continue;
      pat.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = pat.regex.exec(line)) !== null && guard++ < 10) {
        const name = m[pat.nameGroup] ?? '';
        if (!isValidIdent(name)) { if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++; continue; }
        const qualname = pat.requiresClassScope && currentClass ? `${currentClass}.${name}` : name;
        const id = `${relFile}::${qualname}`;
        if (seen.has(id)) { if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++; continue; }
        seen.add(id);
        symbols.push({ id, name, qualname, kind: pat.kind as SymbolKind, file: relFile, startLine: lineNum, endLine: findEndLine(lines, li), exported: pat.exportedPrefix ? line.includes(pat.exportedPrefix) : false, parent: pat.requiresClassScope && currentClass ? currentClass : undefined });
        if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++;
      }
    }
    braceDepth += opens - closes;
    if (currentClass && braceDepth <= classDepth) { currentClass = null; classDepth = -1; }
  }
  return { symbols, scopeMap };
}

function extractImports(stripped: string, relFile: string, patterns: ImportPattern[]): ImportEdge[] {
  const lines = stripped.split('\n');
  const imports: ImportEdge[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    for (const pat of patterns) {
      pat.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = pat.regex.exec(line)) !== null && guard++ < 20) {
        const specifier = (m[pat.specifierGroup] ?? '').trim();
        if (!specifier) { if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++; continue; }
        const names = pat.namesGroup ? (m[pat.namesGroup] ?? '').split(',').map(s => s.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean) : [];
        imports.push({ from: relFile, specifier, to: null, names, isTypeOnly: pat.isTypeOnly, isDynamic: pat.isDynamic, line: li + 1 });
        if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++;
      }
    }
  }
  return imports;
}

function extractCalls(stripped: string, relFile: string, callPatterns: CallPattern[], symbols: SymbolInfo[]): CallSite[] {
  const lines = stripped.split('\n');
  const calls: CallSite[] = [];
  const localByName = new Map<string, string>();
  for (const s of symbols) localByName.set(s.name, s.id);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    let callerName = '<module>';
    let callerId: string | null = null;
    for (const s of symbols) {
      if (s.startLine <= li + 1 && li + 1 <= s.endLine && (s.kind === 'function' || s.kind === 'method')) { callerName = s.qualname; callerId = s.id; }
    }
    for (const pat of callPatterns) {
      pat.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = pat.regex.exec(line)) !== null && guard++ < 50) {
        const callee = m[pat.calleeGroup] ?? '';
        if (!isValidIdent(callee)) { if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++; continue; }
        const isDef = symbols.some(s => s.startLine === li + 1 && s.name === callee);
        if (isDef) { if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++; continue; }
        const calleeId = localByName.get(callee) ?? null;
        calls.push({ callerId, callerName, file: relFile, line: li + 1, calleeText: callee, calleeId, dynamic: !calleeId });
        if (m.index === pat.regex.lastIndex) pat.regex.lastIndex++;
      }
    }
  }
  return calls;
}

export function parseFile(relPath: string, text: string): ParseResult {
  const language = detectLanguage(relPath);
  if (!language || !isExtractable(language)) return { language: language ?? 'unknown', symbols: [], imports: [], calls: [], parseErrors: 0, backend: 'lexical' };
  const spec = getSpec(language);
  if (!spec) return { language, symbols: [], imports: [], calls: [], parseErrors: 0, backend: 'lexical' };
  const patterns = getPatterns(language);
  if (!patterns) return { language, symbols: [], imports: [], calls: [], parseErrors: 0, backend: 'lexical' };
  const stripped = stripCommentsAndStrings(text, spec);
  const { symbols } = extractSymbols(stripped, relPath, patterns.symbols);
  const imports = extractImports(text, relPath, patterns.imports);
  const calls = extractCalls(stripped, relPath, patterns.calls, symbols);
  return { language, symbols, imports, calls, parseErrors: 0, backend: 'lexical' };
}
