#!/usr/bin/env python3
"""
Generate the architecture diagrams for
docs/technical-architecture/Olympuss_AI_UPSRTC_Technical_Architecture_and_Code_Walkthrough.docx

Pure-matplotlib box/arrow diagrams (no Graphviz/pandoc dependency). Every
diagram is rendered at 200 DPI PNG, sized for an A4/Letter content column.

Run:  python3 scripts/gen-arch-diagrams.py
Out:  docs/technical-architecture/diagrams/*.png
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle
from matplotlib.lines import Line2D

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "technical-architecture", "diagrams")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)

# Palette (theme-neutral, print-friendly, all >4.5:1 on white)
INK = "#0f172a"
MUTED = "#475569"
LINE = "#334155"
BLUE = "#1d4ed8";  BLUE_F = "#dbeafe"
TEAL = "#0f766e";  TEAL_F = "#ccfbf1"
AMBER = "#b45309"; AMBER_F = "#fef3c7"
VIOLET = "#6d28d9";VIOLET_F = "#ede9fe"
GREEN = "#15803d"; GREEN_F = "#dcfce7"
RED = "#b91c1c";   RED_F = "#fee2e2"
SLATE = "#334155"; SLATE_F = "#e2e8f0"
plt.rcParams["font.family"] = "DejaVu Sans"


def new(w=11, h=7):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 104)
    ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, text, fc=SLATE_F, ec=SLATE, tc=INK, fs=9.5, bold=False,
        style="round,pad=0.02,rounding_size=0.12", lw=1.4):
    p = FancyBboxPatch((x, y), w, h, boxstyle=style, fc=fc, ec=ec, lw=lw, mutation_aspect=1)
    ax.add_patch(p)
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            fontsize=fs, color=tc, weight="bold" if bold else "normal", wrap=True)
    return (x + w / 2, y + h / 2, x, y, w, h)


def arrow(ax, x1, y1, x2, y2, color=LINE, lw=1.6, ls="-", rad=0.0, text=None, fs=8, tcol=None):
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14,
                        color=color, lw=lw, linestyle=ls,
                        connectionstyle=f"arc3,rad={rad}", shrinkA=2, shrinkB=2)
    ax.add_patch(a)
    if text:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        ax.text(mx, my, text, fontsize=fs, color=tcol or MUTED, ha="center", va="center",
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.85))


def title(ax, t, sub=None):
    ax.text(50, 103, t, ha="center", va="top", fontsize=13.5, weight="bold", color=INK)
    if sub:
        ax.text(50, 97.5, sub, ha="center", va="top", fontsize=9, color=MUTED)


def save(fig, name):
    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", os.path.relpath(path))


# 1 — Overall system architecture
def d1():
    fig, ax = new(11, 8)
    title(ax, "Figure 1 — Overall System Architecture",
          "Two independently deployed systems + shared UPSRTC upstream and Postgres datastores")
    box(ax, 38, 84, 24, 6, "UPSRTC VLT upstream\nmargdarshi.upsrtcvlt.com (PHP)", AMBER_F, AMBER, fs=9, bold=True)
    # Web app column
    box(ax, 5, 60, 40, 16, "Next.js 15 Web App  (Vercel, serverless)\nApp Router · React 19 · Zustand · three.js\nPublic landing · UPSRTC dashboard · Ops RBAC", BLUE_F, BLUE, fs=8.5, bold=True)
    box(ax, 8, 46, 15, 7, "/api/upsrtc/*\nserver proxy\n(15s TTL cache)", BLUE_F, BLUE, fs=7.5)
    box(ax, 27, 46, 15, 7, "/api/ops/* RBAC\n+ webhook\nreceiver", BLUE_F, BLUE, fs=7.5)
    # Control service column
    box(ax, 55, 60, 40, 16, "control-service  (Render, always-on Node)\nExpress · Kalman + MPC · scheduler jobs\nGPS ingest · state estimation · commands", TEAL_F, TEAL, fs=8.5, bold=True)
    box(ax, 58, 46, 15, 7, "REST /v1/*\n(service-token\nbearer)", TEAL_F, TEAL, fs=7.5)
    box(ax, 77, 46, 15, 7, "in-proc GPS\npoller +\nheadway sweep", TEAL_F, TEAL, fs=7.5)
    # Datastores
    box(ax, 8, 30, 34, 7, "Supabase (Postgres) — auth users,\nops RBAC, copilot logs, webhook events", VIOLET_F, VIOLET, fs=8)
    box(ax, 58, 30, 34, 7, "control-service Postgres/PostGIS —\nvehicle_states, headway, commands, policies", VIOLET_F, VIOLET, fs=8)
    # External
    box(ax, 8, 16, 20, 6, "Google Maps JS SDK\n(browser)", GREEN_F, GREEN, fs=8)
    box(ax, 31, 16, 16, 6, "Anthropic API\n(copilot)", GREEN_F, GREEN, fs=8)
    box(ax, 58, 16, 16, 6, "Resend\n(invite email)", GREEN_F, GREEN, fs=8)
    box(ax, 77, 16, 15, 6, "Upstash Redis\n(optional)", GREEN_F, GREEN, fs=8)
    box(ax, 5, 4, 40, 6, "Browser — Operators / Drivers / Admin", SLATE_F, SLATE, fs=9, bold=True)

    arrow(ax, 30, 84, 25, 76)             # upstream -> web proxy
    arrow(ax, 70, 84, 78, 76)             # upstream -> cs poller
    arrow(ax, 25, 60, 25, 53)
    arrow(ax, 35, 60, 35, 53)
    arrow(ax, 65, 60, 65, 53)
    arrow(ax, 85, 60, 85, 53)
    arrow(ax, 25, 46, 25, 37)
    arrow(ax, 75, 46, 75, 37)
    arrow(ax, 55, 68, 45, 68, color=RED, text="REST + signed webhook", tcol=RED)
    arrow(ax, 45, 66, 55, 66, color=RED)
    arrow(ax, 25, 60, 18, 22, color=GREEN, ls="--")   # web -> maps
    arrow(ax, 30, 46, 39, 22, color=GREEN, ls="--")   # web -> anthropic
    arrow(ax, 25, 16, 25, 10)
    ax.text(50, 71, "isolated\ndatastores", fontsize=7.5, color=RED, ha="center")
    save(fig, "01-system-architecture.png")


# 2 — Application request flow (dev -> browser)
def d2():
    fig, ax = new(10.5, 8)
    title(ax, "Figure 2 — Application Request Flow", "npm run dev  →  authenticated dashboard in the browser")
    steps = [
        ("next dev  → compiles App Router, starts Node server", BLUE_F, BLUE),
        ("Browser GET /project/upsrtc", SLATE_F, SLATE),
        ("Edge middleware.ts — Supabase session check", AMBER_F, AMBER),
        ("(protected) layout re-verifies session (defence in depth)", AMBER_F, AMBER),
        ("Server renders CommandCenter shell (RSC)", BLUE_F, BLUE),
        ("Client mounts: useLiveFleet() begins 15s polling", TEAL_F, TEAL),
        ("fetch('/api/upsrtc/live') → route.ts GET", TEAL_F, TEAL),
        ("requireUpsrtcAccess() → TtlCache → fetchUpstream()", TEAL_F, TEAL),
        ("normalizeLivePayload() → canonical buses (Zustand store)", VIOLET_F, VIOLET),
        ("FleetMap canvas layer draws ~9.5k vehicles", GREEN_F, GREEN),
    ]
    y = 84
    prev = None
    for i, (t, fc, ec) in enumerate(steps):
        c = box(ax, 14, y, 72, 6.2, f"{i+1}.  {t}", fc, ec, fs=9)
        if prev is not None:
            arrow(ax, 50, prev, 50, y + 6.2)
        prev = y
        y -= 8.0
    save(fig, "02-request-flow.png")


# 3 — Frontend component hierarchy
def d3():
    fig, ax = new(11, 8)
    title(ax, "Figure 3 — Frontend Component Hierarchy (UPSRTC Dashboard)",
          "src/app/(protected)/project/upsrtc → CommandCenter and children")
    box(ax, 34, 88, 32, 6, "RootLayout (app/layout.tsx)", SLATE_F, SLATE, bold=True, fs=9)
    box(ax, 34, 78, 32, 6, "(protected)/project/upsrtc/page.tsx", BLUE_F, BLUE, fs=8.5)
    box(ax, 30, 68, 40, 6, "CommandCenter  (client) — useLiveFleet · useSchedule · useAlertStream", BLUE_F, BLUE, bold=True, fs=8)
    arrow(ax, 50, 88, 50, 84)
    arrow(ax, 50, 78, 50, 74)
    kids = [
        ("TopCommandBar", TEAL_F, TEAL), ("IntelligenceStrip", TEAL_F, TEAL),
        ("FleetPanel", GREEN_F, GREEN), ("AlertCentre", AMBER_F, AMBER),
        ("FleetMap\n(canvas layer)", GREEN_F, GREEN), ("BusDetailDrawer", GREEN_F, GREEN),
        ("CopilotPanel", VIOLET_F, VIOLET), ("ScenarioStage /\nScenarioLab", AMBER_F, AMBER),
        ("PitchMode", SLATE_F, SLATE), ("ImpactDashboard", SLATE_F, SLATE),
        ("DiagnosticsDrawer", SLATE_F, SLATE), ("Driver Msg /\nVoIP overlays", SLATE_F, SLATE),
    ]
    x0, y0, w, h, gx, gy = 4, 50, 22, 7, 2, 3
    for i, (t, fc, ec) in enumerate(kids):
        col = i % 4
        row = i // 4
        x = x0 + col * (w + gx)
        y = y0 - row * (h + gy)
        box(ax, x, y, w, h, t, fc, ec, fs=7.8)
        arrow(ax, 50, 68, x + w / 2, y + h, rad=0.0, lw=1.0, color="#94a3b8")
    box(ax, 20, 12, 60, 7, "Shared state: Zustand useCopilotStore  (buses, selectedBusId, alerts,\nscenario, audit, UI drawers)", VIOLET_F, VIOLET, fs=8, bold=True)
    for i in range(4):
        arrow(ax, 15 + i * 24, 50, 30 + i * 8, 19, lw=0.8, color="#cbd5e1")
    save(fig, "03-frontend-hierarchy.png")


# 4 — Backend / API architecture
def d4():
    fig, ax = new(11, 8)
    title(ax, "Figure 4 — Backend / API Architecture", "Two auth domains in the web app + the control-service REST surface")
    box(ax, 3, 80, 30, 8, "Supabase-authed surface\n/api/auth/* · /api/upsrtc/*", BLUE_F, BLUE, bold=True, fs=8.5)
    box(ax, 35, 80, 30, 8, "Ops RBAC surface\n/api/ops/*  (7 roles, JWT cookie)", AMBER_F, AMBER, bold=True, fs=8.5)
    box(ax, 67, 80, 30, 8, "Machine-to-machine\n/api/control-service/webhook (HMAC)", TEAL_F, TEAL, bold=True, fs=8.5)
    box(ax, 20, 66, 60, 6, "src/middleware.ts — matcher allowlist; three independent auth branches", SLATE_F, SLATE, fs=8.5)
    arrow(ax, 18, 80, 40, 72); arrow(ax, 50, 80, 50, 72); arrow(ax, 82, 80, 60, 72)
    box(ax, 3, 52, 30, 8, "upstream proxy libs\nclient · normalizer · cache · respond", BLUE_F, BLUE, fs=7.8)
    box(ax, 35, 52, 30, 8, "RBAC libs\nguard · session(jose) · repo(pg)", AMBER_F, AMBER, fs=7.8)
    box(ax, 67, 52, 30, 8, "controlService client\nservice-token · circuit breaker", TEAL_F, TEAL, fs=7.8)
    arrow(ax, 18, 66, 18, 60); arrow(ax, 50, 66, 50, 60); arrow(ax, 82, 66, 82, 60)
    box(ax, 60, 34, 37, 12, "control-service (Express, createApp)\nrequireServiceToken guard →\ncommands · headway · mpc · positions ·\npilot · vehicle-states routers", TEAL_F, TEAL, fs=8, bold=True)
    arrow(ax, 82, 52, 82, 46, color=RED, text="Bearer", tcol=RED)
    box(ax, 3, 34, 30, 8, "Supabase Postgres", VIOLET_F, VIOLET, fs=8)
    box(ax, 35, 34, 22, 8, "Ops Postgres\n(OPS_DATABASE_URL)", VIOLET_F, VIOLET, fs=7.8)
    arrow(ax, 18, 52, 18, 42); arrow(ax, 46, 52, 46, 42)
    box(ax, 60, 20, 37, 8, "control-service Postgres / PostGIS", VIOLET_F, VIOLET, fs=8)
    arrow(ax, 78, 34, 78, 28)
    save(fig, "04-backend-api.png")


# 5 — UPSRTC GPS data flow
def d5():
    fig, ax = new(11, 8)
    title(ax, "Figure 5 — UPSRTC Live GPS Data Flow", "Two independent consumers of the same undocumented PHP feed")
    box(ax, 33, 88, 34, 6, "UPSRTC getGpsLiveData.php\n~9,261 rows / ~11.7 MB, text/html-labelled JSON", AMBER_F, AMBER, bold=True, fs=8)
    # web path
    box(ax, 4, 72, 30, 7, "WEB: useLiveFleet (15s)\n→ GET /api/upsrtc/live", BLUE_F, BLUE, fs=8)
    box(ax, 4, 61, 30, 7, "fetchUpstream() 10s timeout\nHTML-guard + JSON.parse", BLUE_F, BLUE, fs=7.8)
    box(ax, 4, 50, 30, 7, "normalizeLivePayload()\nalias map · coord gate · IST fix", BLUE_F, BLUE, fs=7.8)
    box(ax, 4, 39, 30, 7, "TtlCache 15s · dedupe by reg\n→ LiveFeedResponse", BLUE_F, BLUE, fs=7.8)
    box(ax, 4, 28, 30, 7, "Zustand store → FleetMap\ncanvas overlay", GREEN_F, GREEN, fs=7.8)
    for y1, y2 in [(88,79),(72,68),(61,57),(50,46),(39,35)]:
        arrow(ax, 19, y1 if y1 != 88 else 88, 19, y2)
    arrow(ax, 40, 88, 19, 79)
    # cs path
    box(ax, 66, 72, 30, 7, "CS: scheduler/gpsPoll (30s)\nGPS_POLL_ENABLED on 1 node", TEAL_F, TEAL, fs=8)
    box(ax, 66, 61, 30, 7, "filter status='Live' (~665)\ndrop stale > 300s (IST fix)", TEAL_F, TEAL, fs=7.8)
    box(ax, 66, 50, 30, 7, "ingestPositionEvents()\nper-event failure isolation", TEAL_F, TEAL, fs=7.8)
    box(ax, 66, 39, 30, 7, "StateEstimation: mapMatch →\nKalman → stop-state → order", VIOLET_F, VIOLET, fs=7.8)
    box(ax, 66, 28, 30, 7, "vehicle_states table +\nin-memory stateStore", VIOLET_F, VIOLET, fs=7.8)
    for y1, y2 in [(72,68),(61,57),(50,46),(39,35)]:
        arrow(ax, 81, y1, 81, y2)
    arrow(ax, 60, 88, 81, 79)
    box(ax, 30, 15, 40, 7, "Degradation ladder (web): live → cache(fresh)\n→ cache(stale) → unavailable(0 rows) → fixture (opt-in only)", RED_F, RED, fs=7.8, bold=True)
    arrow(ax, 19, 28, 40, 22, lw=1.0, color=RED)
    save(fig, "05-gps-data-flow.png")


# 6 — Bunching detection flow (control-service)
def d6():
    fig, ax = new(10.5, 8)
    title(ax, "Figure 6 — Bunching Detection Flow (control-service)",
          "headwayCompute sweep → reactive rule → incident")
    steps = [
        ("scheduler/headwayCompute — every 60s, batches of 60 eligible route-directions", TEAL_F, TEAL),
        ("computeLeaderFollowerOrder() — sort by distance-along-route; low-confidence → rank −1", VIOLET_F, VIOLET),
        ("computePairHeadways() — gapMeters / speed → hFwd, hBwd, deviation per leader→follower link", BLUE_F, BLUE),
        ("computeAggregate() — route-direction CV and Excess Wait Time (EWT)", BLUE_F, BLUE),
        ("persist headway samples (time series) + aggregate", VIOLET_F, VIOLET),
        ("evaluateBunchingRule() — ratio = hFwd/target over required_samples consecutive samples", AMBER_F, AMBER),
        ("ratio ≤ bunched_threshold_ratio (e.g. 0.25) → 'bunched'  ·  ≤ warning (0.5) → 'warning'", RED_F, RED),
        ("open / escalate / close incident (config from route_policies, never hard-coded)", RED_F, RED),
    ]
    y = 83
    prev = None
    for i, (t, fc, ec) in enumerate(steps):
        box(ax, 6, y, 88, 6.4, f"{i+1}.  {t}", fc, ec, fs=8.3)
        if prev is not None:
            arrow(ax, 50, prev, 50, y + 6.4)
        prev = y
        y -= 8.3
    save(fig, "06-bunching-detection.png")


# 7 — Intervention / recovery loop (MPC)
def d7():
    fig, ax = new(11, 8)
    title(ax, "Figure 7 — Bus-Bunching Intervention / Recovery Loop",
          "control-service MPC solver → human approval → driver ack → webhook")
    box(ax, 35, 88, 30, 6, "POST /v1/mpc/solve", TEAL_F, TEAL, bold=True, fs=9)
    box(ax, 6, 76, 40, 7, "1. Terminal dispatch (default first line)", GREEN_F, GREEN, fs=8)
    box(ax, 54, 76, 40, 7, "2. Two-way hold  (Kf·ΔhFwd − Kb·ΔhBwd)", BLUE_F, BLUE, fs=8)
    box(ax, 6, 66, 40, 7, "2b. Self-equalizing fallback  k·max(0,hBwd−hFwd)", BLUE_F, BLUE, fs=7.8)
    box(ax, 54, 66, 40, 7, "3. Hard safety filter (stale / max-hold / conflict)", RED_F, RED, fs=8)
    box(ax, 30, 55, 40, 7, "4. Occupancy-weighted MPC re-score (PREDICTIVE, advisory only)", VIOLET_F, VIOLET, fs=7.8)
    box(ax, 25, 44, 50, 7, "selectedActionType = lowest-cost safe candidate", TEAL_F, TEAL, bold=True, fs=8.5)
    arrow(ax, 50, 88, 26, 83); arrow(ax, 50, 88, 74, 83)
    arrow(ax, 26, 76, 26, 73); arrow(ax, 74, 76, 74, 73)
    arrow(ax, 74, 66, 60, 62); arrow(ax, 26, 66, 40, 62)
    arrow(ax, 50, 55, 50, 51)
    box(ax, 6, 32, 40, 7, "Control room: dispatcher action →\nPOST /api/ops/control-room/commands", AMBER_F, AMBER, fs=7.8)
    box(ax, 54, 32, 40, 7, "control-service persists command;\nrollout gate + kill switch checks", TEAL_F, TEAL, fs=7.8)
    arrow(ax, 50, 44, 26, 39); arrow(ax, 26, 32, 54, 35.5)
    box(ax, 6, 20, 40, 7, "Driver PWA: single instruction →\nack accept / unable / unsafe", GREEN_F, GREEN, fs=7.8)
    box(ax, 54, 20, 40, 7, "Signed webhook → web\n/api/control-service/webhook", TEAL_F, TEAL, fs=7.8)
    arrow(ax, 74, 32, 74, 27); arrow(ax, 46, 23.5, 54, 23.5)
    box(ax, 25, 8, 50, 7, "Headway recomputed next sweep → recovery measured (CV/EWT ↓)", VIOLET_F, VIOLET, bold=True, fs=8)
    arrow(ax, 26, 20, 40, 15)
    arrow(ax, 50, 8, 6, 44, color="#94a3b8", ls="--", rad=-0.35, text="closed loop", tcol=MUTED)
    save(fig, "07-intervention-recovery.png")


# 8 — Authentication flow
def d8():
    fig, ax = new(11, 7.5)
    title(ax, "Figure 8 — Authentication & Authorization", "Two independent auth systems + one machine channel")
    # Supabase
    box(ax, 4, 78, 44, 6, "Enterprise auth — Supabase Auth (email+password)", BLUE_F, BLUE, bold=True, fs=8.5)
    box(ax, 4, 68, 20, 7, "POST /api/auth/login\nsame-origin · rate-limit", BLUE_F, BLUE, fs=7.5)
    box(ax, 27, 68, 21, 7, "Supabase cookie session\n(@supabase/ssr)", BLUE_F, BLUE, fs=7.5)
    box(ax, 4, 58, 44, 6, "middleware + protected layout + each API re-check", AMBER_F, AMBER, fs=7.8)
    arrow(ax, 14, 68, 14, 64); arrow(ax, 24, 71.5, 27, 71.5); arrow(ax, 37, 68, 26, 64)
    # Ops RBAC
    box(ax, 52, 78, 44, 6, "Ops RBAC — custom HS256 JWT (jose), 7 roles", TEAL_F, TEAL, bold=True, fs=8.5)
    box(ax, 52, 68, 20, 7, "POST /api/ops/auth/login\nbcrypt verify", TEAL_F, TEAL, fs=7.5)
    box(ax, 75, 68, 21, 7, "OPS_SESSION_COOKIE\nHS256, OPS_SESSION_SECRET", TEAL_F, TEAL, fs=7.5)
    box(ax, 52, 58, 44, 6, "middleware roleForSegment() gate → /ops/forbidden or 403", AMBER_F, AMBER, fs=7.8)
    arrow(ax, 62, 68, 62, 64); arrow(ax, 72, 71.5, 75, 71.5); arrow(ax, 85, 68, 74, 64)
    # invite provisioning
    box(ax, 20, 45, 60, 6, "No self-service signup — admin invites (Resend email) provision every account", VIOLET_F, VIOLET, fs=8)
    arrow(ax, 26, 58, 35, 51); arrow(ax, 74, 58, 65, 51)
    # machine
    box(ax, 20, 30, 60, 7, "Machine channel — /api/control-service/webhook\nHMAC-SHA256 (CONTROL_SERVICE_WEBHOOK_SECRET); no cookie, no session", RED_F, RED, bold=True, fs=8)
    box(ax, 20, 18, 60, 6, "web → control-service REST: rotating Bearer service token", TEAL_F, TEAL, fs=8)
    save(fig, "08-auth-flow.png")


# 9 — Google Maps update flow
def d9():
    fig, ax = new(10.5, 7.5)
    title(ax, "Figure 9 — Google Maps Update Flow", "Single canvas overlay replaces ~9.5k individual markers")
    seq = [
        ("useLiveFleet polls /api/upsrtc/live every 15s", BLUE_F, BLUE),
        ("setFleet() writes canonical buses into Zustand store", VIOLET_F, VIOLET),
        ("FleetMap useEffect([buses]) → layer.setBuses(buses)  (O(1) handoff)", GREEN_F, GREEN),
        ("fleetCanvasLayer schedules one requestAnimationFrame redraw", GREEN_F, GREEN),
        ("local Mercator projection + Path2D per colour → single canvas fill", GREEN_F, GREEN),
        ("pan/zoom handled on compositor; O(visible) redraw, no DOM churn", TEAL_F, TEAL),
        ("selection → panTo/zoom fly-to (keyed on id, not position)", AMBER_F, AMBER),
    ]
    y = 82
    prev = None
    for i, (t, fc, ec) in enumerate(seq):
        box(ax, 8, y, 84, 6.6, f"{i+1}.  {t}", fc, ec, fs=8.6)
        if prev is not None:
            arrow(ax, 50, prev, 50, y + 6.6)
        prev = y
        y -= 8.7
    box(ax, 8, 5, 84, 6.6, "Key config: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY · getMapsLoader() · MAP_DARK_STYLE\nTrafficLayer explicitly NOT enabled (all traffic overlays are simulated)", RED_F, RED, fs=8, bold=True)
    arrow(ax, 50, y + 8.7, 50, 11.6)
    save(fig, "09-maps-update.png")


# 10 — Deployment architecture
def d10():
    fig, ax = new(11, 7.5)
    title(ax, "Figure 10 — Deployment Architecture", "Two deploy targets, isolated datastores")
    box(ax, 5, 82, 20, 7, "Developer\nmachine", SLATE_F, SLATE, fs=8.5, bold=True)
    box(ax, 32, 82, 20, 7, "GitHub\n(integration/full-system)", SLATE_F, SLATE, fs=8)
    arrow(ax, 25, 85.5, 32, 85.5, text="git push")
    box(ax, 5, 60, 42, 14, "Vercel — Next.js build\n· static + RSC + serverless API routes\n· CDN edge · middleware at edge\n· security headers + CSP (next.config.ts)", BLUE_F, BLUE, bold=True, fs=8)
    box(ax, 53, 60, 42, 14, "Render — control-service (Docker)\n· always-on Node process\n· /healthz + /readyz\n· render.yaml (staging + pilot)\n· scheduler jobs (1 poller instance)", TEAL_F, TEAL, bold=True, fs=8)
    arrow(ax, 40, 82, 26, 74); arrow(ax, 46, 82, 70, 74)
    box(ax, 5, 42, 42, 7, "Supabase (managed Postgres + Auth)", VIOLET_F, VIOLET, fs=8)
    box(ax, 53, 42, 42, 7, "control-service Postgres / PostGIS", VIOLET_F, VIOLET, fs=8)
    arrow(ax, 26, 60, 26, 49); arrow(ax, 74, 60, 74, 49)
    arrow(ax, 47, 67, 53, 67, color=RED, rad=0.15); arrow(ax, 53, 63, 47, 63, color=RED, rad=0.15,
          text="REST + webhook", tcol=RED)
    box(ax, 20, 26, 60, 7, "Browsers (operators, drivers, admin) — HTTPS", GREEN_F, GREEN, bold=True, fs=8.5)
    arrow(ax, 30, 42, 40, 33); arrow(ax, 70, 60, 60, 33, ls="--", color="#94a3b8")
    box(ax, 12, 10, 76, 7, "Secrets per environment (never committed): Supabase keys, Maps key (NEXT_PUBLIC, referrer-restricted),\nservice token, webhook HMAC, OPS_SESSION_SECRET, ANTHROPIC_API_KEY, Redis", AMBER_F, AMBER, fs=7.5)
    save(fig, "10-deployment.png")


# 11 — API sequence: driver command lifecycle
def d11():
    fig, ax = new(11, 8)
    title(ax, "Figure 11 — Command Lifecycle Sequence", "Dispatcher recommendation → driver ack → control-room visibility")
    actors = ["Control\nRoom UI", "web\n/api/ops", "control-\nservice", "Driver\nPWA", "webhook\nreceiver"]
    xs = [10, 30, 52, 74, 92]
    for x, a in zip(xs, actors):
        box(ax, x - 8, 88, 16, 6, a, SLATE_F, SLATE, fs=7.8, bold=True)
        ax.add_line(Line2D([x, x], [10, 88], color="#cbd5e1", lw=1.0, ls=(0, (3, 3))))
    def msg(y, i, j, t, col=LINE):
        arrow(ax, xs[i], y, xs[j], y, color=col, lw=1.4)
        mx = (xs[i] + xs[j]) / 2
        ax.text(mx, y + 1.2, t, fontsize=7.3, ha="center", color=INK)
    msg(82, 0, 1, "POST commands {dispatcherActionId, actionType, routeDirectionId, ttl}")
    msg(75, 1, 1, "kill-switch + same-origin + RBAC checks", MUTED)
    msg(68, 1, 2, "createControlServiceCommand() Bearer token", TEAL)
    msg(61, 2, 2, "rollout gate + persist (status: authorized)", MUTED)
    msg(54, 2, 1, "Command JSON (Zod-validated)", TEAL)
    msg(47, 1, 0, "200 → optimistic UI", BLUE)
    msg(40, 2, 3, "GET /v1/pilot-driver/commands (poll)", GREEN)
    msg(33, 3, 2, "POST ack {accept | unable | unsafe}", GREEN)
    msg(26, 2, 4, "signed webhook: command.acknowledged", RED)
    msg(19, 4, 0, "side effects → control room sees outcome", RED)
    save(fig, "11-command-sequence.png")


# 12 — State / data lifecycle
def d12():
    fig, ax = new(11, 7.5)
    title(ax, "Figure 12 — State & Data Lifecycle", "Where source-of-truth lives at each hop")
    box(ax, 4, 78, 26, 7, "GPS fix\n(upstream, ephemeral)", AMBER_F, AMBER, fs=8)
    box(ax, 37, 78, 26, 7, "PositionEvent\n(normalized, in-flight)", BLUE_F, BLUE, fs=8)
    box(ax, 70, 78, 26, 7, "VehicleStateEstimate\n(Kalman output)", VIOLET_F, VIOLET, fs=8)
    arrow(ax, 30, 81.5, 37, 81.5); arrow(ax, 63, 81.5, 70, 81.5)
    box(ax, 70, 62, 26, 7, "vehicle_states table\n+ stateStore (SoT: current)", VIOLET_F, VIOLET, bold=True, fs=8)
    box(ax, 37, 62, 26, 7, "headway_states / samples\n(SoT: spacing)", VIOLET_F, VIOLET, fs=8)
    box(ax, 4, 62, 26, 7, "commands table\n(SoT: interventions)", VIOLET_F, VIOLET, fs=8)
    arrow(ax, 83, 78, 83, 69); arrow(ax, 70, 65.5, 63, 65.5); arrow(ax, 37, 65.5, 30, 65.5)
    box(ax, 55, 46, 40, 7, "REST reads (web ← control-service)\nZod-validated at call site", TEAL_F, TEAL, fs=8)
    box(ax, 5, 46, 40, 7, "signed webhook (web ← control-service)\nops_control_service_webhook_events", TEAL_F, TEAL, fs=8)
    arrow(ax, 75, 62, 75, 53); arrow(ax, 20, 62, 25, 53)
    box(ax, 30, 30, 40, 7, "Web: transient view state only\n(Zustand useCopilotStore, per-tab)", BLUE_F, BLUE, bold=True, fs=8)
    arrow(ax, 75, 46, 55, 37); arrow(ax, 25, 46, 45, 37)
    box(ax, 30, 16, 40, 7, "Browser render (React) — no SoT here", GREEN_F, GREEN, fs=8)
    arrow(ax, 50, 30, 50, 23)
    ax.text(50, 9, "Rule: the web app never holds write credentials to the control-service datastore.",
            ha="center", fontsize=8.5, color=RED, style="italic")
    save(fig, "12-state-lifecycle.png")


# 13 — AI / algorithm pipeline
def d13():
    fig, ax = new(11, 7.5)
    title(ax, "Figure 13 — Algorithm & AI Pipeline", "Deterministic control core + LLM copilot (advisory)")
    box(ax, 4, 80, 92, 6, "INPUT: live GPS fixes (position, speed, heading, timestamp)", AMBER_F, AMBER, bold=True, fs=8.5)
    stages = [
        ("Map matching\n(project to route\nshape candidates)", VIOLET_F, VIOLET),
        ("Direction confidence\nscoring + selection", VIOLET_F, VIOLET),
        ("Kalman filter\n[s, v] smoothing\n(constant velocity)", BLUE_F, BLUE),
        ("Stop-state classify\n+ leader/follower\nordering", BLUE_F, BLUE),
    ]
    x = 4
    for i, (t, fc, ec) in enumerate(stages):
        box(ax, x, 66, 21, 10, t, fc, ec, fs=7.6)
        if i < 3:
            arrow(ax, x + 21, 71, x + 23, 71)
        x += 23
    arrow(ax, 50, 80, 50, 76)
    box(ax, 4, 52, 44, 8, "Headway metrics\ngap/speed → hFwd/hBwd · CV · EWT", TEAL_F, TEAL, fs=8, bold=True)
    box(ax, 52, 52, 44, 8, "Reactive bunching rule\n(threshold ratio × required samples)", RED_F, RED, fs=8, bold=True)
    arrow(ax, 26, 66, 26, 60); arrow(ax, 48, 56, 52, 56)
    box(ax, 4, 38, 92, 8, "MPC decision engine: terminal dispatch → two-way hold → self-equalizing → hard safety filter\n→ occupancy-weighted re-score (advisory)   [deterministic control laws, config-driven]", GREEN_F, GREEN, bold=True, fs=8)
    arrow(ax, 26, 52, 26, 46); arrow(ax, 74, 52, 74, 46)
    box(ax, 4, 24, 44, 8, "OUTPUT: hold/skip recommendation\n(seconds) → human approval → driver", GREEN_F, GREEN, fs=8)
    arrow(ax, 26, 38, 26, 32)
    box(ax, 52, 24, 44, 8, "LLM Copilot (Anthropic, web app)\ngrounded Q&A + shift reports — NOT in control loop", SLATE_F, SLATE, fs=7.8)
    ax.text(74, 20, "Advisory only · grounded on live figures · rate-limited", ha="center", fontsize=7.3, color=MUTED, style="italic")
    box(ax, 4, 8, 92, 6, "No neural network / trained ML model in the control path — every recommendation is a documented closed-form control law.",
        RED_F, RED, fs=8, bold=True)
    arrow(ax, 26, 24, 26, 14)
    save(fig, "13-ai-pipeline.png")


for fn in [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13]:
    fn()
print("\nAll diagrams written to", OUT)
