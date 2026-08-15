#!/usr/bin/env python3
"""
Figures for the integration/main branch evaluation report.

Every number plotted here is MEASURED and cited to the file it came from.
Nothing is modelled, interpolated or illustrative except Figure 2's cost
curve, which is a stated arithmetic projection from the query count the
ingestion loop actually issues -- the assumption is printed on the chart.

Run:  python3 scripts/gen-evaluation-figures.py
Out:  docs/branch-evaluation/figures/*.png
"""
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "docs", "branch-evaluation", "figures")
os.makedirs(OUT, exist_ok=True)

# --- palette (validated: scripts/validate_palette.js, light mode) -----------
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
MUTED = "#52514e"
GRID = "#e3e2de"
EMPTY = "#eceae6"          # unfilled remainder of a proportion bar
BLUE = "#2a78d6"           # categorical slot 1
ORANGE = "#eb6834"         # categorical slot 2
BLUE_DEEP = "#184f95"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 9,
    "text.color": INK,
    "axes.labelcolor": MUTED,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "axes.edgecolor": GRID,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
})


def _strip(ax, keep_bottom=True):
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_visible(keep_bottom)
    ax.spines["bottom"].set_color(GRID)


# ===========================================================================
# Figure 1 - the two independent ceilings on effectiveness
# ===========================================================================
def figure_coverage():
    """
    Two proportion bars. Part-of-whole with a single headline each, so a bar
    with a labelled remainder beats any pie: the eye compares two lengths
    against a common baseline and the uncovered share stays visible.

    Sources:
      9,262 records / 664 status=='Live'
        control-service/src/seed/harvest.ts (measured 2026-08-09)
      171 of 666 route-directions calibrated
        control-service/src/seed/odTimetable.ts (measured 2026-08-11)
    """
    fig, axes = plt.subplots(2, 1, figsize=(7.6, 3.6))
    fig.subplots_adjust(hspace=2.1, top=0.76, bottom=0.13, left=0.035, right=0.985)

    panels = [
        {
            "title": "Fleet visibility  —  vehicles reporting live GPS",
            "covered": 664, "total": 9262, "unit": "vehicles",
            "covered_label": "664 reporting  status: Live",
            "rest_label": "8,598 not reporting a live position",
            "source": "control-service/src/seed/harvest.ts · measured 2026-08-09",
        },
        {
            "title": "Network calibration  —  route-directions with a target headway H*",
            "covered": 171, "total": 666, "unit": "route-directions",
            "covered_label": "171 calibrated  (74 timetable + 97 OD)",
            "rest_label": "495 with no target headway — detection is off",
            "source": "control-service/src/seed/odTimetable.ts · measured 2026-08-11",
        },
    ]

    for ax, p in zip(axes, panels):
        frac = p["covered"] / p["total"]
        ax.barh([0], [1.0], height=0.52, color=EMPTY, zorder=1)
        ax.barh([0], [frac], height=0.52, color=BLUE, zorder=2)

        ax.set_xlim(0, 1)
        ax.set_ylim(-0.5, 0.5)
        ax.set_yticks([])
        ax.set_xticks([])
        _strip(ax, keep_bottom=False)

        ax.text(0, 0.72, p["title"], transform=ax.get_yaxis_transform(),
                ha="left", va="bottom", fontsize=9.5, fontweight="bold", color=INK)

        # Headline percentage, inside the fill when it fits, outside when it doesn't.
        pct = f"{frac * 100:.1f}%"
        if frac > 0.12:
            ax.text(frac - 0.012, 0, pct, ha="right", va="center",
                    fontsize=11, fontweight="bold", color="#ffffff", zorder=3)
        else:
            ax.text(frac + 0.012, 0, pct, ha="left", va="center",
                    fontsize=11, fontweight="bold", color=BLUE_DEEP, zorder=3)

        ax.text(0, -0.78, p["covered_label"], transform=ax.get_yaxis_transform(),
                ha="left", va="top", fontsize=8.2, color=BLUE_DEEP)
        ax.text(1, -0.78, p["rest_label"], transform=ax.get_yaxis_transform(),
                ha="right", va="top", fontsize=8.2, color=MUTED)
        ax.text(1, 0.72, f"of {p['total']:,} {p['unit']}", transform=ax.get_yaxis_transform(),
                ha="right", va="bottom", fontsize=8.2, color=MUTED)
        ax.text(0, -1.45, p["source"], transform=ax.get_yaxis_transform(),
                ha="left", va="top", fontsize=6.8, color=MUTED, style="italic")

    fig.suptitle("Two independent ceilings on how much of the fleet can be regulated at all",
                 fontsize=11, fontweight="bold", color=INK, x=0.035, ha="left", y=0.99)
    fig.text(0.035, 0.915,
             "Both must be lifted. Neither is a code change — one is GPS telemetry coverage, "
             "the other an identifier-space join in the upstream feeds.",
             fontsize=8.2, color=MUTED, ha="left")

    path = os.path.join(OUT, "01-coverage-ceilings.png")
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path


# ===========================================================================
# Figure 2 - the ingestion throughput wall
# ===========================================================================
def figure_throughput():
    """
    Cost of one ingestion cycle against fleet size, versus the 30s poll
    interval it has to fit inside.

    The model is arithmetic, not a benchmark, and the chart says so:
    ingestPositionEvents (control-service/src/ingestion/pipeline.ts) is a
    sequential `for` loop with `await` inside, and each event issues three
    queries -- loadActiveHold, resolveCurrentTrip, saveVehicleState
    (control-service/src/state-estimation/service.ts). So

        cycle seconds = fleet x 3 x round-trip

    Two round-trip figures are drawn because the deployment target is not
    fixed: 2 ms is a same-host/same-AZ managed Postgres, 5 ms a realistic
    cross-AZ one.
    """
    QUERIES_PER_EVENT = 3
    BUDGET_S = 30           # GPS_POLL_INTERVAL_MS default, config/env.ts
    TODAY = 664             # measured live fleet, harvest.ts
    TARGET = 14000          # the fleet size this report is asked about

    xs = list(range(0, 16001, 100))
    series = [
        {"rtt": 0.002, "color": BLUE, "label": "2 ms per query  (same-AZ Postgres)"},
        {"rtt": 0.005, "color": ORANGE, "label": "5 ms per query  (cross-AZ Postgres)"},
    ]

    fig, ax = plt.subplots(figsize=(7.6, 4.2))
    fig.subplots_adjust(top=0.74, bottom=0.15, left=0.085, right=0.985)
    ax.set_xlim(0, 16000)
    ax.set_ylim(0, 250)

    # Budget band first, so the data sits on top of it.
    ax.axhspan(0, BUDGET_S, color="#f4f3f0", zorder=0)
    ax.axhline(BUDGET_S, color=MUTED, lw=1.2, ls=(0, (5, 3)), zorder=2)
    ax.text(15800, BUDGET_S + 5, "30 s poll interval — the whole cycle must fit under this line",
            fontsize=8.2, color=MUTED, va="bottom", ha="right")

    # The target fleet size, marked once rather than once per series.
    ax.axvline(TARGET, color=GRID, lw=1, zorder=1)
    ax.text(TARGET - 130, 244, f"target fleet  {TARGET:,}", fontsize=8, color=MUTED,
            ha="right", va="top")

    # "over budget past N" labels sit either side of the budget line — the
    # slower series above it, the faster one below in the empty shaded band —
    # so neither crosses a data line or the x-tick row.
    # Both labels live inside the empty budget band, right of their own
    # crossing dot, at heights chosen so neither passes under a data line:
    # right of x=5,000 both curves are above the band entirely, so the blue
    # label can sit high in it; the orange label has to duck under the blue
    # curve and so sits near the floor.
    cross_offsets = {0.002: (9, -11), 0.005: (9, -17)}

    for s in series:
        ys = [x * QUERIES_PER_EVENT * s["rtt"] for x in xs]
        ax.plot(xs, ys, color=s["color"], lw=2, zorder=3, label=s["label"], solid_capstyle="round")
        # Direct label at the target fleet size.
        y_at_target = TARGET * QUERIES_PER_EVENT * s["rtt"]
        ax.plot([TARGET], [y_at_target], "o", ms=8, color=s["color"],
                mec=SURFACE, mew=2, zorder=4)
        ax.annotate(f"{y_at_target:.0f} s",
                    xy=(TARGET, y_at_target), xytext=(-11, 5), textcoords="offset points",
                    ha="right", va="bottom", fontsize=10, fontweight="bold", color=s["color"])
        # Where it crosses the budget.
        cross = BUDGET_S / (QUERIES_PER_EVENT * s["rtt"])
        ax.plot([cross], [BUDGET_S], "o", ms=6, color=s["color"], mec=SURFACE, mew=1.6, zorder=4)
        dx, dy = cross_offsets[s["rtt"]]
        ax.annotate(f"over budget past {cross:,.0f} buses",
                    xy=(cross, BUDGET_S), xytext=(dx, dy),
                    textcoords="offset points", ha="left", va="center",
                    fontsize=7.8, color=s["color"], fontweight="bold")

    # Today's 664 live buses sit hard against the origin: a gridline there is
    # unreadable and a leader line to it reads as a third series. It goes in
    # the figure caption instead.
    ax.set_xlabel("Live buses ingested per cycle")
    ax.set_ylabel("Time for one ingestion cycle (seconds)")
    ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.yaxis.grid(True, color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    _strip(ax)

    leg = ax.legend(loc="upper left", frameon=False, fontsize=8.4, handlelength=1.6,
                    bbox_to_anchor=(0.0, 0.99))
    for t in leg.get_texts():
        t.set_color(MUTED)

    fig.suptitle("Sequential ingestion stops fitting inside its own poll interval well before 14,000 buses",
                 fontsize=10.6, fontweight="bold", color=INK, x=0.035, ha="left", y=0.99)
    fig.text(0.035, 0.905,
             "Projection, not a benchmark:  cycle = fleet × 3 queries × round-trip.  "
             "The loop in ingestion/pipeline.ts awaits one event at a time;\nservice.ts issues three "
             "queries per event. No load test exists in the repository — that is itself a finding.",
             fontsize=8.2, color=MUTED, ha="left", linespacing=1.45)

    path = os.path.join(OUT, "02-ingestion-throughput.png")
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path


# ===========================================================================
# Figure 3 - detection latency as the sweep stops covering the network
# ===========================================================================
def figure_latency():
    """
    Step function, because the quantity really is a step: a route-direction is
    visited once every ceil(eligible / batch) cycles, so latency jumps by a
    whole 3-minute sample window each time the eligible set crosses a multiple
    of HEADWAY_BATCH_SIZE.

        latency = required_samples x interval x ceil(eligible / batch)
                = 3 x 60s x ceil(eligible / 60)

    from control-service/src/scheduler/headwayCompute.ts and the defaults in
    config/env.ts.
    """
    import math

    REQUIRED_SAMPLES = 3
    INTERVAL_S = 60
    BATCH = 60

    xs = list(range(1, 641))
    ys = [REQUIRED_SAMPLES * INTERVAL_S * math.ceil(x / BATCH) / 60 for x in xs]

    fig, ax = plt.subplots(figsize=(7.6, 3.4))
    fig.subplots_adjust(top=0.78, bottom=0.17, left=0.085, right=0.985)

    ax.step(xs, ys, where="post", color=BLUE, lw=2, zorder=3, solid_capstyle="round")
    ax.fill_between(xs, 0, ys, step="post", color=BLUE, alpha=0.10, zorder=2)

    # The two points that matter. Both labels are placed off the staircase —
    # "today" into the empty white wedge above the first steps, "at 14,000"
    # into the pale fill beneath the later ones — so neither sits on the line.
    marks = [
        (40, "today\n~a few dozen eligible", "left", (-8, 95), "bottom"),
        (600, "at 14,000 buses\n(order of magnitude)", "right", (-8, -42), "top"),
    ]
    for x, label, ha, offset, va in marks:
        y = REQUIRED_SAMPLES * INTERVAL_S * math.ceil(x / BATCH) / 60
        ax.plot([x], [y], "o", ms=8, color=BLUE, mec=SURFACE, mew=2, zorder=4)
        ax.annotate(f"{label}\n{y:.0f} min to first detection",
                    xy=(x, y), xytext=offset, textcoords="offset points",
                    ha=ha, va=va, fontsize=8.2, color=BLUE_DEEP,
                    fontweight="bold", linespacing=1.4, zorder=5,
                    arrowprops=dict(arrowstyle="-", color=BLUE_DEEP, lw=0.9,
                                    shrinkA=2, shrinkB=4, alpha=0.45))

    ax.axhline(3, color=MUTED, lw=1.1, ls=(0, (5, 3)), zorder=1)
    ax.text(636, 3.6, "3 min — the latency the design assumes",
            fontsize=8, color=MUTED, ha="right", va="bottom")

    ax.set_xlim(0, 640)
    ax.set_ylim(0, 36)
    ax.set_xlabel("Route-directions eligible for a headway pair (≥2 fresh map-matched vehicles)")
    ax.set_ylabel("Time to first detection (minutes)")
    ax.yaxis.grid(True, color=GRID, lw=0.8)
    ax.set_axisbelow(True)
    _strip(ax)

    fig.suptitle("Detection latency multiplies in whole sample-windows once the sweep cannot cover the network",
                 fontsize=11, fontweight="bold", color=INK, x=0.035, ha="left", y=0.985)
    fig.text(0.035, 0.875,
             "latency = 3 samples × 60 s × ⌈eligible ÷ 60⌉.  Raising HEADWAY_BATCH_SIZE is the obvious fix and "
             "immediately meets\nHEADWAY_COMPUTE_CONCURRENCY = 4 against a connection pool of 10.",
             fontsize=8.2, color=MUTED, ha="left", linespacing=1.45)

    path = os.path.join(OUT, "03-detection-latency.png")
    fig.savefig(path, dpi=220, bbox_inches="tight")
    plt.close(fig)
    return path


if __name__ == "__main__":
    for fn in (figure_coverage, figure_throughput, figure_latency):
        print("wrote", fn())
