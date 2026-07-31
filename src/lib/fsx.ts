/**
 * fsx — hardened filesystem reads.
 *
 * Handles the messy reality of source files: binaries, BOMs, UTF-16,
 * invalid UTF-8, CRLF, files that change size mid-read, missing trailing
 * newlines. Never throws for content problems — returns metadata instead.
 */

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

export interface ReadTextResult {
  text: string;
  encoding: 'utf8' | 'utf16le' | 'utf16be' | 'binary';
  binary: boolean;
  truncated: boolean;
  sizeBytes: number;
  lines: number;
  hadTrailingNewline: boolean;
  lineEnding: 'lf' | 'crlf' | 'mixed' | 'none';
}

const BINARY_SNIFF_BYTES = 8192;

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Decode with BOM awareness; invalid sequences become U+FFFD, never throw. */
export function decodeBuffer(buf: Buffer): { text: string; encoding: ReadTextResult['encoding'] } {
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le' };
    }
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      // UTF-16BE: swap byte pairs then decode as LE.
      const swapped = Buffer.allocUnsafe(buf.length - 2);
      for (let i = 2; i + 1 < buf.length; i += 2) {
        swapped[i - 2] = buf[i + 1]!;
        swapped[i - 1] = buf[i]!;
      }
      return { text: swapped.toString('utf16le'), encoding: 'utf16be' };
    }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf8' };
  }
  return { text: buf.toString('utf8'), encoding: 'utf8' };
}

function detectLineEnding(text: string): ReadTextResult['lineEnding'] {
  let crlf = 0, lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++; else lf++;
    }
  }
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf === 0) return 'crlf';
  if (lf > 0 && crlf === 0) return 'lf';
  return 'mixed';
}

/**
 * Read a text file safely. Binary files return `{ binary: true }` with empty
 * text. `maxBytes` caps the read (head truncation); the file's true size is
 * always reported.
 */
export async function readTextFile(absPath: string, maxBytes = 4 * 1024 * 1024): Promise<ReadTextResult> {
  const stat = await fs.stat(absPath);
  const sizeBytes = stat.size;
  const toRead = Math.min(sizeBytes, maxBytes);

  const fh = await fs.open(absPath, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, 0);
    buf = buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }

  if (looksBinary(buf)) {
    return {
      text: '', encoding: 'binary', binary: true,
      truncated: sizeBytes > toRead, sizeBytes, lines: 0,
      hadTrailingNewline: false, lineEnding: 'none',
    };
  }

  const { text, encoding } = decodeBuffer(buf);
  const lineEnding = detectLineEnding(text);
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  const hadTrailingNewline = text.length > 0 && text.charCodeAt(text.length - 1) === 10;
  if (!hadTrailingNewline && text.length > 0) lines++;

  return {
    text, encoding, binary: false,
    truncated: sizeBytes > toRead,
    sizeBytes, lines, hadTrailingNewline, lineEnding,
  };
}

/** Cheap staleness signal: sha1 of first 4 KiB + size. */
export async function headHash(absPath: string): Promise<string> {
  const fh = await fs.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(buf, 0, 4096, 0);
    const h = createHash('sha1').update(buf.subarray(0, bytesRead)).digest('hex');
    const stat = await fh.stat();
    return `${h}:${stat.size}`;
  } finally {
    await fh.close();
  }
}

/** Atomic write: tmp file in same dir + rename. Never leaves a half-written file. */
export async function writeFileAtomic(absPath: string, data: string | Buffer): Promise<void> {
  const tmp = `${absPath}.nexus-tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, absPath);
}

/** Best-effort JSON read; null when missing/corrupt (caller decides policy). */
export async function readJsonSafe<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
