import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logDepotError } from '@/lib/depot/log';

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

  it('writes an object in a string form', () => {
    logDepotError('scope-c', { code: 7 });
    expect(errorSpy).toHaveBeenCalledWith('[depot:scope-c] {"code":7}');
  });
});
