/**
 * Unit tests for the NEXUS error taxonomy (src/lib/errors.ts).
 * Pure, deterministic, no filesystem or network access.
 */
import { describe, it, expect } from 'vitest';
import {
  NexusError,
  asNexusError,
  isInternal,
} from '../../src/lib/errors.js';

describe('NexusError', () => {
  it('carries code, message, and optional hint/name', () => {
    const e = new NexusError('PATH_NOT_FOUND', 'missing file', 'check the path');
    expect(e).toBeInstanceOf(NexusError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('NexusError');
    expect(e.code).toBe('PATH_NOT_FOUND');
    expect(e.message).toBe('missing file');
    expect(e.hint).toBe('check the path');
  });

  it('serializes via toJSON, omitting absent optional fields', () => {
    const full = new NexusError('VALIDATION', 'bad input', 'fix it', { field: 'x' });
    expect(full.toJSON()).toEqual({
      code: 'VALIDATION',
      message: 'bad input',
      hint: 'fix it',
      details: { field: 'x' },
    });

    const minimal = new NexusError('INTERNAL_ERROR', 'boom');
    const obj = minimal.toJSON();
    expect(obj).toEqual({ code: 'INTERNAL_ERROR', message: 'boom' });
    expect(Object.keys(obj)).toEqual(['code', 'message']);
  });
});

describe('asNexusError', () => {
  it('does not double-wrap a NexusError', () => {
    const original = new NexusError('COMMAND_NOT_FOUND', 'nope', 'install it');
    expect(asNexusError(original)).toBe(original);
  });

  it('maps ENOENT -> PATH_NOT_FOUND with a hint', () => {
    const nodeErr = Object.assign(new Error('missing'), {
      code: 'ENOENT',
      path: '/tmp/nope',
    });
    const got = asNexusError(nodeErr);
    expect(got.code).toBe('PATH_NOT_FOUND');
    expect(got.message).toContain('/tmp/nope');
    expect(got.hint).toBeTruthy();
  });

  it('maps EACCES / EPERM -> PATH_INVALID', () => {
    const eacces = Object.assign(new Error('p'), { code: 'EACCES', path: '/etc/shadow' });
    expect(asNexusError(eacces).code).toBe('PATH_INVALID');
    const eperm = Object.assign(new Error('p'), { code: 'EPERM', path: '/x' });
    expect(asNexusError(eperm).code).toBe('PATH_INVALID');
  });

  it('maps ENOSPC -> INTERNAL_ERROR', () => {
    const err = Object.assign(new Error('full'), { code: 'ENOSPC' });
    expect(asNexusError(err).code).toBe('INTERNAL_ERROR');
  });

  it('wraps unknown errors with the fallback code', () => {
    expect(asNexusError('stringy error').code).toBe('INTERNAL_ERROR');
    expect(asNexusError('stringy error', 'VALIDATION').code).toBe('VALIDATION');
    expect(asNexusError({ weird: true }, 'VALIDATION').code).toBe('VALIDATION');
    expect(asNexusError(42).code).toBe('INTERNAL_ERROR');
  });

  it('preserves the original message for unknown errors', () => {
    expect(asNexusError('something broke').message).toBe('something broke');
  });
});

describe('isInternal', () => {
  it('is false for NexusError (actionable)', () => {
    expect(isInternal(new NexusError('VALIDATION', 'x'))).toBe(false);
  });

  it('is true for plain errors and non-Error throws (bugs)', () => {
    expect(isInternal(new Error('boom'))).toBe(true);
    expect(isInternal('oops')).toBe(true);
    expect(isInternal(undefined)).toBe(true);
    expect(isInternal(null)).toBe(true);
  });
});
