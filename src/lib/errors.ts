/**
 * NEXUS error taxonomy.
 *
 * Discipline:
 *  - Expected, user-actionable failures are thrown as NexusError with a stable
 *    `code`, human `message`, and remediation `hint`. The tool layer converts
 *    these to `isError: true` results (NOT protocol errors), so the calling
 *    agent can recover programmatically.
 *  - Unexpected bugs bubble up and are converted to INTERNAL_ERROR with a
 *    sanitized message (no stack leakage to the model beyond a digest).
 */

export type NexusErrorCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_NOT_FOUND'
  | 'PATH_SENSITIVE'
  | 'PATH_INVALID'
  | 'FILE_TOO_LARGE'
  | 'FILE_BINARY'
  | 'FILE_ENCODING'
  | 'DIRTY_INDEX'
  | 'SYMBOL_NOT_FOUND'
  | 'AMBIGUOUS_SYMBOL'
  | 'GIT_UNAVAILABLE'
  | 'GIT_STATE_UNSUPPORTED'
  | 'COMMAND_NOT_FOUND'
  | 'COMMAND_DANGEROUS'
  | 'COMMAND_TIMEOUT'
  | 'EXEC_CAP_REACHED'
  | 'TASK_NOT_FOUND'
  | 'TASK_CYCLE'
  | 'TASK_STATE'
  | 'MEMORY_CONFLICT'
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_CAP'
  | 'PARSER_UNAVAILABLE'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class NexusError extends Error {
  readonly code: NexusErrorCode;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: NexusErrorCode, message: string, hint?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NexusError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }

  toJSON(): { code: NexusErrorCode; message: string; hint?: string; details?: Record<string, unknown> } {
    const out: { code: NexusErrorCode; message: string; hint?: string; details?: Record<string, unknown> } = {
      code: this.code,
      message: this.message,
    };
    if (this.hint) out.hint = this.hint;
    if (this.details && Object.keys(this.details).length > 0) out.details = this.details;
    return out;
  }
}

/** Wrap an arbitrary thrown value into a NexusError without double-wrapping. */
export function asNexusError(err: unknown, fallbackCode: NexusErrorCode = 'INTERNAL_ERROR'): NexusError {
  if (err instanceof NexusError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // Map common Node system errors to actionable codes.
  const nodeErr = err as NodeJS.ErrnoException | undefined;
  if (nodeErr?.code === 'ENOENT') {
    return new NexusError('PATH_NOT_FOUND', `No such file or directory: ${nodeErr.path ?? message}`, 'Check the path is relative to the workspace root and exists.');
  }
  if (nodeErr?.code === 'EACCES' || nodeErr?.code === 'EPERM') {
    return new NexusError('PATH_INVALID', `Permission denied: ${nodeErr.path ?? message}`, 'The process lacks read/write permission for this path.');
  }
  if (nodeErr?.code === 'ENOSPC') {
    return new NexusError('INTERNAL_ERROR', 'No space left on device', 'Free disk space or lower NEXUS cache/snapshot budgets.');
  }
  return new NexusError(fallbackCode, message);
}

/** True when a message looks like a bug rather than an actionable failure. */
export function isInternal(err: unknown): boolean {
  return !(err instanceof NexusError);
}
