// @vitest-environment node
//
// Bounding for the copilot module's three grounding sources
// (src/lib/copilot/grounding.ts). The real defect this guards against: the
// live control service went from 47 to 759 corridors and its open-incident
// set grew past 19k rows (12+MB unbounded), which fed straight into the
// assembled LLM prompt and blew the Claude CLI's 10MB stdin cap. These
// tests prove three things per source: the fetch itself is bounded (not
// just truncated after an unbounded pull), the clamp matches the sibling
// idiom already used by the two DB-backed sources (1-100, default 25), and
// the true total is reported back so a caller can be honest about a
// truncated slice rather than silently answering as if it saw everything.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchControlService = vi.fn();
const query = vi.fn();

vi.mock('@/lib/controlService/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/controlService/client')>();
  return { ...actual, fetchControlService: (...args: unknown[]) => fetchControlService(...args) as unknown };
});

vi.mock('@/lib/db/pool', () => ({
  getOpsPool: () => ({ query }),
}));

const {
  listOpenIncidentsForGrounding,
  findOpenIncidentById,
  listAuditEventsForGrounding,
  listBreakdownReportsForGrounding,
} = await import('@/lib/copilot/grounding');

function incidentRow(id: string) {
  return {
    id,
    routeDirectionId: 'dir-1',
    members: [],
    severity: 'bunched',
    causeClass: 'unknown',
    controllability: 'controllable',
    status: 'open',
    startedAt: '2026-08-06T10:00:00.000Z',
    endedAt: null,
    evidence: {},
  };
}

beforeEach(() => {
  fetchControlService.mockReset();
  query.mockReset();
});

describe('listOpenIncidentsForGrounding', () => {
  it('passes no limit to the control service when none is given (findOpenIncidentById relies on this)', async () => {
    fetchControlService.mockResolvedValueOnce({ incidents: [], totalOpenCount: 0 });

    await listOpenIncidentsForGrounding('dir-1');

    expect(fetchControlService).toHaveBeenCalledWith('/v1/incidents', {
      query: { routeDirectionId: 'dir-1', limit: undefined },
    });
  });

  it('clamps a requested limit into [1, 100], matching the DB-backed siblings', async () => {
    fetchControlService.mockResolvedValue({ incidents: [], totalOpenCount: 0 });

    await listOpenIncidentsForGrounding('dir-1', 500);
    expect(fetchControlService).toHaveBeenLastCalledWith('/v1/incidents', {
      query: { routeDirectionId: 'dir-1', limit: '100' },
    });

    await listOpenIncidentsForGrounding('dir-1', 0);
    expect(fetchControlService).toHaveBeenLastCalledWith('/v1/incidents', {
      query: { routeDirectionId: 'dir-1', limit: '1' },
    });

    await listOpenIncidentsForGrounding('dir-1', 25);
    expect(fetchControlService).toHaveBeenLastCalledWith('/v1/incidents', {
      query: { routeDirectionId: 'dir-1', limit: '25' },
    });
  });

  it('reports the control service\'s true total, not just what came back, so a caller can tell a slice from the full set', async () => {
    fetchControlService.mockResolvedValueOnce({
      incidents: [incidentRow('a'), incidentRow('b')],
      totalOpenCount: 8582,
    });

    const result = await listOpenIncidentsForGrounding('dir-1', 2);

    expect(result.items).toHaveLength(2);
    expect(result.totalCount).toBe(8582);
  });

  it('falls back to items.length when the control service omits totalOpenCount (older/unbounded response shape)', async () => {
    fetchControlService.mockResolvedValueOnce({ incidents: [incidentRow('a')] });

    const result = await listOpenIncidentsForGrounding('dir-1');

    expect(result.totalCount).toBe(1);
  });
});

describe('findOpenIncidentById', () => {
  it('finds an incident that would have been excluded by the multi-incident prompt bound (it fetches unbounded, not the most-recent slice)', async () => {
    // A specific-by-id lookup must not miss an older still-open incident
    // just because a bounded caller elsewhere only wants the most recent N.
    fetchControlService.mockResolvedValueOnce({
      incidents: [incidentRow('recent'), incidentRow('older-but-still-open')],
      totalOpenCount: 2,
    });

    const result = await findOpenIncidentById('older-but-still-open', 'dir-1');

    expect(result.incident?.id).toBe('older-but-still-open');
    expect(fetchControlService).toHaveBeenCalledWith('/v1/incidents', {
      query: { routeDirectionId: 'dir-1', limit: undefined },
    });
  });
});

describe('listAuditEventsForGrounding', () => {
  it('clamps limit into [1, 100] with a default of 25, same as before', async () => {
    query.mockResolvedValue({ rows: [] });

    await listAuditEventsForGrounding({ limit: 500 });
    expect(query.mock.calls[0]![1]).toEqual([100]);

    query.mockClear();
    await listAuditEventsForGrounding({});
    expect(query.mock.calls[0]![1]).toEqual([25]);
  });

  it('reports the true total behind the limited slice via a companion count query', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'a',
            actor_role: 'control_room',
            action: 'x',
            resource_type: null,
            resource_id: null,
            metadata: {},
            created_at: '2026-08-06T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: '89' }] });

    const result = await listAuditEventsForGrounding({ limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(89);
    // The count query must use the same select-limit filter shape, minus the limit itself.
    expect(query.mock.calls[1]![0]).toMatch(/select count\(\*\)/i);
    expect(query.mock.calls[1]![0]).toMatch(/ops_audit_log/);
  });
});

describe('listBreakdownReportsForGrounding', () => {
  it('clamps limit into [1, 100] with a default of 25, same as before', async () => {
    query.mockResolvedValue({ rows: [] });

    await listBreakdownReportsForGrounding({ limit: 500 });
    expect(query.mock.calls[0]![1]).toEqual([100]);

    query.mockClear();
    await listBreakdownReportsForGrounding({});
    expect(query.mock.calls[0]![1]).toEqual([25]);
  });

  it('reports the true total behind the limited slice via a companion count query', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'b',
            vehicle_reg: 'UP32AB1234',
            category: 'Mechanical',
            description: 'Brake issue',
            created_at: '2026-08-06T09:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await listBreakdownReportsForGrounding({ limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(query.mock.calls[1]![0]).toMatch(/select count\(\*\)/i);
    expect(query.mock.calls[1]![0]).toMatch(/ops_breakdown_reports/);
  });
});
