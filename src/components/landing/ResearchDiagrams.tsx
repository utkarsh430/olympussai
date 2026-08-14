/**
 * Abstract technical diagrams for the AI Research Projects section.
 *
 * Each is a lightweight, purely decorative line-and-node illustration in the
 * Olympuss gold/ivory palette — thin technical lines, luminous nodes, restrained
 * geometry. They are `aria-hidden` and never the sole carrier of meaning: every
 * card states its project in real text. A single focus node per diagram breathes
 * via `ol-node-pulse`, which the global reduced-motion rule halts automatically.
 *
 * No external assets, no network requests — inline SVG only (CSP `default-src 'self'`).
 */

// Palette, driven by the shared tokens rather than by literal gold. These are
// decorative line drawings on the page ground, so they have to follow it: at
// rgba(214,161,58,0.30) on a white card the whole illustration was a ghost.
// `--brand` and `--foreground` carry the right luminance per theme, and the
// alphas below are unchanged, so the night edition renders as it always did.
const LINE_GOLD = 'hsl(var(--brand) / 0.45)';
const LINE_IVORY = 'hsl(var(--foreground) / 0.28)';
const LINE_FAINT = 'hsl(var(--brand) / 0.24)';
const NODE = 'hsl(var(--brand))';
const FOCUS = 'hsl(var(--brand))';

/** A soft luminous focus node with a gently breathing halo. */
function FocusNode({ cx, cy, delay = 0 }: { cx: number; cy: number; delay?: number }) {
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={8}
        fill={FOCUS}
        opacity={0.16}
        style={{
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `ol-node-pulse 3.4s ease-in-out ${delay}s infinite`,
        }}
      />
      <circle cx={cx} cy={cy} r={2.6} fill={FOCUS} />
    </g>
  );
}

function Node({ cx, cy, r = 1.8 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill={NODE} opacity={0.75} />;
}

/** Shared frame — fixed aspect, gold hairline baseline, consistent across cards. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 300 132"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      role="presentation"
    >
      <line x1="0" y1="131" x2="300" y2="131" stroke={LINE_FAINT} strokeWidth="1" />
      {children}
    </svg>
  );
}

/** 01 — Crowd: scattered density field, directional paths, a high-risk zone. */
function CrowdDiagram() {
  const dots = [
    [40, 40],
    [58, 52],
    [46, 66],
    [70, 44],
    [64, 70],
    [84, 58],
    [52, 84],
    [78, 80],
    [150, 30],
    [168, 46],
    [158, 62],
    [182, 38],
    [176, 66],
    [196, 52],
    [206, 74],
    [120, 96],
    [138, 88],
    [156, 100],
    [174, 92],
    [244, 44],
    [262, 60],
    [250, 80],
  ];
  return (
    <Frame>
      {/* High-risk zone */}
      <ellipse
        cx="172"
        cy="52"
        rx="46"
        ry="34"
        fill="hsl(var(--brand) / 0.09)"
        stroke={LINE_GOLD}
        strokeWidth="1"
        strokeDasharray="3 4"
      />
      {/* Directional flow paths */}
      <path d="M30 108 C 90 96, 130 72, 172 52" stroke={LINE_IVORY} strokeWidth="1" />
      <path d="M110 116 C 140 96, 158 74, 172 52" stroke={LINE_IVORY} strokeWidth="1" />
      <path d="M262 104 C 220 88, 196 70, 172 52" stroke={LINE_IVORY} strokeWidth="1" />
      {dots.map(([x, y], i) => (
        <Node key={i} cx={x!} cy={y!} r={i % 5 === 0 ? 2.1 : 1.5} />
      ))}
      <FocusNode cx={172} cy={52} />
    </Frame>
  );
}

/** 02 — Road accident: trajectories converging on a highlighted incident + alert pulse. */
function AccidentDiagram() {
  return (
    <Frame>
      <path d="M20 24 C 90 40, 130 60, 176 66" stroke={LINE_IVORY} strokeWidth="1" />
      <path d="M18 104 C 90 92, 132 78, 176 66" stroke={LINE_IVORY} strokeWidth="1" />
      <path d="M284 30 C 240 44, 208 56, 176 66" stroke={LINE_GOLD} strokeWidth="1" />
      <path d="M282 110 C 236 96, 208 80, 176 66" stroke={LINE_IVORY} strokeWidth="1" />
      {/* Alert ring */}
      <circle
        cx="176"
        cy="66"
        r="18"
        stroke={LINE_GOLD}
        strokeWidth="1"
        opacity="0.55"
        style={{
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: 'ol-node-pulse 2.6s ease-in-out infinite',
        }}
      />
      <Node cx={20} cy={24} />
      <Node cx={18} cy={104} />
      <Node cx={284} cy={30} />
      <Node cx={282} cy={110} />
      <FocusNode cx={176} cy={66} />
    </Frame>
  );
}

/** 03 — Wildfire: layered smoke contours expanding from a bright detection region. */
function WildfireDiagram() {
  return (
    <Frame>
      <path
        d="M96 96 C 70 78, 78 50, 108 44 C 128 40, 150 52, 150 72 C 150 92, 122 108, 96 96 Z"
        stroke={LINE_GOLD}
        strokeWidth="1"
      />
      <path
        d="M76 104 C 40 78, 52 34, 106 26 C 150 20, 190 46, 188 82 C 186 116, 120 130, 76 104 Z"
        stroke={LINE_IVORY}
        strokeWidth="1"
        opacity="0.7"
      />
      <path
        d="M58 112 C 8 78, 26 16, 108 8 C 176 2, 232 40, 226 92"
        stroke={LINE_FAINT}
        strokeWidth="1"
      />
      {/* Drift markers */}
      <Node cx={150} cy={40} r={1.4} />
      <Node cx={178} cy={54} r={1.4} />
      <Node cx={196} cy={72} r={1.4} />
      <FocusNode cx={112} cy={70} />
    </Frame>
  );
}

/** 04 — Flood: topographic contours, a water-level line, an illuminated risk region. */
function FloodDiagram() {
  return (
    <Frame>
      <path d="M8 40 C 70 24, 120 44, 300 30" stroke={LINE_FAINT} strokeWidth="1" />
      <path d="M8 58 C 80 44, 140 62, 300 50" stroke={LINE_IVORY} strokeWidth="1" opacity="0.6" />
      {/* Water level + filled risk basin */}
      <path
        d="M0 86 C 60 78, 110 92, 170 84 C 220 78, 260 90, 300 84 L 300 132 L 0 132 Z"
        fill="hsl(var(--brand) / 0.10)"
        stroke={LINE_GOLD}
        strokeWidth="1"
      />
      <path
        d="M0 100 C 70 94, 120 106, 300 98"
        stroke={LINE_GOLD}
        strokeWidth="1"
        opacity="0.5"
        strokeDasharray="2 4"
      />
      <FocusNode cx={150} cy={86} />
      <Node cx={64} cy={82} r={1.4} />
      <Node cx={238} cy={84} r={1.4} />
    </Frame>
  );
}

/** 05 — Text classification: fragments → central classifier → domain clusters. */
function TextClassDiagram() {
  const frags = [22, 40, 58, 76, 94];
  const clusters = [
    [250, 30],
    [268, 44],
    [256, 58],
    [250, 78],
    [270, 92],
    [252, 108],
    [268, 118],
  ];
  return (
    <Frame>
      {/* Incoming text fragments */}
      {frags.map((y, i) => (
        <line
          key={i}
          x1="16"
          y1={y}
          x2={i % 2 ? 52 : 44}
          y2={y}
          stroke={LINE_IVORY}
          strokeWidth="2"
        />
      ))}
      {/* Feed lines into classifier */}
      {frags.map((y, i) => (
        <path
          key={`f${i}`}
          d={`M52 ${y} C 90 ${y}, 120 66, 150 66`}
          stroke={LINE_FAINT}
          strokeWidth="1"
        />
      ))}
      {/* Classifier layer */}
      <line x1="150" y1="26" x2="150" y2="106" stroke={LINE_GOLD} strokeWidth="1" />
      {/* Branch to domain clusters */}
      <path d="M150 66 C 190 66, 200 40, 240 40" stroke={LINE_IVORY} strokeWidth="1" />
      <path d="M150 66 C 190 66, 206 84, 240 84" stroke={LINE_IVORY} strokeWidth="1" />
      <path d="M150 66 C 190 66, 206 110, 240 110" stroke={LINE_IVORY} strokeWidth="1" />
      {clusters.map(([x, y], i) => (
        <Node key={i} cx={x!} cy={y!} r={1.6} />
      ))}
      <FocusNode cx={150} cy={66} />
    </Frame>
  );
}

/** 06 — Self-driving: bright optimized route among faint alternatives, speed markers. */
function DrivingDiagram() {
  return (
    <Frame>
      {/* Road edges */}
      <path d="M10 118 C 90 108, 150 40, 290 22" stroke={LINE_FAINT} strokeWidth="1" />
      <path d="M10 128 C 100 122, 170 64, 296 44" stroke={LINE_FAINT} strokeWidth="1" />
      {/* Alternative paths */}
      <path
        d="M24 122 C 110 110, 150 84, 288 40"
        stroke={LINE_IVORY}
        strokeWidth="1"
        opacity="0.45"
        strokeDasharray="3 5"
      />
      <path
        d="M24 122 C 120 118, 190 70, 292 34"
        stroke={LINE_IVORY}
        strokeWidth="1"
        opacity="0.45"
        strokeDasharray="3 5"
      />
      {/* Selected optimized route */}
      <path d="M24 122 C 110 112, 160 56, 290 30" stroke={LINE_GOLD} strokeWidth="1.4" />
      {/* Speed markers */}
      {[
        [74, 100],
        [128, 78],
        [182, 58],
        [236, 42],
      ].map(([x, y], i) => (
        <line
          key={i}
          x1={x!}
          y1={y! - 5}
          x2={x!}
          y2={y! + 5}
          stroke={NODE}
          strokeWidth="1"
          opacity="0.6"
        />
      ))}
      <Node cx={24} cy={122} />
      <FocusNode cx={290} cy={30} />
    </Frame>
  );
}

/** 07 — Deepfake: split face/waveform structure with inconsistency + verification markers. */
function DeepfakeDiagram() {
  return (
    <Frame>
      {/* Divide */}
      <line
        x1="150"
        y1="16"
        x2="150"
        y2="116"
        stroke={LINE_GOLD}
        strokeWidth="1"
        strokeDasharray="2 5"
      />
      {/* Left: coherent contour */}
      <path
        d="M40 66 C 40 34, 92 26, 116 40 C 132 50, 132 82, 116 92 C 92 106, 40 98, 40 66 Z"
        stroke={LINE_IVORY}
        strokeWidth="1"
      />
      <path d="M40 66 C 70 60, 92 60, 116 66" stroke={LINE_FAINT} strokeWidth="1" />
      {/* Right: fractured contour with inconsistency ticks */}
      <path
        d="M184 40 C 210 30, 250 34, 260 52 M262 60 C 262 78, 250 92, 236 96 M228 98 C 208 100, 190 92, 186 78"
        stroke={LINE_IVORY}
        strokeWidth="1"
        opacity="0.7"
      />
      <path
        d="M184 66 L 200 62 L 214 70 L 230 60 L 246 68 L 260 62"
        stroke={LINE_GOLD}
        strokeWidth="1"
      />
      {/* Inconsistency markers */}
      {[
        [214, 70],
        [246, 68],
        [230, 60],
      ].map(([x, y], i) => (
        <g key={i}>
          <line x1={x! - 3} y1={y! - 3} x2={x! + 3} y2={y! + 3} stroke={NODE} strokeWidth="1" />
          <line x1={x! - 3} y1={y! + 3} x2={x! + 3} y2={y! - 3} stroke={NODE} strokeWidth="1" />
        </g>
      ))}
      <FocusNode cx={214} cy={70} />
    </Frame>
  );
}

/** 08 — Speech emotion: waveform with layered signal bands and shifting intensity. */
function SpeechDiagram() {
  const bars = [
    18, 30, 46, 66, 40, 24, 52, 78, 58, 34, 20, 44, 70, 88, 62, 38, 26, 48, 72, 50, 30, 16,
  ];
  return (
    <Frame>
      {/* Emotional-signal bands */}
      <rect x="0" y="34" width="300" height="26" fill="hsl(var(--brand) / 0.08)" />
      <rect x="0" y="76" width="300" height="20" fill="hsl(var(--foreground) / 0.06)" />
      {/* Waveform bars around the mid-line */}
      {bars.map((h, i) => {
        const x = 14 + i * 12.4;
        const mid = 66;
        const isFocus = i === 13;
        return (
          <line
            key={i}
            x1={x}
            y1={mid - h / 2}
            x2={x}
            y2={mid + h / 2}
            stroke={isFocus ? NODE : i % 3 === 0 ? LINE_GOLD : LINE_IVORY}
            strokeWidth={isFocus ? 1.6 : 1}
            strokeLinecap="round"
            opacity={isFocus ? 1 : 0.7}
          />
        );
      })}
      <FocusNode cx={175.2} cy={66} delay={0.4} />
    </Frame>
  );
}

const DIAGRAMS = [
  CrowdDiagram,
  AccidentDiagram,
  WildfireDiagram,
  FloodDiagram,
  TextClassDiagram,
  DrivingDiagram,
  DeepfakeDiagram,
  SpeechDiagram,
] as const;

/** Renders the abstract diagram for project `index` (0-based). Decorative only. */
export function ProjectDiagram({ index }: { index: number }) {
  const Diagram = DIAGRAMS[index] ?? CrowdDiagram;
  return (
    <div aria-hidden className="ol-diagram h-full w-full">
      <Diagram />
    </div>
  );
}
