import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendAuditEvent,
  clearAuditLog,
  exportAuditJson,
  exportAuditSummary,
  readAuditLog,
  writeAuditLog,
  AUDIT_STORAGE_KEY,
  type AuditEvent,
} from '@/lib/audit/auditLog';
import { TtlCache } from '@/lib/upsrtc/cache';
import { indiaDate, isValidRegistrationNumber, buildScheduleUrl } from '@/lib/upsrtc/client';
import { formatRelativeAge, formatSpeed, formatHeading, formatScheduleTime } from '@/lib/formatters';

describe('audit log operations', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('appends events newest-first with generated ids', () => {
    let events: AuditEvent[] = [];
    events = appendAuditEvent(events, { type: 'bus-selected', summary: 'First', simulated: false });
    events = appendAuditEvent(events, { type: 'scenario-launched', summary: 'Second', simulated: true });

    expect(events).toHaveLength(2);
    expect(events[0]?.summary).toBe('Second');
    expect(events[0]?.id).toBeTruthy();
    expect(events[0]?.at).toBeTruthy();
    expect(events[0]?.id).not.toBe(events[1]?.id);
  });

  it('preserves the model-vs-live provenance flag', () => {
    let events: AuditEvent[] = [];
    events = appendAuditEvent(events, { type: 'bus-selected', summary: 'Live', simulated: false });
    events = appendAuditEvent(events, { type: 'message-sent', summary: 'Sim', simulated: true });

    expect(events.find((e) => e.summary === 'Live')?.simulated).toBe(false);
    expect(events.find((e) => e.summary === 'Sim')?.simulated).toBe(true);
  });

  it('caps stored history to prevent unbounded growth', () => {
    let events: AuditEvent[] = [];
    for (let i = 0; i < 320; i += 1) {
      events = appendAuditEvent(events, {
        type: 'alert-displayed',
        summary: `Event ${i}`,
        simulated: true,
      });
    }
    expect(events.length).toBeLessThanOrEqual(250);
  });

  it('round-trips through localStorage', () => {
    const events = appendAuditEvent([], {
      type: 'bus-selected',
      summary: 'Persisted event',
      simulated: false,
    });
    writeAuditLog(events);

    const restored = readAuditLog();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.summary).toBe('Persisted event');
  });

  it('returns an empty array when storage holds malformed data', () => {
    window.localStorage.setItem(AUDIT_STORAGE_KEY, 'not json at all');
    expect(readAuditLog()).toEqual([]);

    window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(readAuditLog()).toEqual([]);
  });

  it('clears history from both memory and storage', () => {
    writeAuditLog(
      appendAuditEvent([], { type: 'bus-selected', summary: 'Gone soon', simulated: false }),
    );
    expect(readAuditLog()).toHaveLength(1);

    expect(clearAuditLog()).toEqual([]);
    expect(readAuditLog()).toEqual([]);
  });

  it('exports valid JSON carrying the provenance notice', () => {
    const events = appendAuditEvent([], {
      type: 'message-sent',
      summary: 'Demo message',
      simulated: true,
    });

    const parsed = JSON.parse(exportAuditJson(events));
    expect(parsed.product).toBe('Olympuss AI');
    expect(parsed.eventCount).toBe(1);
    expect(parsed.notice).toMatch(/model-driven/i);
    expect(parsed.events).toHaveLength(1);
  });

  it('exports a readable summary with the provenance notice', () => {
    const events = appendAuditEvent([], {
      type: 'call-started',
      summary: 'Demo call',
      simulated: true,
    });

    const summary = exportAuditSummary(events);
    expect(summary).toMatch(/SESSION SUMMARY/);
    expect(summary).toMatch(/No driver was contacted/);
    expect(summary).toMatch(/Voice call started/);
  });
});

describe('TTL cache', () => {
  it('serves values inside the TTL window', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value', 0);
    expect(cache.get('key', 500)).toBe('value');
  });

  it('expires values past the TTL', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value', 0);
    expect(cache.get('key', 1500)).toBeNull();
  });

  it('retains last-known-good after expiry', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value', 0);
    expect(cache.get('key', 5000)).toBeNull();
    expect(cache.getLastGood('key')?.value).toBe('value');
  });

  it('reports age of the last good entry', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value', 1000);
    expect(cache.ageMs('key', 3000)).toBe(2000);
    expect(cache.ageMs('missing', 3000)).toBeNull();
  });

  it('clears everything', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('key', 'value', 0);
    cache.clear();
    expect(cache.getLastGood('key')).toBeNull();
  });
});

describe('upstream client helpers', () => {
  it('formats the India date as YYYY-MM-DD', () => {
    expect(indiaDate(new Date('2026-07-20T04:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('resolves the India date across the UTC day boundary', () => {
    // 20:00 UTC is already the next day in Asia/Kolkata (UTC+5:30).
    expect(indiaDate(new Date('2026-07-19T20:00:00Z'))).toBe('2026-07-20');
  });

  it('accepts real UPSRTC registration formats', () => {
    expect(isValidRegistrationNumber('UP77AN2509')).toBe(true);
    expect(isValidRegistrationNumber('UP25FT4823')).toBe(true);
    expect(isValidRegistrationNumber('UP78KT8662')).toBe(true);
  });

  it('rejects malformed registration numbers', () => {
    expect(isValidRegistrationNumber('')).toBe(false);
    expect(isValidRegistrationNumber('../../etc/passwd')).toBe(false);
    expect(isValidRegistrationNumber('DROP TABLE buses')).toBe(false);
  });

  it('builds a schedule URL with encoded parameters', () => {
    const url = buildScheduleUrl('up25ft4823', '2026-07-20');
    expect(url).toContain('reg_num=UP25FT4823');
    expect(url).toContain('date=2026-07-20');
  });
});

describe('formatters', () => {
  it('formats relative ages', () => {
    const now = Date.parse('2026-07-20T12:00:00Z');
    expect(formatRelativeAge('2026-07-20T11:59:30Z', now)).toBe('30s ago');
    expect(formatRelativeAge('2026-07-20T11:45:00Z', now)).toBe('15m ago');
    expect(formatRelativeAge('2026-07-20T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelativeAge(null, now)).toBe('no signal');
  });

  it('formats speed and heading with null fallbacks', () => {
    expect(formatSpeed(42.4)).toBe('42 km/h');
    expect(formatSpeed(null)).toBe('— km/h');
    expect(formatHeading(0)).toBe('0° N');
    expect(formatHeading(90)).toBe('90° E');
    expect(formatHeading(null)).toBe('—');
  });

  it('formats upstream HH:MM:SS schedule times', () => {
    expect(formatScheduleTime('10:06:00')).toBe('10:06');
    expect(formatScheduleTime(null)).toBe('—');
  });
});
