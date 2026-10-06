import type { CanonicalSchedule, CanonicalStop } from '@/models/canonical';

/**
 * Route VND_1613_ORD_OUT, Vindhyanagar to Varanasi Cantt, as the corporation's
 * route-details service gave it for one bus: public timetable data, recorded as
 * returned (names, sequence, coordinates, scheduled times). Eight stops have no
 * position, and four (NIGAHEE, TENDUPUl, LOHRA, RAMNAGAR VARANASI) are placed at
 * same-named places 130 to 270 km off the line of the route, each reached and
 * left within minutes.
 */

type Row = readonly [number, string, number | null, number | null, string];

const ROWS: readonly Row[] = [
  [1, 'VINDHYANAGAR', 24.08751, 82.66961, '12:31:00'],
  [2, 'WAIDHAN', null, null, '12:41:17'],
  [3, 'AMALORI', 24.09989, 82.61311, '12:57:45'],
  [4, 'NIGAHEE', 25.483639, 81.197099, '13:05:59'],
  [5, 'JAYANT', 24.12068, 82.65423, '13:14:13'],
  [6, 'SHAKTI NAGAR', null, null, '13:24:30'],
  [7, 'KHADIYA', 24.11616, 82.73642, '13:34:47'],
  [8, 'VEENA', 24.14854, 82.77002, '13:47:08'],
  [9, 'ANPARA', null, null, '14:05:39'],
  [10, 'VEARPAN', 24.21185, 82.86602, '14:30:21'],
  [11, 'SIDHAVA', 24.21557, 82.91386, '14:36:31'],
  [12, 'KUWARI', 24.20605, 82.96677, '14:48:52'],
  [13, 'RIHAND DEM', 24.20953, 83.00538, '15:03:16'],
  [14, 'TURRA', 24.20425, 83.02409, '15:09:26'],
  [15, 'RENUKOOT', null, null, '15:15:36'],
  [16, 'HATHINALA', 24.30237, 83.09175, '15:44:25'],
  [17, 'GURMURA', 24.37248, 83.06205, '16:02:56'],
  [18, 'JAWARIDADH', null, null, '16:11:10'],
  [19, 'TELGUDHAWA', 24.42591, 83.05929, '16:21:27'],
  [20, 'DALA', 24.45297, 83.04477, '16:27:37'],
  [21, 'DALMAU', null, null, '16:33:47'],
  [22, 'CHOPAN', 24.51784, 83.02482, '16:48:11'],
  [23, 'SALKHAN', 24.57449, 83.04675, '17:00:32'],
  [24, 'MARKUNDI', 24.62125, 83.04947, '17:10:49'],
  [25, 'LODHI', 24.64654, 83.05777, '17:27:17'],
  [26, 'SONBHADRA', 24.687277, 83.063878, '17:43:45'],
  [27, 'TENDUPUl', 25.942213, 83.487554, '18:00:13'],
  [28, 'MADHUPUR', 24.83642, 83.05743, '18:20:48'],
  [29, 'LOHRA', 26.368245, 82.901364, '18:29:02'],
  [30, 'SUKRUT', 24.90662, 83.05476, '18:39:19'],
  [31, 'AHRAURA', 25.016305, 83.015898, '19:12:15'],
  [32, 'ADALHAT', 25.1329, 83.03576, '19:39:00'],
  [33, 'NARAYANAPUR', null, null, '19:55:28'],
  [34, 'RAMNAGAR VARANASI', 27.089333, 81.399741, '20:09:52'],
  [35, 'MOHANSARAI', 25.274095, 82.875272, '20:46:55'],
  [36, 'CHAND PUR', null, null, '21:05:26'],
  [37, 'VARANASI CANT', 25.328741, 82.989821, '21:15:43'],
];

export const VND_1613_STOPS: readonly CanonicalStop[] = ROWS.map(
  ([sequence, name, latitude, longitude, time]) => ({
    id: `vnd-${sequence}`,
    name,
    sequence,
    latitude,
    longitude,
    scheduledArrival: time,
    scheduledDeparture: time,
  }),
);

/** The four stops whose recorded position does not fit the timetable. */
export const VND_1613_MISLOCATED: readonly string[] = [
  'NIGAHEE',
  'TENDUPUl',
  'LOHRA',
  'RAMNAGAR VARANASI',
];

export const VND_1613_SCHEDULE: CanonicalSchedule = {
  registrationNumber: 'UP64AT0001',
  date: '2026-10-06',
  routeId: null,
  routeName: 'VND_1613_ORD_OUT',
  originName: null,
  destinationName: null,
  tripId: null,
  scheduledDeparture: null,
  scheduledArrival: null,
  direction: 'OUT',
  tripCount: 1,
  stops: [...VND_1613_STOPS],
};
