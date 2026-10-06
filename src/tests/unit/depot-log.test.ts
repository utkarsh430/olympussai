import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOG_MESSAGE_CHARS, logDepotError, logDepotNotice } from '@/lib/depot/log';

describe('logDepotError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('writes one line with the message of an Error and no stack', () => {
    logDepotError('scope-a', new Error('bad thing'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[depot:scope-a] bad thing');
  });

  it('writes a string as it is', () => {
    logDepotError('scope-b', 'plain text');
    expect(errorSpy).toHaveBeenCalledWith('[depot:scope-b] plain text');
  });

  it('logs only the type of a value that is neither an Error nor a string', () => {
    logDepotError('scope-c', { code: 7, token: 'secret-token' });
    expect(errorSpy).toHaveBeenCalledWith('[depot:scope-c] non-error value thrown (object)');
    logDepotError('scope-c', 42);
    expect(errorSpy).toHaveBeenLastCalledWith('[depot:scope-c] non-error value thrown (number)');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-token');
  });

  it('collapses whitespace and strips control characters so one error is one line', () => {
    logDepotError('s', new Error('first\nforged [depot:x] line\r\n\tend\u0007\u001b[31m'));
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(line).not.toMatch(/[\n\r\t\u0000-\u001f\u007f]/);
    expect(line).toBe('[depot:s] first forged [depot:x] line end[31m');
  });

  it('caps a long message with a trailing ellipsis', () => {
    logDepotError('s', new Error(`line\n${'x'.repeat(1000)}`));
    const message = String(errorSpy.mock.calls[0]?.[0]).slice('[depot:s] '.length);
    expect(message).toHaveLength(MAX_LOG_MESSAGE_CHARS);
    expect(message.endsWith('…')).toBe(true);
    expect(message).not.toContain('\n');
  });
});

describe('logDepotNotice', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('writes one bounded warning line in the same form as an error', () => {
    logDepotNotice('scope-n', 'feed\nrecovered');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[depot:scope-n] feed recovered');
    logDepotNotice('scope-n', 'x'.repeat(MAX_LOG_MESSAGE_CHARS * 2));
    const line = String(warnSpy.mock.calls[1]?.[0]);
    expect(line.length).toBe('[depot:scope-n] '.length + MAX_LOG_MESSAGE_CHARS);
  });
});
