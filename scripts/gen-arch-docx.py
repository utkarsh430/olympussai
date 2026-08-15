#!/usr/bin/env python3
"""
Build the Principal-Engineer technical architecture DOCX for Olympuss AI / UPSRTC.

Everything in this document is derived from the actual repository (file paths and
function names are cited inline). Diagrams are rendered separately by
scripts/gen-arch-diagrams.py into docs/technical-architecture/diagrams/.

Run:  python3 scripts/gen-arch-docx.py
Out:  docs/technical-architecture/Olympuss_AI_UPSRTC_Technical_Architecture_and_Code_Walkthrough.docx
"""
import os
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIAGRAMS = os.path.join(ROOT, "docs", "technical-architecture", "diagrams")
OUT = os.path.join(ROOT, "docs", "technical-architecture",
                   "Olympuss_AI_UPSRTC_Technical_Architecture_and_Code_Walkthrough.docx")

INK = RGBColor(0x0F, 0x17, 0x2A)
BLUE = RGBColor(0x1D, 0x4E, 0xD8)
TEAL = RGBColor(0x0F, 0x76, 0x6E)
MUTED = RGBColor(0x47, 0x55, 0x69)
RED = RGBColor(0xB9, 0x1C, 0x1C)
AMBER = RGBColor(0xB4, 0x53, 0x09)

doc = Document()

# ---- base styles ----------------------------------------------------------
normal = doc.styles["Normal"]
normal.font.name = "Calibri"
normal.font.size = Pt(10.5)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.12

for lvl, sz, col in [("Heading 1", 17, BLUE), ("Heading 2", 13.5, INK), ("Heading 3", 11.5, TEAL)]:
    st = doc.styles[lvl]
    st.font.name = "Calibri"
    st.font.size = Pt(sz)
    st.font.color.rgb = col
    st.font.bold = True

from docx.enum.style import WD_STYLE_TYPE
mono = doc.styles.add_style("Mono", WD_STYLE_TYPE.CHARACTER)
mono.font.name = "Consolas"
mono.font.size = Pt(9.5)
mono.font.color.rgb = RGBColor(0x0B, 0x3D, 0x2E)


def set_cell_bg(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def code(runs_paragraph, text):
    """Add a monospace run."""
    r = runs_paragraph.add_run(text)
    r.style = doc.styles["Mono"]
    return r


def para(text="", size=None, bold=False, italic=False, color=None, after=6, before=0, align=None):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.space_before = Pt(before)
    if text:
        r = p.add_run(text)
        r.bold = bold
        r.italic = italic
        if size:
            r.font.size = Pt(size)
        if color:
            r.font.color.rgb = color
    return p


def rich(segments, after=6, before=0, style=None):
    """segments: list of (text, kind) where kind in {'', 'b', 'i', 'code'}."""
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.space_before = Pt(before)
    for text, kind in segments:
        if kind == "code":
            code(p, text)
        else:
            r = p.add_run(text)
            r.bold = kind == "b"
            r.italic = kind == "i"
    return p


def bullet(segments, level=0):
    style = "List Bullet" if level == 0 else "List Bullet 2"
    return rich(segments, after=3, style=style)


def numbered(segments):
    return rich(segments, after=3, style="List Number")


def h1(text):
    doc.add_heading(text, level=1)


def h2(text):
    doc.add_heading(text, level=2)


def h3(text):
    doc.add_heading(text, level=3)


def callout(label, text, fill="FEF3C7", edge_label_color=AMBER):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.style = "Table Grid"
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = tbl.cell(0, 0)
    set_cell_bg(cell, fill)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(label + "  ")
    r.bold = True
    r.font.color.rgb = edge_label_color
    r.font.size = Pt(9.5)
    r2 = p.add_run(text)
    r2.font.size = Pt(9.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return tbl


def table(headers, rows, widths=None, header_fill="1D4ED8", fs=8.6, caption=None):
    if caption:
        cap = doc.add_paragraph()
        cap.paragraph_format.space_after = Pt(2)
        r = cap.add_run(caption)
        r.italic = True
        r.font.size = Pt(9)
        r.font.color.rgb = MUTED
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    t.allow_autofit = True
    hdr = t.rows[0].cells
    for i, htext in enumerate(headers):
        set_cell_bg(hdr[i], header_fill)
        p = hdr[i].paragraphs[0]
        rr = p.add_run(htext)
        rr.bold = True
        rr.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        rr.font.size = Pt(fs)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            # Support inline code via {{...}} markers
            parts = val.split("`")
            for j, seg in enumerate(parts):
                if seg == "":
                    continue
                if j % 2 == 1:
                    code(p, seg)
                else:
                    rr = p.add_run(seg)
                    rr.font.size = Pt(fs)
            if i % 2 == 1:
                set_cell_bg(cells[i], "F1F5F9")
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def figure(filename, caption, width=6.4):
    path = os.path.join(DIAGRAMS, filename)
    if not os.path.exists(path):
        para(f"[missing diagram: {filename}]", color=RED)
        return
    doc.add_picture(path, width=Inches(width))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(10)
    r = cap.add_run(caption)
    r.italic = True
    r.font.size = Pt(9)
    r.font.color.rgb = MUTED


def page_break():
    doc.add_page_break()


# ---- header / footer with page numbers ------------------------------------
def add_page_number(paragraph):
    run = paragraph.add_run()
    fldChar1 = OxmlElement("w:fldChar"); fldChar1.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = "PAGE"
    fldChar2 = OxmlElement("w:fldChar"); fldChar2.set(qn("w:fldCharType"), "end")
    run._r.append(fldChar1); run._r.append(instr); run._r.append(fldChar2)


# =====================================================================================
# COVER PAGE
# =====================================================================================
for _ in range(3):
    doc.add_paragraph()
para("OLYMPUSS AI", size=13, bold=True, color=TEAL, align=WD_ALIGN_PARAGRAPH.CENTER, after=2)
para("UPSRTC — Uttar Pradesh State Road Transport Corporation",
     size=11, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, after=30)
para("Technical Architecture &\nCode Walkthrough", size=30, bold=True, color=INK,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=6)
para("Real-time bus operations · GPS state estimation · bunching detection,\n"
     "prediction & intervention · dashboards · APIs · maps · authentication",
     size=11.5, italic=True, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, after=40)
para("Complete reverse-engineering of the repository — evidence-based, "
     "implementation-level, prepared for a Principal Software Engineer review.",
     size=10.5, color=INK, align=WD_ALIGN_PARAGRAPH.CENTER, after=6)
para("Repository branch: integration/full-system", size=9.5, color=MUTED,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=2)
para("Every architectural claim cites the source file it is drawn from. "
     "No secret values are printed.", size=9, italic=True, color=MUTED,
     align=WD_ALIGN_PARAGRAPH.CENTER)
page_break()

# =====================================================================================
# TABLE OF CONTENTS (field — updates in Word via F9 / right-click > Update Field)
# =====================================================================================
h1("Table of Contents")
para("In Microsoft Word, right-click the table below and choose "
     "“Update Field” (or select it and press F9) to populate page numbers.",
     size=9, italic=True, color=MUTED)
toc_p = doc.add_paragraph()
run = toc_p.add_run()
fld_begin = OxmlElement("w:fldChar"); fld_begin.set(qn("w:fldCharType"), "begin")
instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve")
instr.text = r'TOC \o "1-2" \h \z \u'
fld_sep = OxmlElement("w:fldChar"); fld_sep.set(qn("w:fldCharType"), "separate")
fld_text = OxmlElement("w:t"); fld_text.text = "Right-click and Update Field to build the table of contents."
fld_end = OxmlElement("w:fldChar"); fld_end.set(qn("w:fldCharType"), "end")
run._r.append(fld_begin); run._r.append(instr); run._r.append(fld_sep)
run._r.append(fld_text); run._r.append(fld_end)
page_break()

# Footer with page number (applies to the section)
section = doc.sections[0]
# Widen the usable content column so wide tables never overflow the page.
section.left_margin = Inches(0.8)
section.right_margin = Inches(0.8)
section.top_margin = Inches(0.85)
section.bottom_margin = Inches(0.8)
footer = section.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
fp.add_run("Olympuss AI / UPSRTC — Technical Architecture & Code Walkthrough   ·   Page ").font.size = Pt(8)
add_page_number(fp)
for r in fp.runs:
    r.font.size = Pt(8); r.font.color.rgb = MUTED
# Header
hdr = section.header
hp = hdr.paragraphs[0]
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
hr = hp.add_run("OLYMPUSS AI · UPSRTC · CONFIDENTIAL ENGINEERING DOCUMENT")
hr.font.size = Pt(7.5); hr.font.color.rgb = MUTED; hr.bold = True

# =====================================================================================
# 1. EXECUTIVE TECHNICAL SUMMARY
# =====================================================================================
h1("1. Executive Technical Summary")
para("This document is a complete, evidence-based reverse-engineering of the Olympuss AI / "
     "UPSRTC repository. It is written for a Principal Software Engineer who will ask "
     "implementation-level questions; every architectural claim is anchored to a source file.")

h3("What the repository actually contains")
para("The repository is not a single application. It is two independently deployed systems "
     "plus shared external dependencies, living in one monorepo:")
bullet([("A Next.js 15 web application", "b"),
        (" (repo root, ", ""), ("src/", "code"),
        (") — the operator-facing surface: a public Olympuss landing site, a live UPSRTC "
         "fleet dashboard, a role-based operations (“ops”) console, a client-side "
         "bus-bunching simulator, and the server-side proxy that fetches the real UPSRTC GPS feed.", "")])
bullet([("A persistent “control-service”", "b"),
        (" (", ""), ("control-service/", "code"),
        (") — an always-on Node/Express backend with its own Postgres/PostGIS datastore that "
         "does the real transport intelligence: GPS ingestion, Kalman-smoothed state "
         "estimation, leader/follower ordering, headway/EWT/CV computation, reactive bunching "
         "detection, and a Model-Predictive-Control (MPC) decision engine that recommends "
         "holds and dispatch adjustments.", "")])

h3("The single most important architectural distinction")
callout("KEY FINDING",
        "There are TWO separate “bunching” implementations, and conflating them is the "
        "most likely way to mislead a reviewer. (1) src/lib/bunching/* is a deterministic, "
        "hard-coded 4-bus CLIENT-SIDE SIMULATION for the demo page — no live data flows through "
        "it. (2) control-service/src/{state-estimation,headway,mpc}/* is the real, tested, "
        "server-side pipeline that operates on live GPS. This document keeps them rigorously "
        "separate and labels every claim PRODUCTION / PROTOTYPE / SIMULATION / PLANNED.",
        fill="FEE2E2", edge_label_color=RED)

h3("Maturity at a glance")
table(
    ["Capability", "Status", "Evidence"],
    [
        ["Live UPSRTC GPS proxy + normalization", "PRODUCTION (web)", "`src/app/api/upsrtc/live/route.ts`, `src/lib/upsrtc/normalizer.ts`"],
        ["Google Maps live fleet visualization", "PRODUCTION (web)", "`src/components/map/FleetMap.tsx`, `fleetCanvasLayer.ts`"],
        ["Enterprise + ops RBAC authentication", "PRODUCTION (web)", "`src/middleware.ts`, `src/lib/auth/rbac/*`"],
        ["State estimation (map-match + Kalman)", "PRODUCTION (control-service, tested, NOT yet wired to live ingest by default)", "`control-service/src/state-estimation/*`"],
        ["Headway/EWT/CV + reactive bunching", "PRODUCTION (control-service, tested)", "`control-service/src/headway/*`"],
        ["MPC hold/dispatch decision engine", "PRODUCTION (control-service, tested)", "`control-service/src/mpc/*`"],
        ["Occupancy-weighted predictive MPC", "PROTOTYPE (advisory only, single-step)", "`control-service/src/mpc/occupancyMpc.ts`"],
        ["Client-side bunching demo", "SIMULATION (hard-coded 4 buses)", "`src/lib/bunching/*`, `src/components/bunching/*`"],
        ["LLM control-room copilot", "PRODUCTION (web, grounded, advisory)", "`src/lib/copilot/*`, Anthropic API"],
        ["Trained neural net / ML model in control loop", "NOT PRESENT", "No model files; all control laws are closed-form"],
        ["Automated (no-human) command execution", "PLANNED / gated", "Commands require human approval + driver ack"],
    ],
    widths=[2.3, 2.1, 2.4], fs=8.3,
    caption="Table 1 — Capability maturity, derived from repository evidence."
)

h3("Headline engineering concerns (expanded in §26–27)")
bullet([("Live GPS ingestion into the control-service is gated OFF by default", "b"),
        (" (", ""), ("GPS_POLL_ENABLED=false", "code"),
        ("), and the README states the estimator is “not called yet” by the runtime by "
         "default — so the sophisticated pipeline can be dormant in a given deploy.", "")])
bullet([("The web app and control-service each maintain their own auth, cache, and rate-limit "
         "state per warm process", "b"),
        (" unless Redis is configured — correct-looking limits silently reset on serverless "
         "cold starts.", "")])
bullet([("The UPSRTC upstream is an undocumented PHP endpoint", "b"),
        (" with schema quirks (IST timestamps labelled Z, HTML content-type on JSON, "
         "double-encoded arrays) handled defensively but fragile to upstream change.", "")])
bullet([("No automated command execution", "b"),
        (" — every intervention needs a human dispatcher and a driver acknowledgement, which is "
         "a safety strength but a throughput ceiling.", "")])

page_break()

# =====================================================================================
# 2. SYSTEM PURPOSE
# =====================================================================================
h1("2. System Purpose")
para("The system exists to keep UPSRTC bus services evenly spaced. On a high-frequency route, "
     "passengers do not read a timetable; they rely on consistent headway (the time gap between "
     "consecutive buses). When one bus is delayed, it picks up the passengers that would have "
     "boarded the next bus, dwells longer, and falls further behind — while the bus behind it "
     "finds fewer passengers, speeds up, and closes the gap. Left alone this feedback loop "
     "collapses two or more buses into a “bunch,” halving effective frequency and "
     "leaving a large gap behind them.")
para("The product’s job is to (a) observe the fleet from live GPS, (b) detect and predict "
     "bunching, (c) recommend the least-disruptive intervention (usually holding a bus a few "
     "seconds at a terminal or stop), and (d) route that recommendation to a human dispatcher "
     "and then to the driver, closing the loop by re-measuring headway.")
rich([("Primary operational surfaces: ", "b"),
      ("the ", ""), ("live UPSRTC dashboard", "b"), (" (", ""),
      ("/project/upsrtc", "code"), ("), the ", ""),
      ("role-based ops console", "b"), (" (", ""), ("/ops/*", "code"),
      (" — driver, pilot-driver, dispatcher, depot, control-room, planner, admin), and the ", ""),
      ("bunching explainer/simulator", "b"), (" (", ""), ("/project/bunching", "code"), (").", "")])

# =====================================================================================
# 3. TECHNOLOGY STACK
# =====================================================================================
h1("3. Technology Stack")
para("Derived from the two package.json files, the lockfile (pnpm), and the config files.")
table(
    ["Layer", "Technology", "Where / why"],
    [
        ["Language", "TypeScript 5 (strict)", "`tsconfig.json`; both packages"],
        ["Package manager", "pnpm 10.29.3", "`package.json` packageManager, `pnpm-lock.yaml`"],
        ["Web framework", "Next.js 15.5 (App Router)", "`next.config.ts`; `src/app/*`"],
        ["UI runtime", "React 19", "`package.json`"],
        ["Web state", "Zustand 5", "`src/stores/copilotStore.ts`"],
        ["Styling", "Tailwind 3.4 + Radix UI + framer-motion + GSAP", "`tailwind.config.ts`, components"],
        ["3D / landing", "three.js 0.185 + @react-three/fiber + drei", "`src/three/*`, landing globe"],
        ["Maps", "Google Maps JS SDK (@googlemaps/js-api-loader)", "`src/lib/maps/loader.ts`, `FleetMap.tsx`"],
        ["Charts", "Recharts 2", "impact/observability dashboards"],
        ["Validation", "Zod 3 (shared contracts)", "`src/models/*`, control-service schemas"],
        ["Enterprise auth", "Supabase (@supabase/ssr, supabase-js)", "`src/lib/supabase/*`"],
        ["Ops auth", "Custom HS256 JWT via jose + bcryptjs", "`src/lib/auth/rbac/*`"],
        ["Web DB access", "pg (Postgres) + Supabase", "`src/lib/db/pool.ts`"],
        ["LLM", "Anthropic Messages API (raw fetch)", "`src/lib/copilot/anthropic.ts`"],
        ["Shared limiter/breaker store", "Upstash Redis (optional)", "`src/lib/redis/client.ts`"],
        ["Email", "Resend", "`src/lib/email/resend.ts`"],
        ["Control-service", "Node ≥20, Express 4, pino, Zod, pg (PostGIS)", "`control-service/package.json`"],
        ["Error tracking", "@sentry/node (control-service)", "`control-service/src/telemetry/sentry.ts`"],
        ["Testing", "Vitest (unit) + Playwright (e2e)", "`vitest.config.ts`, `playwright.config.ts`"],
        ["Web hosting", "Vercel (serverless)", "`next.config.ts` outputFileTracingRoot, CSP"],
        ["Control-service hosting", "Render (Docker, always-on)", "`control-service/README.md`, render.yaml"],
    ],
    widths=[1.4, 2.6, 2.8], fs=8.2,
    caption="Table 2 — Technology stack with source evidence."
)

page_break()

# =====================================================================================
# 4. REPOSITORY ARCHITECTURE (folder-by-folder)
# =====================================================================================
h1("4. Repository Architecture")
para("Directory tree (build artifacts, node_modules, and .next excluded). Annotations describe "
     "each directory’s architectural responsibility.")

tree = [
    ("repo root", "Next.js app + config; the control-service is a nested, separately-built package"),
    ("├─ src/app/", "App Router. Route groups: (public) landing/login, (protected) UPSRTC dashboard, (ops) RBAC console, api/ route handlers"),
    ("│  ├─ (public)/", "Marketing landing page + enterprise login"),
    ("│  ├─ (protected)/project/", "UPSRTC live dashboard (upsrtc/) and bunching simulator (bunching/)"),
    ("│  ├─ (ops)/ops/", "7-role operations console (driver…admin), each with its own layout+guard"),
    ("│  └─ api/", "Server routes: auth/, upsrtc/ (live+schedule proxy), ops/ (RBAC APIs), control-service/webhook"),
    ("├─ src/components/", "Feature UI: map/, live-fleet/, bunching/, ops/, command-center/, ai-core/, landing/, scenarios/"),
    ("├─ src/lib/", "Non-UI logic: upsrtc/ (proxy), auth/ (+rbac/), bunching/ (sim math), controlService/ (client), copilot/ (LLM), redis/, supabase/, webhooks/"),
    ("├─ src/hooks/", "React hooks: useLiveFleet (polling), useSchedule, useAlertStream, …"),
    ("├─ src/stores/", "Zustand store (copilotStore) — the dashboard’s client state"),
    ("├─ src/models/", "Zod contracts: canonical.ts (bus/feed), control.ts (control-service API), copilot.ts"),
    ("├─ src/three/", "three.js landing globe + scene"),
    ("├─ src/fixtures/", "Bundled UPSRTC sample payloads (offline demo only)"),
    ("├─ src/tests/", "Vitest unit tests (bunching, normalizer, rbac, control, copilot, …)"),
    ("├─ src/middleware.ts", "Edge middleware — first-line auth gate for protected/ops/api surfaces"),
    ("├─ control-service/", "Independently deployed backend (own package.json, tsconfig, Dockerfile, DB)"),
    ("│  ├─ src/ingestion/", "UPSRTC upstream client + normalizer + position pipeline"),
    ("│  ├─ src/state-estimation/", "map matching, Kalman filter, confidence, stop-state, leader/follower ordering"),
    ("│  ├─ src/headway/", "pair headways, EWT/CV aggregate, reactive bunching rule, service orchestration"),
    ("│  ├─ src/mpc/", "terminal dispatch, two-way hold, self-equalizing, safety filter, occupancy MPC, solver"),
    ("│  ├─ src/scheduler/", "cron-like jobs: gpsPoll, headwayCompute, geometryRefresh, commandTtlSweep"),
    ("│  ├─ src/routes/", "Express routers: commands, headway, mpc, positions, pilot, vehicleStates, health"),
    ("│  ├─ src/simulation/", "regression/replay simulator (demandBurst, gpsDropout, missedTrip, nonCompliance)"),
    ("│  ├─ src/seed/", "network geometry + timetable seeding/harvest/recalibration"),
    ("│  └─ src/webhooks/", "outbound signed webhook dispatch to the web app"),
    ("├─ db/  &  control-service/db/", "SQL migrations for the two isolated datastores"),
    ("├─ docs/", "Blueprint (.md/.docx), integration + deployment contracts, API_DISCOVERY, roadmap"),
    ("├─ scripts/", "Admin/ops scripts: create-project-user, seed/migrate ops, inspect-upsrtc-api"),
    ("└─ public/", "Static brand assets + pilot-driver PWA assets"),
]
t = doc.add_table(rows=0, cols=2)
t.style = "Table Grid"
for pathname, desc in tree:
    cells = t.add_row().cells
    p = cells[0].paragraphs[0]; code(p, pathname)
    p2 = cells[1].paragraphs[0]; r = p2.add_run(desc); r.font.size = Pt(8.4)
    cells[0].width = Inches(2.5); cells[1].width = Inches(4.3)
doc.add_paragraph().paragraph_format.space_after = Pt(2)

page_break()

# =====================================================================================
# 5. HIGH-LEVEL SYSTEM ARCHITECTURE
# =====================================================================================
h1("5. High-Level System Architecture")
figure("01-system-architecture.png", "Figure 1 — Overall system architecture.")
para("The load-bearing decision is the boundary between the two systems. Per "
     "control-service/README.md and docs/CONTROL_SERVICE_INTEGRATION.md, the web app never "
     "connects to the control-service database and never holds write credentials to it. The "
     "two communicate only over REST (web → control-service, Bearer service token) and signed "
     "webhooks (control-service → web, HMAC-SHA256). A shared database was explicitly considered "
     "and rejected.")
rich([("Both systems independently consume the same undocumented UPSRTC upstream: the web app "
       "proxies it for display (", ""),
      ("src/lib/upsrtc/client.ts", "code"),
      ("), and the control-service polls it for ingestion (", ""),
      ("control-service/src/scheduler/gpsPoll.ts", "code"),
      ("). They deliberately do NOT share the normalizer, but they DO mirror the same IST "
       "timestamp correction — a documented “sibling implementation” pair that must be changed "
       "together.", "")])

# =====================================================================================
# 6. APPLICATION STARTUP FLOW
# =====================================================================================
h1("6. Application Startup Flow")
figure("02-request-flow.png", "Figure 2 — From npm run dev to a rendered, authenticated dashboard.")
h3("Web app: `pnpm dev` → browser")
numbered([("`next dev` (package.json scripts) compiles the App Router and starts the Node dev server.", "")])
numbered([("A request to a protected path (e.g. ", ""), ("/project/upsrtc", "code"),
          (") hits ", ""), ("src/middleware.ts", "code"),
          (" first. The matcher is a deliberate allowlist — ", ""),
          ("/project/*, /api/upsrtc/*, /ops/*, /api/ops/*", "code"), (" — never a broad ", ""),
          ("/api/*", "code"), (", so the machine webhook stays exempt.", "")])
numbered([("For the Supabase surface, middleware calls ", ""), ("getMiddlewareUser()", "code"),
          ("; no user → redirect to ", ""), ("/login?next=…", "code"),
          (" (pages) or 401 JSON (APIs).", "")])
numbered([("The ", ""), ("(protected)", "code"),
          (" layout re-verifies the session independently — defence in depth; middleware is "
           "never the only check.", "")])
numbered([("The server renders the ", ""), ("CommandCenter", "code"),
          (" shell (React Server Component boundary), then the client mounts and ", ""),
          ("useLiveFleet()", "code"), (" starts a 15s poll of ", ""), ("/api/upsrtc/live", "code"), (".", "")])
numbered([("The route handler authorizes, serves from a 15s ", ""), ("TtlCache", "code"),
          (" or fetches upstream, normalizes to canonical buses, and returns them; the store "
           "updates and ", ""), ("FleetMap", "code"), (" draws ~9.5k vehicles on one canvas.", "")])
h3("Control-service: `pnpm start` / dev")
rich([("Entry point ", ""), ("control-service/src/index.ts", "code"),
      (" boots the process; ", ""), ("app.ts", "code"),
      (" assembles the Express app (health routes unauthenticated, then ", ""),
      ("requireServiceToken", "code"),
      (" on everything else), rehydrates in-memory state from Postgres, registers scheduler "
       "jobs (", ""), ("scheduler/index.ts", "code"),
      ("), and exposes ", ""), ("/healthz", "code"), (" + ", ""), ("/readyz", "code"),
      (". ", ""), ("/readyz", "code"),
      (" returns 503 until at least one active route-direction has a seeded shape "
       "(REQUIRE_SEEDED_NETWORK).", "")])

page_break()

# =====================================================================================
# 7. FRONTEND ARCHITECTURE
# =====================================================================================
h1("7. Frontend Architecture")
figure("03-frontend-hierarchy.png", "Figure 3 — UPSRTC dashboard component hierarchy.")
rich([("The UPSRTC dashboard page is a one-line server component (", ""),
      ("src/app/(protected)/project/upsrtc/page.tsx", "code"),
      (") that renders ", ""), ("<CommandCenter/>", "code"),
      (". CommandCenter (", ""), ("src/components/command-center/CommandCenter.tsx", "code"),
      (") is the client root: it wires the three data hooks (", ""),
      ("useLiveFleet, useSchedule, useAlertStream", "code"),
      (") and composes the map, fleet panel, alert centre, copilot panel, bus drawer, scenario "
       "stage, and the presentation/diagnostics overlays.", "")])

h3("State management")
rich([("A single Zustand store — ", ""), ("src/stores/copilotStore.ts", "code"),
      (" — is the dashboard’s source of truth for view state: ", ""),
      ("buses, feedMeta, selectedBusId, schedule, filters, alerts, activeScenario", "code"),
      (", and every UI-drawer boolean. Selectors like ", ""), ("useSelectedBus()", "code"),
      (" derive the selected bus from ", ""), ("buses + selectedBusId", "code"),
      (", so a position update never goes stale against a cached copy.", "")])
para("Hooks encapsulate side effects and keep components declarative:")
table(
    ["Hook", "File", "Responsibility"],
    [
        ["useLiveFleet", "`src/hooks/useLiveFleet.ts`", "15s poll of /api/upsrtc/live; AbortController per tick; writes store"],
        ["useSchedule", "`src/hooks/useSchedule.ts`", "Loads a selected bus’s schedule via /api/upsrtc/schedule"],
        ["useAlertStream", "`src/hooks/useAlertStream.ts`", "Derives predictive alerts anchored to real vehicles"],
        ["useFleetDistribution", "`src/hooks/useFleetDistribution.ts`", "Aggregates fleet by depot/route/quality for panels"],
        ["useSimulationPlayer", "`src/components/bunching/useSimulationPlayer.ts`", "Drives the client-side bunching simulation playback"],
    ],
    widths=[1.5, 2.6, 2.7], fs=8.4,
    caption="Table 3 — Key frontend hooks."
)
h3("Rendering model")
bullet([("Server components", "b"),
        (" render the shells and layouts (auth checks run server-side).", "")])
bullet([("Client components", "b"),
        (" (", ""), ("'use client'", "code"),
        (") own anything interactive or stateful: the map, panels, store, three.js.", "")])
bullet([("The public landing page", "b"),
        (" (", ""), ("src/app/(public)/page.tsx", "code"),
        (" + ", ""), ("src/three/*", "code"),
        (") is a heavier three.js/@react-three/fiber experience, isolated in its own route "
         "group with its own fonts.", "")])

page_break()

# =====================================================================================
# 8. BACKEND / API ARCHITECTURE
# =====================================================================================
h1("8. Backend / API Architecture")
figure("04-backend-api.png", "Figure 4 — Backend and API architecture across three auth domains.")
para("The web app’s API is split into three authentication domains, enforced in "
     "src/middleware.ts and again in each handler:")
bullet([("Supabase-authed", "b"), (": ", ""), ("/api/auth/*", "code"), (", ", ""),
        ("/api/upsrtc/*", "code"), (" — enterprise session cookie.", "")])
bullet([("Ops RBAC", "b"), (": ", ""), ("/api/ops/*", "code"),
        (" — custom HS256 JWT cookie, role derived from the URL segment.", "")])
bullet([("Machine-to-machine", "b"), (": ", ""), ("/api/control-service/webhook", "code"),
        (" — HMAC signature is the entire authentication; deliberately exempt from both "
         "session gates.", "")])
para("The control-service is a classic Express app: health routes are public for Render’s "
     "checker, and every /v1/* route sits behind requireServiceToken (control-service/src/app.ts). "
     "A full API inventory is in §29.")

# =====================================================================================
# 9. DATA SOURCES
# =====================================================================================
h1("9. Data Sources")
table(
    ["Source", "Type", "Consumed by", "Notes"],
    [
        ["UPSRTC getGpsLiveData.php", "Live GPS (undocumented PHP)", "web proxy + control-service poller", "~9,261 rows / ~11.7 MB; ~665 status='Live'"],
        ["UPSRTC getScheduledBusInfo.php", "Per-vehicle schedule", "web /api/upsrtc/schedule", "Returns bare string when unassigned; multi-trip quirks"],
        ["Supabase Postgres", "Auth users + ops RBAC + logs", "web", "No self-service signup"],
        ["control-service Postgres/PostGIS", "vehicle_states, headway, commands, policies, incidents", "control-service", "Isolated; web reads only via REST"],
        ["Bundled fixtures", "Sample payloads", "web (offline demo only)", "`src/fixtures/upsrtc-*-sample.json`; opt-in"],
        ["Anthropic API", "LLM completions", "web copilot", "Grounded, advisory only"],
    ],
    widths=[2.0, 1.7, 1.7, 1.9], fs=8.2,
    caption="Table 4 — Operational data sources."
)
callout("SIMULATION",
        "Traffic overlays, scenario stages, and the client-side bunching page are generated "
        "locally (src/lib/demo-scenarios/*, src/lib/simulation/*, src/lib/bunching/*). "
        "FleetMap.tsx explicitly does NOT enable Google’s TrafficLayer — “all traffic here is "
        "simulated.” These are presentation constructs, not live feeds.",
        fill="FEF3C7", edge_label_color=AMBER)

page_break()

# =====================================================================================
# 10. UPSRTC LIVE GPS DATA FLOW
# =====================================================================================
h1("10. UPSRTC Live GPS Data Flow")
figure("05-gps-data-flow.png", "Figure 5 — Two independent consumers of the same PHP feed.")

h3("Web proxy path (for display)")
rich([("Browser → ", ""), ("useLiveFleet", "code"), (" (", ""),
      ("src/hooks/useLiveFleet.ts", "code"), (", 15s) → ", ""),
      ("GET /api/upsrtc/live", "code"), (" (", ""),
      ("src/app/api/upsrtc/live/route.ts", "code"), (") → ", ""),
      ("fetchUpstream()", "code"), (" (", ""), ("src/lib/upsrtc/client.ts", "code"),
      (", 10s timeout, HTML-guard, tolerant JSON parse) → ", ""),
      ("normalizeLivePayload()", "code"), (" (", ""),
      ("src/lib/upsrtc/normalizer.ts", "code"), (") → ", ""), ("TtlCache", "code"),
      (" (15s) → Zustand → ", ""), ("FleetMap", "code"), (" canvas.", "")])
para("Critically, the browser NEVER touches the UPSRTC endpoint directly — the upstream URL "
     "and any headers live server-side only. The upstream URL defaults are in client.ts and "
     "can be overridden by UPSRTC_LIVE_URL / UPSRTC_SCHEDULE_URL env vars.")

h3("The degradation ladder (a deliberate design)")
para("On a failed refresh, the route returns the honest state — never demo buses — in this order "
     "(src/app/api/upsrtc/live/route.ts):")
numbered([("`source: 'live'` — fresh upstream success (or a genuine empty “no vehicles on road”).", "")])
numbered([("`source: 'cache'` (fresh) — within the 15s TTL window.", "")])
numbered([("`source: 'cache'` (stale) — last-known-good real data after a failed refresh.", "")])
numbered([("`source: 'unavailable'` — ZERO rows, explicitly flagged, when no cache is held.", "")])
numbered([("`source: 'fixture'` — bundled sample data, ONLY when `ALLOW_FIXTURE_FALLBACK` or "
           "`NEXT_PUBLIC_DEMO_MODE` is set (off in real deploys).", "")])
callout("ARCHITECTURAL DECISION",
        "Recent commit “Stop substituting demo data for live data on upstream failure” makes "
        "the honest-empty state the default. Rationale (from the code comments): filling a "
        "dispatcher’s fleet table with demo buses that do not exist during an outage is worse "
        "than showing zero. This is a mature, safety-first choice worth calling out to the "
        "reviewer.", fill="DCFCE7", edge_label_color=TEAL)

h3("Upstream schema quirks the normalizer survives")
bullet([("IST-as-Z timestamps", "b"),
        (": the feed stamps IST wall-clock time and labels it ", ""), ("Z", "code"),
        (", putting every fix ~5.5h in the future. ", ""), ("parseUpstreamInstant()", "code"),
        (" detects a future value and shifts it back one IST offset; a value still in the "
         "future is a broken unit clock and is dropped (null), failing safe to ", ""),
        ("stale", "code"), (".", "")])
bullet([("Alias tolerance", "b"),
        (": ~12 aliases for registration, 6 for latitude, 8 for longitude, etc., so an "
         "upstream rename does not black out the control room.", "")])
bullet([("Coordinate gate", "b"), (": ", ""), ("isValidCoordinate()", "code"),
        (" rejects out-of-range and null-island (0,0) “no-fix” sentinels.", "")])
bullet([("Duplicate merge", "b"),
        (": records are de-duplicated by registration, keeping the most recent VALID timestamp "
         "(a broken-clock record sorts to −∞ and can never win).", "")])
bullet([("Content-type lie", "b"),
        (": the endpoint advertises ", ""), ("text/html", "code"),
        (" while returning JSON, and sometimes double-encodes the array as a JSON string; ", ""),
        ("extractArray()", "code"), (" unwraps all observed shapes.", "")])

h3("Control-service ingestion path (for computation)")
rich([("Independently, ", ""), ("control-service/src/scheduler/gpsPoll.ts", "code"),
      (" polls every 30s (gated by ", ""), ("GPS_POLL_ENABLED", "code"),
      (", default false so exactly one instance polls), filters to ", ""),
      ("status='Live'", "code"), (" (~665 of ~9,261 — ingesting parked buses would 9× the cost "
       "and corrupt map-matching to ", ""), ("off_route", "code"),
      ("), drops stale fixes (>300s), and calls the shared ", ""),
      ("ingestPositionEvents()", "code"), (" pipeline with per-event failure isolation.", "")])

page_break()

# =====================================================================================
# 11. GOOGLE MAPS / MAP ARCHITECTURE
# =====================================================================================
h1("11. Google Maps Architecture")
figure("09-maps-update.png", "Figure 9 — Map update flow.")
rich([("The map is owned by ", ""), ("src/components/map/FleetMap.tsx", "code"),
      (". The SDK loads via ", ""), ("getMapsLoader()", "code"), (" (", ""),
      ("src/lib/maps/loader.ts", "code"), (") using ", ""),
      ("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "code"),
      (". The map builds once (empty dependency array) centred on Uttar Pradesh (", ""),
      ("DEFAULT_MAP_CENTER = {lat:26.85, lng:80.95}", "code"), (", zoom 7).", "")])

h3("Why a canvas overlay, not markers")
rich([("The single most important performance decision on the frontend: the feed carries ", ""),
      ("~9,500 vehicles", "b"),
      (". One ", ""), ("google.maps.Marker", "code"),
      (" per bus (plus MarkerClusterer) was measured at ", ""),
      ("5.1 seconds of main-thread blocking", "b"),
      (" across a few zoom steps. Instead, ", ""),
      ("src/components/map/fleetCanvasLayer.ts", "code"),
      (" draws every vehicle into ONE canvas overlay: chevrons accumulate into one Path2D per "
       "colour and fill in a single call, and positions use local Mercator maths rather than "
       "~9.5k round-trips through the Maps projection API. Redraw is O(visible) on a "
       "requestAnimationFrame, so pan/zoom stays on the compositor.", "")])

h3("Marker → data lifecycle")
bullet([("Data → layer", "b"), (": ", ""), ("useEffect([buses])", "code"),
        (" calls ", ""), ("layer.setBuses(buses)", "code"),
        (" — an O(1) array handoff; the redraw it schedules is O(visible).", "")])
bullet([("Colour = data quality", "b"),
        (": green (good), amber (degraded), red (stale) from ", ""), ("classifyDataQuality()", "code"),
        (" age buckets (≤5 min / ≤30 min / older).", "")])
bullet([("Selection", "b"),
        (": clicking a chevron sets ", ""), ("selectedBusId", "code"),
        ("; the camera fly-to is keyed on id alone so the 15s poll never yanks the camera back.", "")])
bullet([("Invalid coordinates", "b"),
        (" are already filtered out upstream in the normalizer, so the layer never renders a "
         "bus at null-island.", "")])
h3("Failure handling")
rich([("If ", ""), ("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "code"),
      (" is missing or the SDK fails to load, ", ""), ("FleetMap", "code"),
      (" renders ", ""), ("MapFallback", "code"),
      (" with a retry, rather than crashing the dashboard. A Maps auth failure is also caught "
       "via ", ""), ("src/lib/maps/authFailure.ts", "code"), (".", "")])

page_break()

# =====================================================================================
# 12. BUS BUNCHING SYSTEM (dedicated deep dive)
# =====================================================================================
h1("12. Bus Bunching System")
callout("READ THIS FIRST",
        "The repository contains TWO bunching implementations. Section 12.1 is the real "
        "server-side pipeline (control-service). Section 12.2 is the client-side demo "
        "simulation (web). They share terminology (headway, hold) but no code and no data.",
        fill="FEE2E2", edge_label_color=RED)

h2("12.1 Production pipeline — control-service (live data)")
figure("06-bunching-detection.png", "Figure 6 — Reactive bunching detection flow.")

h3("How buses are represented")
rich([("A live GPS fix becomes a ", ""), ("PositionEvent", "code"),
      (" (vehicleId, lat, lon, speed, heading, observedAt). The registration number IS the "
       "vehicle id. The estimator turns it into a ", ""), ("VehicleStateEstimate", "code"),
      (" with a route-relative ", ""), ("distanceAlongRouteMeters", "code"),
      (", smoothed speed, confidence, and stop-state (", ""),
      ("control-service/src/state-estimation/estimator.ts", "code"), (").", "")])

h3("How positions are obtained and cleaned")
numbered([("Map matching", "b"), (" (", ""), ("mapMatching.ts", "code"),
          ("): the raw lat/lon is projected onto candidate route-direction shapes.", "")])
numbered([("Direction confidence", "b"), (" (", ""), ("confidence.ts", "code"),
          ("): a candidate is chosen and scored; low-confidence or off-route fixes are flagged, "
           "not silently trusted.", "")])
numbered([("Kalman smoothing", "b"), (" (", ""), ("kalmanFilter.ts", "code"),
          ("): a constant-velocity filter over [distance, speed] denoises the track and "
           "estimates speed even when the fix omits it.", "")])
numbered([("Stop-state classification", "b"), (" (", ""), ("stopStateClassifier.ts", "code"),
          ("): dwelling_at_stop / in_transit / off_route / held.", "")])

h3("Ordering: who leads whom")
rich([("computeLeaderFollowerOrder()", "code"), (" (", ""),
      ("state-estimation/ordering.ts", "code"),
      (") sorts eligible vehicles by ", ""), ("distanceAlongRouteMeters", "code"),
      (" descending — rank 0 is the leader-most bus — and links each to its follower. Loop "
       "routes wrap (the furthest-along bus is “led” by the one nearest the start). ", ""),
      ("Low-confidence vehicles get rank −1 and carry no links", "b"),
      (", so a bad fix can never anchor a neighbour’s headway.", "")])

h3("Headway: time vs spatial")
rich([("computePairHeadways()", "code"), (" (", ""), ("headway/metrics.ts", "code"),
      (") computes a spatial gap first, then converts to TIME headway:", "")])
para("", after=2)
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
code(p, "gapMeters = distanceAlong(leader) − distanceAlong(follower)   (wraps at totalDistance for loops)")
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
code(p, "hFwd = gapMeters / followerSpeed      hBwd = gapMeters / leaderSpeed")
rich([("So it is ", ""), ("time headway derived from spatial gap and current speed", "b"),
      (" — the “closing” headway a reactive rule watches. Speed is floored at 1 km/h "
       "(MIN_SPEED_KMPH) to avoid divide-by-zero, and every headway is capped at 24h so a "
       "stalled bus reports a large-but-finite, JSON-safe number instead of Infinity.", "")])

h3("Detection: the reactive rule")
rich([("evaluateBunchingRule()", "code"), (" (", ""), ("headway/bunching.ts", "code"),
      (") flags an incident when a pair’s ratio ", ""),
      ("hFwd / targetHeadway", "code"),
      (" stays at or below a threshold for ", ""), ("required_samples", "code"),
      (" consecutive samples. Thresholds are ", ""), ("config, not code", "b"),
      (" — read from the route-direction’s ", ""), ("route_policies", "code"), (" row:", "")])
table(
    ["Condition (all over required_samples consecutive samples)", "Result"],
    [
        ["ratio ≤ bunched_threshold_ratio (e.g. 0.25 → ≤25% of target)", "severity = 'bunched'"],
        ["ratio ≤ warning_threshold_ratio (e.g. 0.5 → ≤50% of target)", "severity = 'warning'"],
        ["ratio > warning for the whole window while an incident is open", "recovered = true"],
    ],
    widths=[4.4, 1.8], fs=8.4,
    caption="Table 5 — Reactive bunching classification (config-driven)."
)
callout("PREDICTION — honest labelling",
        "The SHIPPED detection is REACTIVE (it fires after the gap has been short for N "
        "samples). The blueprint describes a predictive tier, and the occupancy-weighted MPC "
        "(§12.1 below, occupancyMpc.ts) projects one step forward, but there is no multi-step "
        "forecast or trained predictive model in the control loop today. Do not present the "
        "reactive rule as prediction.",
        fill="FEF3C7", edge_label_color=AMBER)

h3("Intervention: the MPC decision engine")
figure("07-intervention-recovery.png", "Figure 7 — Intervention / recovery loop.")
rich([("solve()", "code"), (" (", ""), ("control-service/src/mpc/solver.ts", "code"),
      (") runs one decision cycle for a route-direction, trying control levers in priority order "
       "and applying a hard safety filter:", "")])
numbered([("Terminal dispatch", "b"), (" (", ""), ("terminalDispatch.ts", "code"),
          (") — the default first line: hold a bus dwelling at the origin until it has the "
           "target gap to the bus that already left. Least disruptive.", "")])
numbered([("Two-way holding", "b"), (" (", ""), ("twoWayHold.ts", "code"),
          (") — mid-route hold using both the gap ahead and behind, so the controller doesn’t "
           "export the problem downstream.", "")])
numbered([("Self-equalizing fallback", "b"), (" (", ""), ("selfEqualizing.ts", "code"),
          (") — used only where two-way’s inputs (Kf/Kb or hBwd) are unavailable.", "")])
numbered([("Hard safety filter", "b"), (" (", ""), ("safety.ts", "code"),
          (") — rejects candidates on stale state, max-hold breach, or a conflicting active "
           "command; rejections are logged AND returned for explainability.", "")])
numbered([("Occupancy-weighted MPC re-score", "b"), (" (", ""), ("occupancyMpc.ts", "code"),
          (") — advisory only, always labelled PREDICTIVE, never the source of the automatic "
           "selection.", "")])
rich([("The selected action is the lowest-cost safe candidate (terminal dispatch wins ties). "
       "It is NOT executed automatically — it becomes a recommendation a human dispatcher "
       "issues as a ", ""), ("command", "code"),
      (", which a driver then acknowledges (accept / unable / unsafe).", "")])

h3("Command vocabulary & lifecycle")
rich([("From ", ""), ("src/models/control.ts", "code"), (", the 9 action types are: ", ""),
      ("terminal_dispatch_hold, two_way_hold, self_equalizing_hold, speed_guidance, "
       "stop_skip, short_turn, deadhead, boarding_limit, standby_injection", "code"),
      (". Command status flows through: ", ""),
      ("proposed → awaiting_approval → authorized → delivered → acknowledged → executing → "
       "completed", "code"), (" (or expired / cancelled / failed).", "")])

h2("12.2 Client-side simulator — web demo (NOT live)")
callout("SIMULATION / HARD-CODED",
        "src/lib/bunching/* and src/components/bunching/* are a self-contained demonstration "
        "with exactly 4 buses (A, B, C, D) and hard-coded parameters in config.ts. No GPS, no "
        "control-service, no network. It exists to explain the concept on /project/bunching.",
        fill="FEE2E2", edge_label_color=RED)
rich([("The engine is ", ""), ("src/lib/bunching/math.ts", "code"),
      (". Its comment is explicit: “Every number the page displays comes from a function in "
       "this module.” Key demo constants (", ""), ("config.ts", "code"), ("): ", ""),
      ("TARGET_HEADWAY_MINUTES = 10", "code"), (", ", ""),
      ("HEADWAY_FEEDBACK_GAIN = 0.35", "code"), (", ", ""),
      ("CONTROL_GAIN = 0.55", "code"), (", ", ""), ("MAX_HOLD_MINUTES = 5", "code"),
      (". These are demonstration parameters, explicitly “not UPSRTC operating standards.”", "")])
para("It faithfully models the mechanism (dwell-time feedback → self-amplifying bunch, a "
     "no-overtaking physical floor, and a coordinated controller that recovers headway "
     "progressively) — useful pedagogy, but a reviewer must not mistake it for the production "
     "control system.")

page_break()

# =====================================================================================
# 13. MATHEMATICAL / ALGORITHMIC LOGIC
# =====================================================================================
h1("13. Mathematical / Algorithmic Logic")
para("Every formula below is implemented in the repository; the source file is cited. "
     "Production formulas (control-service) and simulation formulas (web) are separated.")

h2("13.1 Production formulas (control-service)")
table(
    ["Quantity", "Formula", "File", "Units"],
    [
        ["Spatial gap", "gap = s_leader − s_follower (wraps at total for loops)", "`headway/metrics.ts`", "m"],
        ["Forward headway", "hFwd = gap / max(v_follower, 1 km/h)", "`headway/metrics.ts`", "s"],
        ["Backward headway", "hBwd = gap / max(v_leader, 1 km/h)", "`headway/metrics.ts`", "s"],
        ["Deviation", "dev = hFwd − targetHeadway", "`headway/metrics.ts`", "s"],
        ["Headway CV", "CV = stddev(hFwd) / mean(hFwd)", "`headway/metrics.ts`", "—"],
        ["Excess Wait Time", "EWT = max(0, (var+mean²)/(2·mean) − target/2)", "`headway/metrics.ts`", "s"],
        ["Bunching ratio", "ratio = hFwd / targetHeadway", "`headway/bunching.ts`", "—"],
        ["Two-way hold", "hold = clamp(Kf·(H*−hFwd) − Kb·(H*−hBwd), 0, hold_max)", "`mpc/twoWayHold.ts`", "s"],
        ["Self-equalizing", "hold = clamp(k·max(0, hBwd−hFwd), 0, hold_max)", "`mpc/selfEqualizing.ts`", "s"],
        ["Terminal dispatch", "hold = clamp(H* − hFwd, 0, hold_max)", "`mpc/terminalDispatch.ts`", "s"],
        ["MPC wait cost", "waitCost = (1/H*)·predictedHFwd²/2·w_wait", "`mpc/occupancyMpc.ts`", "—"],
        ["MPC onboard cost", "onboardCost = loadFraction·hold·w_onboard", "`mpc/occupancyMpc.ts`", "—"],
    ],
    widths=[1.35, 3.05, 1.5, 0.5], fs=8.0,
    caption="Table 6 — Production control/measurement formulas."
)
h3("Kalman filter (state estimation)")
rich([("kalmanFilter.ts", "code"),
      (" is a constant-velocity (white-noise-acceleration) filter on state [s, v]. Predict: ", ""),
      ("s' = s + v·dt", "code"), (", ", ""), ("P' = F·P·Fᵀ + Q", "code"),
      (" with ", ""), ("F = [[1, dt],[0,1]]", "code"),
      (". Update assimilates the map-matched distance with Kalman gain ", ""),
      ("K = P₀₀/(P₀₀+R)", "code"), (", default measurement variance ", ""),
      ("R = 225 m²", "code"), (" (~15 m GPS stddev), accel variance ", ""),
      ("0.015 (m/s²)²", "code"), (". The full covariance is serialized so a restart resumes "
       "from the persisted state instead of a cold prior.", "")])
h3("Interpretation notes")
bullet([("EWT", "b"), (" follows the standard TfL Excess Wait Time methodology (actual mean wait "
         "for a Poisson-arriving passenger minus scheduled wait). It is a real transport KPI.", "")])
bullet([("The two-way law", "b"), (" is the blueprint’s Algorithm B; the backward term prevents "
         "the controller from creating a new bunch behind the one it is fixing.", "")])
bullet([("Occupancy MPC", "b"), (" currently uses a single deterministic projection (not a true "
         "expectation) and fixed weights w_wait = w_onboard = 1 — a documented prototype.", "")])

h2("13.2 Simulation formulas (web demo — SIMULATION)")
table(
    ["Quantity", "Formula", "File"],
    [
        ["Headway coupling", "H'_AB = H_AB + u_B − u_A (per pair)", "`bunching/math.ts` applyDeltas"],
        ["Dwell feedback", "δ_i = clamp(gain·(H_ahead − target), ±0.8)", "`bunching/math.ts` feedbackDeltas"],
        ["Mean abs error", "MAE = mean(|H_i − target|)", "`bunching/math.ts`"],
        ["Regularity (demo)", "100·(1 − MAE/target), floored at 0", "`bunching/math.ts` (not a UPSRTC KPI)"],
        ["Variance", "population variance of headways", "`bunching/math.ts`"],
        ["Passenger wait proxy", "Σh² / (2·Σh)", "`bunching/math.ts` passengerWaitProxy"],
        ["Recovery progress", "100·(MAE₀ − MAE)/MAE₀", "`bunching/math.ts` recoveryProgress"],
    ],
    widths=[1.5, 2.7, 2.6], fs=8.2,
    caption="Table 7 — Client-side SIMULATION formulas (demo only)."
)
para("These drive the /project/bunching explainer. They are internally consistent and "
     "pedagogically sound, but the constants are demo values and the four buses are fictitious.")

page_break()

# =====================================================================================
# 14. AI / ML ARCHITECTURE
# =====================================================================================
h1("14. AI / ML Architecture")
figure("13-ai-pipeline.png", "Figure 13 — Algorithm & AI pipeline.")
callout("HONEST CLASSIFICATION",
        "There is NO trained neural network or machine-learning model in the control loop. "
        "Every control decision is a documented closed-form control law with config-driven "
        "gains. The only LLM is an Anthropic-powered control-room copilot that is advisory and "
        "grounded — it never issues commands. The UI naming (‘Intelligence Core’, ‘AI "
        "Decision Panel’) is product language, not evidence of ML.",
        fill="FEE2E2", edge_label_color=RED)
table(
    ["Capability", "Current implementation", "Location", "Status"],
    [
        ["State estimation", "Kalman filter (constant-velocity) + map matching", "`control-service/src/state-estimation/*`", "Production"],
        ["Bunching detection", "Rule-based threshold over consecutive samples", "`control-service/src/headway/bunching.ts`", "Production"],
        ["Intervention", "Deterministic control laws (terminal/two-way/self-eq)", "`control-service/src/mpc/*`", "Production"],
        ["Predictive MPC", "Occupancy-weighted single-step re-score", "`control-service/src/mpc/occupancyMpc.ts`", "Prototype (advisory)"],
        ["Control-room copilot", "Anthropic Messages API, grounded prompts", "`src/lib/copilot/*`", "Production (advisory)"],
        ["Client bunching demo", "Deterministic feedback simulation", "`src/lib/bunching/*`", "Simulation"],
        ["Neural net / trained ML", "None", "—", "Not present"],
        ["Multi-step forecasting", "None in control loop", "—", "Planned (blueprint)"],
    ],
    widths=[1.5, 2.5, 2.0, 1.1], fs=8.0,
    caption="Table 8 — AI/algorithm inventory: what is really there."
)
h3("The LLM copilot in detail")
rich([("src/lib/copilot/anthropic.ts", "code"),
      (" is the only LLM adapter (raw fetch, no SDK). The service (", ""),
      ("src/lib/copilot/service.ts", "code"), (") builds a grounded prompt (", ""),
      ("prompts.ts", "code"), (" + ", ""), ("grounding.ts", "code"),
      (") from live figures, enforces a citation contract in the system prompt, rate-limits "
       "calls (", ""), ("rateLimit.ts", "code"), ("), and logs every interaction to ", ""),
      ("ops_copilot_interactions", "code"),
      (". It powers control-room Q&A, incident explanations, and shift-report drafting — all "
       "reviewed by a human. Default model: ", ""), ("claude-sonnet-4-5", "code"),
      (" (overridable via ", ""), ("ANTHROPIC_MODEL", "code"), (").", "")])
para("Failure handling is defensive: missing key, timeout (20s), non-2xx, or empty response all "
     "return {ok:false, error} — the copilot never throws a 500 into a route handler, and the "
     "API key and incident-sensitive bodies are never logged to stdout.")

# =====================================================================================
# 15. STATE MANAGEMENT
# =====================================================================================
h1("15. State Management & Data Lifecycle")
figure("12-state-lifecycle.png", "Figure 12 — Where source-of-truth lives at each hop.")
table(
    ["Layer", "State store", "Source of truth for", "Lifetime"],
    [
        ["Web client", "Zustand `copilotStore`", "View state (selection, filters, UI, alerts)", "Per browser tab"],
        ["Web server", "Module-scoped `TtlCache`", "Last live UPSRTC payload (15s)", "Per warm process"],
        ["Web server", "In-memory counters or Redis", "Rate-limit + circuit-breaker state", "Per process / shared"],
        ["Supabase", "Postgres", "Auth users, ops RBAC, copilot/webhook logs", "Durable"],
        ["control-service", "`stateStore` (in-memory) + Postgres", "vehicle_states, headway, commands, policies", "Durable + rehydrated"],
    ],
    widths=[1.3, 1.9, 2.5, 1.3], fs=8.2,
    caption="Table 9 — State ownership."
)
callout("SCALABILITY WATCH-OUT",
        "The web server’s TtlCache and default in-memory rate-limit/breaker counters are "
        "PER WARM PROCESS. On Vercel’s serverless model, each instance has its own copy, and a "
        "cold start resets them. Redis (REDIS_URL) is the single switch that makes these shared "
        "across instances — see §22.",
        fill="FEF3C7", edge_label_color=AMBER)

page_break()

# =====================================================================================
# 16. AUTHENTICATION
# =====================================================================================
h1("16. Authentication")
figure("08-auth-flow.png", "Figure 8 — Two independent auth systems + one machine channel.")
h3("Enterprise auth (Supabase)")
rich([("POST /api/auth/login", "code"), (" (", ""),
      ("src/app/api/auth/login/route.ts", "code"),
      (") requires same-origin + JSON, validates with Zod, rate-limits by IP+email, and calls "
       "Supabase ", ""), ("signInWithPassword", "code"),
      (". It returns a generic “Invalid email or password” for every failure (no user "
       "enumeration) and never returns a token in the body — the session is a Supabase cookie "
       "(", ""), ("@supabase/ssr", "code"), ("). There is ", ""),
      ("no self-service signup", "b"), ("; accounts are provisioned out-of-band via ", ""),
      ("pnpm run create-project-user", "code"), (".", "")])
h3("Ops RBAC (custom JWT)")
rich([("A completely separate system: ", ""), ("POST /api/ops/auth/login", "code"),
      (" verifies a bcrypt password and issues an HS256 JWT (", ""), ("jose", "code"),
      (") stored in ", ""), ("OPS_SESSION_COOKIE", "code"), (", signed with ", ""),
      ("OPS_SESSION_SECRET", "code"), (". Seven roles (", ""),
      ("driver, pilot_driver, dispatcher, depot, control_room, planner, admin", "code"),
      ("). Middleware derives the required role from the URL segment (", ""),
      ("roleForSegment()", "code"),
      (") and returns 403/redirect-to-forbidden for a wrong role (never “not signed in”).", "")])
h3("Route protection — defence in depth")
bullet([("Edge middleware", "b"), (" is the first gate (", ""), ("src/middleware.ts", "code"), (").", "")])
bullet([("Layouts", "b"), (" re-check the session server-side (protected + each ops layout).", "")])
bullet([("Every API handler", "b"), (" re-authorizes independently — e.g. ", ""),
        ("requireUpsrtcAccess()", "code"), (" in the live route, ", ""),
        ("requireOpsRole()", "code"), (" in ops routes. “Never rely on middleware alone.”", "")])
h3("Machine channel")
rich([("POST /api/control-service/webhook", "code"),
      (" authenticates purely by HMAC-SHA256 over the exact raw bytes (no cookie). It is "
       "exempt from both session gates by design — a redirect there would make an "
       "unauthenticated POST look like HTTP 200, silently dropping every command lifecycle "
       "event.", "")])

# =====================================================================================
# 17. SECURITY ARCHITECTURE & REVIEW
# =====================================================================================
h1("17. Security Architecture & Lightweight Review")
h3("Strengths (evidence-based)")
bullet([("Server-side proxy", "b"),
        (": the browser never contacts the UPSRTC upstream; the URL/headers stay server-side.", "")])
bullet([("Strong headers/CSP", "b"), (" in ", ""), ("next.config.ts", "code"),
        (": production CSP, HSTS (2y, preload), ", ""),
        ("frame-ancestors 'none'", "code"), (", ", ""), ("X-Content-Type-Options", "code"),
        (", restrictive Permissions-Policy.", "")])
bullet([("HMAC + timing-safe compare", "b"), (" on webhooks; body size capped BEFORE hashing "
         "(bytes, not string length); bad signature returns non-retryable 400.", "")])
bullet([("Login hardening", "b"),
        (": same-origin check, Zod validation, rate limiting, generic error, no token in body.", "")])
bullet([("Fail-safe rate limiter", "b"),
        (": if Redis is down, callers fall back to in-process counters — never to “allowed” "
         "(can’t DoS the limiter off) and never to “denied” (can’t lock out a control room).", "")])
bullet([("Secret hygiene", "b"),
        (": .env* is gitignored; no secrets are committed to git (verified). Service-role key "
         "is server-only; the Supabase anon key is public by design.", "")])

h3("Risks & findings")
table(
    ["Finding", "Severity", "Detail / file", "Recommendation"],
    [
        ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is browser-exposed", "Medium", "By design (NEXT_PUBLIC). A local .env.local key is real.", "Restrict by HTTP referrer + API in Google Cloud; rotate; set quotas"],
        ["Stale legacy secrets in local .env.local", "Low/Med", "PROJECT_PIN_HASH / SESSION_SECRET remain locally though the PIN system was removed", "Purge unused secrets from all local/deploy envs"],
        ["CSP allows 'unsafe-inline'/'unsafe-eval' on scripts", "Medium", "`next.config.ts` (documented trade-off)", "Move to per-request nonces"],
        ["No app-layer rate limit on the live proxy", "Low", "Auth-gated but any signed-in user can poll", "Add per-user quota; the 15s cache absorbs most load"],
        ["SSRF surface via UPSRTC_LIVE_URL/env", "Low", "URL is env-controlled, not user-controlled", "Keep env-only; validate host allowlist"],
        ["Two independent secrets must match (webhook HMAC)", "Ops risk", "Mismatch drops every event silently as 400", "Rotate both ends together; alert on 400 rate"],
    ],
    widths=[1.9, 0.8, 2.1, 2.0], fs=7.8,
    caption="Table 10 — Security findings (no secret values printed)."
)
callout("SECRETS", "No secret values appear in this document. The local .env.local was inspected "
        "only to confirm hygiene; it is correctly gitignored and was never committed to git.",
        fill="DCFCE7", edge_label_color=TEAL)

page_break()

# =====================================================================================
# 18. DEPLOYMENT
# =====================================================================================
h1("18. Deployment Architecture")
figure("10-deployment.png", "Figure 10 — Two deploy targets, isolated datastores.")
bullet([("Web app → Vercel", "b"),
        (": Next.js build produces static assets + RSC + serverless API routes; middleware runs "
         "at the edge; security headers/CSP from ", ""), ("next.config.ts", "code"),
        ("; ", ""), ("compress: true", "code"), (" (the ~3.8 MB live payload compresses to a "
         "few hundred KB).", "")])
bullet([("control-service → Render", "b"),
        (" (Docker, always-on): needed because state estimation, the scheduler jobs, and "
         "in-memory ", ""), ("stateStore", "code"),
        (" require a persistent process — a serverless model cannot host the 30s poller or "
         "keep rehydrated state warm.", "")])
bullet([("Datastores", "b"),
        (": Supabase (web) and control-service Postgres/PostGIS are deliberately isolated.", "")])
bullet([("Env config", "b"),
        (": ", ""), (".env.example", "code"),
        (" documents every variable with security notes; secrets are set per-environment, "
         "never committed. render.yaml defines staging + pilot services.", "")])
para("Static vs dynamic: the API routes are force-dynamic + nodejs runtime (they need Node "
     "crypto/pg and must not be cached). The dashboard shell is server-rendered; live data is "
     "client-polled.")

# =====================================================================================
# 19. ERROR HANDLING & OBSERVABILITY
# =====================================================================================
h1("19. Error Handling & Observability")
h3("Web app")
bullet([("Upstream failures", "b"), (" are structured, not thrown: ", ""),
        ("fetchUpstream()", "code"), (" returns {ok,status,error}; the route degrades down the "
         "ladder (§10).", "")])
bullet([("liveDiagnostics", "b"),
        (" (in the live route) tracks lastAttempt/lastSuccess/lastError/consecutiveFailures, "
         "surfaced in the developer ", ""), ("DiagnosticsDrawer", "code"), (".", "")])
bullet([("Client resilience", "b"), (": ", ""), ("useLiveFleet", "code"),
        (" aborts in-flight polls, ignores AbortError, and re-applies the error on an "
         "‘unavailable’ payload; ", ""), ("FleetMap", "code"), (" shows ", ""),
        ("MapFallback", "code"), (" on SDK failure; ", ""), ("FleetErrorBanner", "code"),
        (" surfaces feed errors.", "")])
h3("control-service")
bullet([("pino / pino-http", "b"), (" structured logs; ", ""), ("@sentry/node", "code"),
        (" spans (e.g. the ", ""), ("mpc.solve", "code"), (" span the dashboards are built on).", "")])
bullet([("Per-event ingest classification", "b"),
        (": one bad fix among 665 is rejected individually with a SQLSTATE-mapped code; an "
         "unrecognized error fails the batch (a bug must not hide as a data problem).", "")])
bullet([("/healthz + /readyz", "b"),
        (" for Render; readiness gates on a seeded network.", "")])
para("Gaps: no end-to-end tracing across the web↔control-service boundary; no product-level "
     "uptime/SLO dashboard evidenced in-repo beyond Sentry; the web app has no Sentry/RUM.")

# =====================================================================================
# 20. SCALABILITY ANALYSIS
# =====================================================================================
h1("20. Scalability Analysis")
para("Analysed from the actual loops and data volumes. N = number of live vehicles.")
table(
    ["Concern", "Complexity / behaviour", "Where"],
    [
        ["Leader/follower ordering", "O(N log N) sort per route-direction", "`ordering.ts`"],
        ["Pair headways", "O(N) over links per route-direction", "`headway/metrics.ts`"],
        ["Bunching rule", "O(required_samples) per pair", "`headway/bunching.ts`"],
        ["MPC solve", "O(pairs) per route-direction cycle", "`mpc/solver.ts`"],
        ["Map render", "O(visible) redraw, single canvas", "`fleetCanvasLayer.ts`"],
        ["Live payload transfer", "~3.8 MB JSON / 15s (compressed)", "`next.config.ts`"],
        ["Upstream download (ingest)", "~11.7 MB / 30s, one instance", "`gpsPoll.ts`"],
    ],
    widths=[1.9, 2.6, 1.7], fs=8.2,
    caption="Table 11 — Core operation complexity."
)
table(
    ["Fleet size", "Expected behaviour on current architecture"],
    [
        ["10", "Trivial. Everything real-time; map & compute negligible."],
        ["100", "Comfortable. Canvas map fine; headway sweep sub-second per route."],
        ["1,000", "Fine on control-service; web payload grows but canvas + compression hold. Batch sweep (size 60) fans out."],
        ["10,000", "≈ current UPSRTC scale. Canvas layer was purpose-built for ~9.5k. Bottlenecks: 11.7 MB single-download poll, per-process web cache, and headway sweep latency = required_samples × interval × ceil(eligible/batch). Needs streaming ingest + horizontal control-service + shared cache."],
    ],
    widths=[1.1, 5.1], fs=8.3,
    caption="Table 12 — Behaviour at scale."
)
bullet([("Race conditions", "b"),
        (": mitigated by the ", ""), ("vehicle_states", "code"),
        (" out-of-order guard (a newer persisted fix wins) and single-instance polling; the "
         "web per-process cache can serve slightly different snapshots across instances.", "")])
bullet([("Serverless multiplicity", "b"),
        (": each Vercel instance holds its own cache/limiter — Redis is the fix (§22).", "")])

page_break()

# =====================================================================================
# 21. FAILURE MODES
# =====================================================================================
h1("21. Failure Modes")
table(
    ["Failure", "Current behaviour", "Operational impact", "Recommended handling"],
    [
        ["UPSRTC upstream down", "Degradation ladder → cache(stale) → unavailable (0 rows)", "Map empties honestly; flagged", "Add alerting on consecutiveFailures; status banner (exists)"],
        ["Malformed / HTML upstream body", "Guarded + rejected; error recorded", "No crash; feed flagged", "Already handled; add metric on reject rate"],
        ["IST-mislabelled timestamp", "Corrected; broken-clock fix dropped → stale", "Correct age/quality badges", "Already handled (parseUpstreamInstant)"],
        ["Invalid coordinates / null-island", "Rejected in normalizer", "Bus omitted, counted as rejected", "Already handled"],
        ["Duplicate vehicle", "Merged by reg, newest valid ts wins", "Single marker", "Already handled"],
        ["One bus stops sending", "Ages to degraded→stale (colour changes)", "Visible staleness", "Add explicit ‘dark vehicle’ alert"],
        ["Google Maps fails", "MapFallback with retry", "Dashboard usable minus map", "Already handled"],
        ["Auth session expires", "401/redirect to login", "Re-login", "Already handled"],
        ["control-service unreachable (web)", "Circuit breaker opens after 3 fails, 30s cooldown", "Ops panels show notice, don’t hang", "Already handled (`controlService/client.ts`)"],
        ["Webhook secret mismatch", "400 (non-retryable) → events dropped silently", "Command outcomes never arrive", "Alert on 400 rate; rotate both ends together"],
        ["Multi-instance GPS poll", "Prevented by GPS_POLL_ENABLED on one node", "Avoids N× writes/races", "Already handled; document the operational rule"],
        ["Vercel cold start", "Per-process cache/limiter reset", "Weaker rate limits; extra upstream fetch", "Enable Redis"],
        ["Conflicting interventions", "Hard safety filter rejects on active command", "No double-hold", "Already handled (`mpc/safety.ts`)"],
    ],
    widths=[1.5, 1.9, 1.5, 1.9], fs=7.6,
    caption="Table 13 — Failure modes and handling."
)

# =====================================================================================
# 22. REDIS / SHARED-STATE NOTE
# =====================================================================================
h2("22. A note on shared state (Redis)")
rich([("REDIS_URL", "code"), (" is the single activation switch (", ""),
      ("src/lib/redis/client.ts", "code"),
      ("). Unset (default for local/CI): the failed-login limiter, the copilot limiter, and the "
       "control-service circuit breaker use per-process in-memory counters. Set: all instances "
       "share one budget. If Redis is configured but unreachable, every caller falls back to "
       "its in-process counter — never to “allowed” or “denied”. This should be ON for any "
       "multi-instance or serverless production deploy.", "")])

# =====================================================================================
# 23. TESTING
# =====================================================================================
h1("23. Testing")
para("Both packages use Vitest; the web app adds Playwright e2e. The web app has a substantial "
     "unit suite (src/tests/unit/*): normalizer, bunching math, rbac, control contracts, "
     "copilot (anthropic/prompts/rate-limit/boundary), control-service client/webhook/freshness, "
     "ops dashboards, fleet data/view, geo, alerts, audit, invite email. control-service ships "
     "tested state-estimation, headway, and MPC libraries plus a regression/replay simulator "
     "(demandBurst, gpsDropout, missedTrip, nonCompliance).")
h3("Assessment")
bullet([("Strong", "b"), (": pure algorithm modules are well isolated and unit-tested "
         "(estimator, headway, MPC, normalizer).", "")])
bullet([("Gaps", "b"), (": no evidence of contract tests spanning the web↔control-service HTTP "
         "boundary end-to-end; limited e2e; the live-ingest wiring (estimator → runtime) is "
         "the least-covered seam.", "")])
h3("Recommended test pyramid")
bullet([("Unit (broad base)", "b"), (": keep the pure-function coverage; add boundary tests.", "")])
bullet([("Contract (middle)", "b"), (": Zod-schema contract tests on every /v1/* + webhook "
         "shape, run against both sides.", "")])
bullet([("Integration", "b"), (": ingest→estimate→headway→bunching→command with a seeded "
         "PostGIS fixture.", "")])
bullet([("E2E (thin top)", "b"), (": login → dashboard → select bus → issue command → driver "
         "ack → control-room sees outcome.", "")])
h3("Deterministic bunching tests to add")
for t in ["Normal headway (no incident fires)",
          "Two buses bunching (ratio crosses bunched threshold for required_samples)",
          "Multi-bus chain reaction (bunch propagates down the chain)",
          "GPS dropout (one vehicle goes low-confidence → excluded, rank −1)",
          "Delayed telemetry (stale fix rejected by safety filter)",
          "Intervention recovery (hold → ratio recovers → incident closes)",
          "Threshold boundary (ratio exactly at bunched/warning ratio)"]:
    bullet([(t, "")])

page_break()

# =====================================================================================
# 24. PRODUCTION vs PROTOTYPE vs MOCK vs PLANNED
# =====================================================================================
h1("24. Production vs Prototype vs Mock vs Planned")
table(
    ["Feature", "Production", "Prototype", "Mock/Hard-coded", "Planned"],
    [
        ["Live GPS proxy (web)", "✔", "", "", ""],
        ["Live fleet map", "✔", "", "", ""],
        ["Schedule lookup", "✔", "", "", ""],
        ["Enterprise + ops auth", "✔", "", "", ""],
        ["State estimation (Kalman/map-match)", "✔ (tested)", "", "", "wired to live ingest = further work"],
        ["Headway/EWT/CV + reactive bunching", "✔ (tested)", "", "", ""],
        ["MPC hold/dispatch engine", "✔ (tested)", "", "", ""],
        ["Occupancy-weighted predictive MPC", "", "✔ (advisory, 1-step)", "", "multi-step QP"],
        ["Bunching PREDICTION (forecast)", "", "", "", "✔ (blueprint)"],
        ["Client bunching page", "", "", "✔ (4 buses)", ""],
        ["Traffic / scenario overlays", "", "", "✔ (simulated)", ""],
        ["LLM copilot", "✔ (advisory)", "", "", ""],
        ["Driver PWA command ack", "✔", "", "", ""],
        ["Automated command execution", "", "", "", "✔ (gated by human+ack)"],
        ["Depot/central-control integration", "", "", "", "✔"],
    ],
    widths=[2.2, 1.15, 1.15, 1.15, 1.35], fs=7.9,
    caption="Table 14 — Maturity classification from repository evidence."
)

# =====================================================================================
# 25/26. TECHNICAL DEBT
# =====================================================================================
h1("25. Technical Debt")
bullet([("Duplicated upstream normalization + IST correction", "b"),
        (" across web and control-service (documented “sibling implementations” with no shared "
         "package) — must be changed in lockstep; a real drift risk.", "")])
bullet([("Estimator not wired to live ingestion by default", "b"),
        (": the powerful state-estimation library exists and is tested but ", ""),
        ("GPS_POLL_ENABLED=false", "code"),
        (" by default and the README notes the runtime “does not call it yet”. The gap between "
         "capability and activation is the biggest debt.", "")])
bullet([("MPC objective weights hard-coded", "b"), (" (", ""), ("W_WAIT=W_ONBOARD=1", "code"),
        (") with no route_policies column yet.", "")])
bullet([("Two large narrative docs", "b"), (" (", ""), ("README.md", "code"), (" 92 KB, ", ""),
        ("DEV_VS_MAIN_ANALYSIS.md", "code"), (" 88 KB) risk drifting from code.", "")])
bullet([("Per-process web state", "b"),
        (" without Redis is a correctness-looking-but-not control on serverless.", "")])
bullet([("CSP unsafe-inline/eval", "b"), (" pending nonces.", "")])

h1("26. Engineering Recommendations")
def rec(title, problem, files, risk, design, priority, pcolor):
    h3(title)
    rich([("Problem: ", "b"), (problem, "")], after=2)
    rich([("Files: ", "b"), (files, "")], after=2)
    rich([("Risk: ", "b"), (risk, "")], after=2)
    rich([("Suggested design: ", "b"), (design, "")], after=2)
    p = doc.add_paragraph(); r = p.add_run("Priority: " + priority); r.bold = True; r.font.color.rgb = pcolor
    p.paragraph_format.space_after = Pt(8)

h2("Critical before production")
rec("Wire live ingestion to the estimator, deliberately",
    "The control loop’s value depends on the estimator running on live GPS, but it is off by default.",
    "control-service/src/scheduler/gpsPoll.ts, ingestion/pipeline.ts, state-estimation/singleton.ts",
    "Shipping a pilot where the ‘AI’ pipeline is dormant.",
    "Enable GPS_POLL_ENABLED on exactly one instance; add readiness/ingest-lag alerts; document the single-poller rule.",
    "CRITICAL", RED)
rec("Alerting on silent-drop failure modes",
    "Webhook 400s and upstream outages drop data without paging anyone.",
    "src/app/api/control-service/webhook/route.ts, live/route.ts liveDiagnostics",
    "Command outcomes or live feed silently missing during an incident.",
    "Emit metrics on webhook 400 rate and consecutiveFailures; alert; dashboard.",
    "CRITICAL", RED)
h2("Important for pilot")
rec("Enable Redis for shared limits/cache",
    "Per-process counters reset on cold start and diverge across instances.",
    "src/lib/redis/client.ts, auth/rate-limit.ts, copilot/rateLimit.ts, controlService/client.ts",
    "Rate limits weaker than they appear; inconsistent snapshots.",
    "Provision Upstash; set REDIS_URL/REDIS_TOKEN in production.",
    "HIGH", AMBER)
rec("De-duplicate the upstream normalizer",
    "Two hand-kept copies of tricky parsing/IST logic.",
    "src/lib/upsrtc/normalizer.ts, control-service/src/ingestion/upsrtc/normalize.ts",
    "Silent divergence on an upstream change.",
    "Extract a tiny shared package or generate one from the other; add a cross-test asserting identical parsing.",
    "HIGH", AMBER)
h2("Scalability / reliability / architecture")
rec("Move from polling to streaming ingest",
    "11.7 MB every 30s downloaded whole by one node.",
    "control-service/src/scheduler/gpsPoll.ts",
    "Download latency and single-node bottleneck at scale.",
    "If UPSRTC offers deltas/streaming use it; else shard by depot/region across instances with a coordinator.",
    "MEDIUM", TEAL)
rec("Introduce a queue between ingest and estimation",
    "Ingest and estimation run inline in the poll cycle.",
    "control-service/src/ingestion/pipeline.ts",
    "A slow estimate backs up the poll; no backpressure.",
    "Insert a durable queue (e.g. Postgres LISTEN/NOTIFY or a broker) so ingestion and compute scale independently.",
    "MEDIUM", TEAL)
h2("Security / code quality / AI-ML")
rec("CSP nonces + Maps key restriction",
    "unsafe-inline/eval scripts; browser-exposed Maps key.",
    "next.config.ts",
    "XSS blast radius; key abuse.",
    "Per-request nonces; referrer+API restrictions and quotas on the Maps key in Google Cloud.",
    "MEDIUM", TEAL)
rec("Promote predictive MPC from advisory to real forecasting",
    "Detection is reactive; predictive MPC is single-step with fixed weights.",
    "control-service/src/mpc/occupancyMpc.ts",
    "Interventions fire after bunching starts.",
    "Add a short-horizon headway forecast (even a Kalman-projected multi-step) and per-route tunable weights; validate on the replay simulator before enabling.",
    "MEDIUM", TEAL)

page_break()

# =====================================================================================
# 27. IMPORTANT FUNCTION WALKTHROUGHS
# =====================================================================================
h1("27. Important Functions")
def fn(name, file, resp, inp, proc, out, calledby, calls, side, fail, why):
    h3(name)
    rows = [
        ("File", file), ("Responsibility", resp), ("Inputs", inp), ("Processing", proc),
        ("Outputs", out), ("Called by", calledby), ("Calls", calls),
        ("Side effects", side), ("Failure cases", fail), ("Why it matters", why),
    ]
    t = doc.add_table(rows=0, cols=2); t.style = "Table Grid"
    for k, v in rows:
        c = t.add_row().cells
        set_cell_bg(c[0], "E2E8F0")
        pk = c[0].paragraphs[0]; rk = pk.add_run(k); rk.bold = True; rk.font.size = Pt(8.4)
        pv = c[1].paragraphs[0]
        parts = v.split("`")
        for j, seg in enumerate(parts):
            if not seg: continue
            if j % 2 == 1: code(pv, seg)
            else:
                rr = pv.add_run(seg); rr.font.size = Pt(8.4)
        c[0].width = Inches(1.2); c[1].width = Inches(5.1)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

fn("GET (live feed)", "`src/app/api/upsrtc/live/route.ts`",
   "Server proxy for live UPSRTC GPS; authorizes, caches, normalizes, degrades.",
   "NextRequest (auth cookie, accept-encoding)",
   "requireUpsrtcAccess → demo/cache check → fetchUpstream → normalizeLivePayload → cache set → degradation ladder",
   "`LiveFeedResponse` (buses, source, stale, counts)",
   "`useLiveFleet` poll", "`fetchUpstream`, `normalizeLivePayload`, `TtlCache`",
   "Updates module cache + liveDiagnostics",
   "Upstream down → cache/unavailable; unauthorized → 401",
   "The only bridge between the browser and the real UPSRTC feed.")
fn("normalizeLivePayload", "`src/lib/upsrtc/normalizer.ts`",
   "Turn messy upstream rows into canonical buses.",
   "unknown payload, now(ms)",
   "extractArray → alias pick → coord gate → IST timestamp fix → dedupe by reg (newest valid)",
   "{buses, recordCount, rejectedRecordCount}",
   "live route, fixture responses", "`extractArray`, `parseUpstreamInstant`, `isValidCoordinate`",
   "None (pure)", "Bad rows counted as rejected; unusable ts → dropped/stale",
   "Every downstream badge/table/marker reads its output; the app’s data-quality contract.")
fn("estimateVehicleState", "`control-service/src/state-estimation/estimator.ts`",
   "One position-event → smoothed route-relative state.",
   "EstimationContext (event, candidate shapes, prior state, held flag)",
   "matchCandidates → selectChosenCandidate → confidence → Kalman update (loop unwrap) → stop-state",
   "`VehicleStateEstimate`",
   "StateEstimationService / pipeline", "map matching, confidence, `DistanceKalmanFilter`, stop classifier",
   "None (pure)", "No candidates/off-route → off_route estimate; low confidence flagged",
   "The core sensor-fusion step everything downstream depends on.")
fn("computePairHeadways", "`control-service/src/headway/metrics.ts`",
   "Per leader→follower link, compute spatial gap and time headways.",
   "ordered vehicles, speed/confidence lookups, route geometry, target",
   "gapMeters (loop-aware) → hFwd/hBwd (speed floored) → deviation → min-confidence",
   "`HeadwayPairMetric[]`",
   "headway service / sweep", "`computeGapMeters`",
   "None (pure)", "Missing speed → null headway; capped at 24h",
   "The measurement layer the bunching rule and MPC both consume.")
fn("evaluateBunchingRule", "`control-service/src/headway/bunching.ts`",
   "Classify a pair as bunched/warning/recovered from recent ratios.",
   "ratios (newest first), required_samples, thresholds, hasOpenIncident",
   "window of N samples; all ≤ bunched / all ≤ warning / all recovered",
   "`{severity, recovered, ratio}`",
   "headway service", "—", "None (pure)",
   "Too few samples → severity null (avoids noise)",
   "The actual detection decision; config-driven so ops can tune per route.")
fn("solve (MPC)", "`control-service/src/mpc/solver.ts`",
   "Pick the least-disruptive safe intervention for a route-direction.",
   "routeDirectionId (reads state store + policy + active commands)",
   "terminal → two-way → self-eq candidates → hard safety filter → occupancy re-score → select lowest cost",
   "`MpcSolveResult` (selected action, cost, rejected, predictive advisory)",
   "POST /v1/mpc/solve", "the four control modules + `applyHardSafetyFilter`, `listActiveVehicleIds`",
   "Sentry span; warn logs on rejection",
   "No policy → 404; stale/conflict → rejected",
   "The decision engine that produces every recommended command.")
fn("computeTwoWayCandidates", "`control-service/src/mpc/twoWayHold.ts`",
   "Blueprint Algorithm B mid-route hold.",
   "headway states, terminal vehicle set, policy (Kf,Kb,hold_max)",
   "hold = clamp(Kf·(H*−hFwd) − Kb·(H*−hBwd), 0, hold_max); skip ≤0",
   "`CandidateAction[]` sorted by cost",
   "solver", "`clamp`", "None (pure)",
   "Missing Kf/Kb/hBwd → empty (self-eq covers)",
   "The primary mid-route control law; backward term prevents exporting the bunch.")
fn("useLiveFleet", "`src/hooks/useLiveFleet.ts`",
   "Client polling loop for live data.",
   "— (reads store actions)",
   "15s interval; AbortController per tick; setFleet / re-apply error on 'unavailable'",
   "void (writes Zustand store)",
   "CommandCenter", "`fetch('/api/upsrtc/live')`, store setters",
   "Network + store writes; interval",
   "Abort ignored; non-OK → setFleetError",
   "Drives the entire live experience; the client heartbeat.")
fn("POST (webhook)", "`src/app/api/control-service/webhook/route.ts`",
   "Receive signed control-service events.",
   "raw body + signature/timestamp/idempotency headers",
   "size cap → HMAC verify → parse → envelope → store (idempotent) → side effects → mark processed",
   "200/400/413/500/503 tuned to sender retry policy",
   "control-service webhook dispatch", "`verifyControlServiceWebhook`, `applyWebhookSideEffects`",
   "Writes ops_control_service_webhook_events",
   "Bad sig → 400 (no retry); secret unset/db down → 503 (retry)",
   "The only inbound channel for command outcomes; correctness is safety-critical.")
fn("computeLeaderFollowerOrder", "`control-service/src/state-estimation/ordering.ts`",
   "Rank vehicles along a route-direction.",
   "vehicles, {isLoop, totalDistance}",
   "filter low-confidence → sort by distance desc → link leader/follower → loop wrap",
   "`OrderedVehicle[]` (rank, leader/follower ids)",
   "headway service", "—", "None (pure)",
   "Low-confidence → rank −1, no links",
   "Establishes who is whose leader — the basis of every headway.")

page_break()

# =====================================================================================
# 28. CALL GRAPHS
# =====================================================================================
h1("28. Call Graphs (critical paths)")
h3("Live fleet render")
for line in ["CommandCenter", "→ useLiveFleet()", "→ fetch('/api/upsrtc/live')",
             "→ route GET → requireUpsrtcAccess()", "→ TtlCache.get / fetchUpstream(UPSRTC_LIVE_URL)",
             "→ normalizeLivePayload()", "→ LiveFeedResponse", "→ copilotStore.setFleet()",
             "→ FleetMap useEffect([buses]) → fleetCanvasLayer.setBuses()", "→ canvas redraw"]:
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(1)
    p.paragraph_format.left_indent = Inches(0.3); code(p, line)
h3("Bunching detection → recommendation (control-service)")
for line in ["scheduler headwayCompute", "→ StateEstimation ordering (computeLeaderFollowerOrder)",
             "→ computePairHeadways → computeAggregate (CV/EWT)", "→ persist samples",
             "→ evaluateBunchingRule() → open/close incident", "  … then, on demand:",
             "POST /v1/mpc/solve → solve()", "→ terminal/two-way/self-eq candidates",
             "→ applyHardSafetyFilter → computePredictiveAdvisory", "→ selected CandidateAction"]:
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(1)
    p.paragraph_format.left_indent = Inches(0.3); code(p, line)
h3("Command issue → outcome")
for line in ["Control room UI", "→ POST /api/ops/control-room/commands (RBAC + kill-switch)",
             "→ createControlServiceCommand() (Bearer)", "→ control-service persists (rollout gate)",
             "→ driver PWA GET /v1/pilot-driver/commands", "→ POST ack (accept|unable|unsafe)",
             "→ signed webhook → POST /api/control-service/webhook",
             "→ applyWebhookSideEffects → control room sees outcome"]:
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(1)
    p.paragraph_format.left_indent = Inches(0.3); code(p, line)

page_break()

# =====================================================================================
# 29. API REFERENCE
# =====================================================================================
h1("29. API Reference")
figure("11-command-sequence.png", "Figure 11 — Command lifecycle sequence.")
h2("29.1 Web app API routes (src/app/api)")
table(
    ["Method", "Path", "Auth", "Purpose"],
    [
        ["POST", "/api/auth/login", "same-origin", "Supabase sign-in; generic errors; rate-limited"],
        ["POST", "/api/auth/logout", "session", "End Supabase session"],
        ["GET", "/api/auth/session", "session", "Current session probe"],
        ["GET", "/api/upsrtc/live", "Supabase", "Live GPS proxy (cache + degradation ladder)"],
        ["GET", "/api/upsrtc/schedule", "Supabase", "Per-vehicle schedule lookup"],
        ["POST", "/api/control-service/webhook", "HMAC", "Inbound command lifecycle events"],
        ["POST/GET", "/api/ops/auth/login·logout·session", "ops JWT", "Ops RBAC auth"],
        ["POST", "/api/ops/auth/accept-invite", "invite token", "Set password from invite"],
        ["POST", "/api/ops/control-room/commands", "control_room", "Bridge dispatcher action → control-service command"],
        ["GET", "/api/ops/control-room/commands/[id]", "control_room", "Command detail"],
        ["POST", "/api/ops/control-room/overrides", "control_room", "Manual override (distinct from 9 command types)"],
        ["GET/POST", "/api/ops/control-room/kill-switches[/…]", "control_room", "Engage/disengage route kill switches"],
        ["POST", "/api/ops/control-room/approvals/[id]/reject", "control_room", "Reject a pending approval"],
        ["POST", "/api/ops/control-room/copilot/query·explain", "control_room", "Grounded LLM Q&A / incident explanation"],
        ["POST/GET", "/api/ops/control-room/copilot/shift-reports[/…]", "control_room", "Draft/finalize shift reports"],
        ["GET", "/api/ops/control-room/pilot/kpi·war-room·guardrail-breaches", "control_room", "Pilot KPIs & war-room"],
        ["POST/GET", "/api/ops/dispatcher/approvals", "dispatcher", "Dispatcher approval queue"],
        ["POST", "/api/ops/driver/breakdown-reports", "driver", "Driver breakdown report"],
        ["GET", "/api/ops/pilot-driver/commands", "pilot_driver", "Driver’s current command (poll)"],
        ["POST", "/api/ops/pilot-driver/commands/[id]/ack", "pilot_driver", "Acknowledge (accept/unable/unsafe)"],
        ["POST/GET", "/api/ops/admin/invites·users·rollout-stages[/…]", "admin", "Provision accounts, manage rollout stages"],
        ["GET", "/api/ops/fleet/schedule", "ops", "Fleet schedule lookup"],
    ],
    widths=[0.8, 2.7, 1.0, 2.3], fs=7.7,
    caption="Table 15 — Web app API surface (37 route files)."
)
h2("29.2 control-service REST (/v1, Bearer service token)")
table(
    ["Method", "Path", "Purpose"],
    [
        ["GET", "/healthz · /readyz", "Liveness / readiness (unauthenticated)"],
        ["POST", "/v1/positions", "Ingest a batch of GPS fixes"],
        ["POST", "/v1/admin/geometry/refresh", "Invalidate network-geometry cache"],
        ["GET", "/v1/vehicle-states", "Current per-vehicle estimated states"],
        ["GET", "/v1/route-directions[/…]", "Route-direction list + geometry"],
        ["GET", "/v1/route-directions/:id/headway", "Latest headway snapshot"],
        ["POST", "/v1/route-directions/:id/headway/compute", "Force a headway compute"],
        ["GET", "/v1/incidents · /v1/incidents/:id", "Open/closed bunching incidents"],
        ["POST", "/v1/mpc/solve", "Run the MPC decision engine for a route-direction"],
        ["POST", "/v1/commands", "Create a command"],
        ["GET", "/v1/commands/active · /:id · /:id/audit · /by-dispatcher-action/:id", "Command reads"],
        ["POST", "/v1/commands/:id/deliver · /ack · /supersede", "Command lifecycle transitions"],
        ["GET/PUT", "/v1/rollout-stages · /v1/route-directions/:id/rollout-stage[/audit]", "Pilot rollout gating"],
        ["GET", "/v1/guardrail-breaches · /v1/kpi/daily", "Pilot guardrails & KPIs"],
        ["GET/PUT", "/v1/war-room/incidents[/:id/review]", "War-room incident review"],
    ],
    widths=[0.9, 3.1, 2.4], fs=7.9,
    caption="Table 16 — control-service REST surface."
)
para("All /v1/* require the Bearer service token (control-service/src/app.ts). Web calls go "
     "through src/lib/controlService/client.ts, which adds an 8s timeout and a 3-failure / 30s "
     "circuit breaker so one bad control-service instance cannot hang an ops dashboard.")

page_break()

# =====================================================================================
# 30. ENVIRONMENT VARIABLES
# =====================================================================================
h1("30. Environment Variables")
para("From .env.example (web) and control-service/.env.example. NEXT_PUBLIC_* are exposed to "
     "the browser bundle. No values are printed.")
h3("Web app")
table(
    ["Variable", "Client/Server", "Purpose", "Security note"],
    [
        ["NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY", "Client", "Supabase Auth", "Public by design; access enforced by Auth"],
        ["SUPABASE_SERVICE_ROLE_KEY", "Server", "Provision accounts (scripts only)", "Never NEXT_PUBLIC; high privilege"],
        ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "Client", "Maps SDK", "Browser-exposed → restrict by referrer + quotas"],
        ["UPSRTC_LIVE_URL / UPSRTC_SCHEDULE_URL", "Server", "Upstream feed URLs", "Server-only; keeps upstream off the browser"],
        ["ALLOW_FIXTURE_FALLBACK / NEXT_PUBLIC_DEMO_MODE", "Server/Client", "Opt-in demo data", "Leave OFF in real deploys"],
        ["CONTROL_SERVICE_BASE_URL / _SERVICE_TOKEN", "Server", "Web→control-service REST", "Rotating bearer"],
        ["CONTROL_SERVICE_WEBHOOK_SECRET", "Server", "Verify inbound webhooks", "Must equal control-service WEBHOOK_HMAC_SECRET"],
        ["OPS_DATABASE_URL", "Server", "Ops RBAC datastore", "Separate from Supabase"],
        ["OPS_SESSION_SECRET", "Server", "HS256 ops JWT signing", "≥32 chars; distinct auth system"],
        ["RESEND_API_KEY / RESEND_FROM_EMAIL", "Server", "Invite email", "—"],
        ["ANTHROPIC_API_KEY / ANTHROPIC_MODEL", "Server", "Copilot LLM", "Never logged"],
        ["REDIS_URL / REDIS_TOKEN", "Server", "Shared limiter/breaker/cache", "Recommended in production"],
        ["SITE_URL", "Server", "Canonical URL / metadata", "—"],
    ],
    widths=[2.4, 0.9, 1.7, 1.9], fs=7.7,
    caption="Table 17 — Web environment variables."
)
h3("control-service")
table(
    ["Variable", "Purpose"],
    [
        ["CONTROL_SERVICE_DATABASE_URL", "Own Postgres/PostGIS (never the web’s Supabase URL)"],
        ["SERVICE_TOKEN_SECRET", "Verify web→control-service bearer"],
        ["WEBHOOK_HMAC_SECRET / WEB_APP_WEBHOOK_URL", "Sign + deliver outbound webhooks"],
        ["GPS_POLL_ENABLED / _INTERVAL_MS / _URL / GPS_MAX_AGE_SECONDS", "In-process poller (enable on ONE instance)"],
        ["HEADWAY_COMPUTE_INTERVAL_MS / _BATCH_SIZE / _CONCURRENCY", "Headway sweep tuning (drives detection latency)"],
        ["SHAPE_CACHE_TTL_MS / REQUIRE_SEEDED_NETWORK", "Geometry cache + readiness gate"],
        ["SENTRY_DSN / SENTRY_ENVIRONMENT / LOG_LEVEL / PORT", "Observability + runtime"],
    ],
    widths=[3.0, 3.3], fs=8.0,
    caption="Table 18 — control-service environment variables."
)

# =====================================================================================
# 31. DEPENDENCIES
# =====================================================================================
h1("31. Architecturally Important Dependencies")
table(
    ["Package", "Role", "Where"],
    [
        ["next / react / react-dom", "App framework + UI runtime", "whole web app"],
        ["zustand", "Client state store", "`copilotStore`"],
        ["@googlemaps/js-api-loader", "Maps SDK loader", "`maps/loader.ts`, `FleetMap`"],
        ["three / @react-three/fiber / drei", "Landing 3D globe", "`src/three/*`"],
        ["@supabase/ssr / supabase-js", "Enterprise auth", "`src/lib/supabase/*`"],
        ["jose + bcryptjs", "Ops RBAC JWT + password hashing", "`src/lib/auth/rbac/*`"],
        ["zod", "Runtime validation / shared contracts", "`src/models/*`, control-service"],
        ["@upstash/redis", "Shared limiter/breaker store", "`src/lib/redis/*`"],
        ["recharts", "Dashboard charts", "impact/observability"],
        ["framer-motion / gsap", "Animation", "landing + dashboard"],
        ["pg", "Postgres access", "web ops DB + control-service"],
        ["express / pino / @sentry/node", "control-service runtime + logs + tracing", "control-service"],
    ],
    widths=[2.2, 2.5, 1.6], fs=8.1,
    caption="Table 19 — Key dependencies (trivial packages omitted)."
)

page_break()

# =====================================================================================
# 32. PRINCIPAL ENGINEER CODE WALKTHROUGH
# =====================================================================================
h1("32. Principal Engineer Code Walkthrough")
para("An ordered sequence of files to open on screen. For each step: what to open, what to say, "
     "the likely question, and a strong answer.")
def step(n, file, focus, say, q, a):
    h3(f"Step {n} — {file}")
    rich([("Focus: ", "b"), (focus, "")], after=2)
    rich([("Say: ", "b"), (say, "i")], after=2)
    rich([("Likely question: ", "b"), (q, "")], after=2)
    p = doc.add_paragraph(); r = p.add_run("Answer: " + a); r.font.size = Pt(9.8)
    p.paragraph_format.space_after = Pt(8)

step(1, "package.json (root)", "scripts, Next 15 / React 19, Zustand, Google Maps, Supabase, zod",
     "This is the web app. Note it’s one of two systems — the control-service has its own package.json.",
     "Why Next.js?",
     "SSR for auth-gated pages, colocated serverless API routes for the UPSRTC proxy so upstream secrets never reach the browser, and one language across client/server.")
step(2, "control-service/package.json + README.md", "Express, pg (PostGIS), pino, Sentry; the boundary rationale",
     "The real transport intelligence lives here as an always-on service with its own isolated DB.",
     "Why split it out instead of more API routes?",
     "It needs a persistent process: a 30s GPS poller, in-memory rehydrated state, and scheduler sweeps. Serverless can’t host that. The integration contract also mandates DB isolation.")
step(3, "src/middleware.ts", "matcher allowlist; three auth branches; webhook exemption",
     "First-line auth. Notice the webhook is deliberately exempt and why.",
     "Isn’t exempting a route from the gate dangerous?",
     "It authenticates by HMAC instead. If a session gate applied, an unauthenticated POST would get a login redirect that fetch() follows as 200 — silently dropping every command event.")
step(4, "src/app/api/upsrtc/live/route.ts", "auth re-check, TtlCache, the degradation ladder",
     "The single bridge to the real GPS feed, and our honest-failure policy.",
     "What happens when UPSRTC is down?",
     "We serve last-known-good cache, then an explicit zero-row ‘unavailable’ state — never demo buses. A recent commit made that the default.")
step(5, "src/lib/upsrtc/normalizer.ts", "alias map, IST timestamp fix, coord gate, dedupe",
     "This is where messy reality becomes clean data. The IST-as-Z fix is the subtle one.",
     "Why correct timestamps here?",
     "The feed labels IST as Z, putting fixes 5.5h in the future, which would make every vehicle read ‘good’ forever. We shift future values back one IST offset and drop broken clocks.")
step(6, "src/components/map/FleetMap.tsx + fleetCanvasLayer.ts", "single canvas overlay vs 9.5k markers",
     "The key frontend performance decision.",
     "Why not markers + clustering?",
     "Measured 5.1s of main-thread blocking. One canvas with Path2D-per-colour and local Mercator maths makes redraw O(visible) on the compositor.")
step(7, "control-service/src/state-estimation/estimator.ts", "map-match → confidence → Kalman → stop-state",
     "How a raw fix becomes a trustworthy route-relative position.",
     "How do you avoid trusting a bad GPS fix?",
     "Low-confidence/off-route fixes are flagged (rank −1) and excluded from ordering, so they never anchor a neighbour’s headway. The Kalman filter smooths the rest.")
step(8, "control-service/src/headway/metrics.ts + bunching.ts", "gap→time headway; the reactive rule",
     "Measurement then detection. Detection is reactive and config-driven.",
     "Time or spatial headway?",
     "Time headway derived from spatial gap and current speed. Detection fires when the ratio to target stays low for N consecutive samples, thresholds from route_policies — not hard-coded.")
step(9, "control-service/src/mpc/solver.ts (+ twoWayHold.ts, safety.ts)", "control hierarchy + hard safety filter",
     "How we choose the least-disruptive safe intervention.",
     "How do you prevent conflicting interventions?",
     "The hard safety filter rejects any candidate for a vehicle with an active command, plus stale-state and max-hold breaches — logged and returned for explainability.")
step(10, "src/app/api/control-service/webhook/route.ts", "HMAC over raw bytes; status codes tuned to retries",
     "The inbound channel for command outcomes; correctness is safety-critical.",
     "Why 400 vs 503 distinctions?",
     "400 (bad signature) is non-retryable — a retry can’t fix it and would waste attempts on an attacker. 503 (secret unset/db down) is retryable so a misconfig drops nothing.")
step(11, "src/lib/bunching/math.ts", "the SIMULATION — 4 buses, demo constants",
     "This is the explainer page, not the production system. Be explicit.",
     "Is this the AI?",
     "No. It’s a deterministic teaching simulation with hard-coded parameters. The production control laws are in control-service/src/mpc.")

page_break()

# =====================================================================================
# 33. PRINCIPAL ENGINEER Q&A
# =====================================================================================
h1("33. Principal Engineer Q&A")
qa = [
    ("Why Next.js?", "SSR auth gating + colocated serverless proxy keeps the UPSRTC upstream off the browser; one language end-to-end.", "SEO isn’t a driver here; it’s an internal tool."),
    ("Why is the GPS API server-side?", "To hide the upstream URL/headers, add a 15s cache, and normalize before the client sees anything.", "Any signed-in user can still poll it — no per-user quota yet."),
    ("How do you prevent GPS endpoint exposure?", "The browser only ever calls /api/upsrtc/live; the upstream URL is a server env var.", "SSRF surface is limited because the URL is env-, not user-, controlled."),
    ("What happens if GPS data is delayed?", "Age buckets classify good/degraded/stale; stale fixes are dropped by the ingest max-age and MPC safety filter.", "We don’t yet page on a specific vehicle going dark."),
    ("How is stale telemetry detected?", "classifyDataQuality by age; parseUpstreamInstant corrects IST and nulls broken clocks; safety.ts rejects stale state.", "Depends on correct upstream timestamps, which are quirky."),
    ("Time complexity of bunching detection?", "O(N log N) ordering + O(N) headways + O(samples) per pair, per route-direction.", "Batched sweep means detection latency = samples × interval × ceil(eligible/batch)."),
    ("How would this work with 10,000 buses?", "That’s ~current scale; the canvas map and batched sweep were built for it.", "Bottlenecks: 11.7 MB single-node poll, per-process web cache — needs streaming + horizontal scale + Redis."),
    ("How do you avoid conflicting interventions?", "Hard safety filter rejects a candidate if the vehicle has an active command.", "Cross-route-direction conflicts on shared corridors are only partially modelled."),
    ("How is route-level isolation ensured?", "Headway/MPC operate per route-direction; corridor ordering handles shared trunks explicitly.", "Corridor offsets must be configured or vehicles are excluded."),
    ("Where is source-of-truth state?", "control-service Postgres (+ rehydrated in-memory store) for fleet/headway/commands; the web holds only view state.", "The web app deliberately has no write access to that DB."),
    ("What about multiple serverless instances on Vercel?", "Each has its own cache/limiter; Redis makes them shared.", "Without Redis, ‘5 logins / 15 min’ is per warm process."),
    ("Where would you add a message queue?", "Between ingestion and estimation, so a slow estimate doesn’t back up the poll.", "Currently inline; no backpressure."),
    ("How would you migrate polling → streaming?", "Use UPSRTC deltas/stream if available, or shard the poll by region across instances with a coordinator.", "Depends on upstream capabilities, which are undocumented."),
    ("Why deterministic instead of ML?", "Control laws are explainable, auditable, and safe by construction — essential when a human dispatcher must justify a hold.", "It caps predictive power; forecasting is the planned next tier."),
    ("How would the model be trained (future)?", "Historical headway/incident data → short-horizon headway forecast; validate on the replay simulator before it can influence commands.", "No labelled dataset pipeline exists yet."),
    ("How do you measure intervention effectiveness?", "Re-measure CV/EWT after a hold; the reactive rule’s ‘recovered’ flag closes incidents; pilot KPIs track it.", "No formal A/B or counterfactual yet."),
    ("How do you roll back a bad intervention?", "Commands have TTLs, supersede transitions, and kill switches per route; drivers can answer ‘unsafe’.", "Rollback is human-mediated, not automatic."),
    ("Why two normalizers?", "Web needs coordinates; the seeder discards them and keeps parked buses — opposite requirements.", "The IST fix is duplicated and must be changed in lockstep."),
    ("What’s the blast radius of the webhook secret leaking?", "An attacker could forge command-outcome events; mitigated by size cap, timing-safe compare, and idempotency.", "Rotate both ends together; a mismatch drops all events."),
    ("Is the ‘AI’ actually running in a given deploy?", "Only if GPS_POLL_ENABLED is on and the estimator is wired; off by default.", "This is the single most important thing to verify before a pilot."),
    ("How is the map affordable at 9.5k vehicles?", "One canvas, Path2D per colour, local Mercator projection, O(visible) redraw.", "No clustering — dense corridors render dense by design."),
    ("What if two dispatchers act at once?", "Commands are keyed by dispatcherActionId (uuid) and route-direction; kill switch + rollout gate apply.", "Optimistic UI could briefly show an unconfirmed action."),
    ("How do you keep the two DBs consistent?", "You don’t share them; the web reflects control-service state via REST + webhooks, never writes.", "Eventual consistency; webhook delivery must be reliable."),
    ("Why HS256 for ops and Supabase for enterprise?", "Two distinct user populations and lifecycles; ops roles map to control-service’s vocabulary.", "Two auth systems to maintain."),
    ("What’s the detection latency?", "required_samples × HEADWAY_COMPUTE_INTERVAL_MS × ceil(eligible/batch).", "Raising the interval multiplies time-to-detection."),
    ("How are invalid coordinates handled?", "Rejected in the normalizer (range + null-island); counted in rejectedRecordCount.", "Surfaced in the diagnostics drawer."),
    ("What observability exists?", "Sentry spans (mpc.solve), pino logs, liveDiagnostics, /healthz+/readyz.", "No cross-boundary tracing or web RUM yet."),
    ("How do you prevent a bad batch blinding the fleet?", "Per-event failure isolation in ingestPositionEvents; one bad fix doesn’t reject 664 good ones.", "Unrecognized (non-SQLSTATE) errors fail the batch on purpose."),
    ("What’s the plan for occupancy data?", "Occupancy MPC already accepts it; today it assumes 0.5 when unknown.", "No live occupancy sensor integration yet."),
    ("Biggest risk to a pilot?", "Shipping with ingestion disabled, or webhook/upstream failures dropping data silently without alerts.", "Both are addressed in §26 Critical."),
]
for i, (q, a, lim) in enumerate(qa, 1):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(1)
    r = p.add_run(f"Q{i}. {q}"); r.bold = True; r.font.size = Pt(10)
    rich([("Answer: ", "b"), (a, "")], after=1)
    p2 = doc.add_paragraph(); p2.paragraph_format.space_after = Pt(6)
    r2 = p2.add_run("Limitation to acknowledge: " + lim); r2.italic = True; r2.font.size = Pt(9); r2.font.color.rgb = MUTED

page_break()

# =====================================================================================
# 34. PRESENTATION SCRIPT
# =====================================================================================
h1("34. “How to Explain the Project” Script")
h3("30-second explanation")
para("“Olympuss AI keeps UPSRTC buses evenly spaced. We ingest live GPS, detect when two buses "
     "are bunching, and recommend the smallest fix — usually holding a bus a few seconds — which "
     "a dispatcher approves and a driver confirms. It’s two systems: a Next.js control dashboard "
     "and an always-on control-service that does the state estimation and the control maths.”",
     italic=True)
h3("2-minute explanation")
para("Add: the data flow (server proxy → normalize → canvas map of ~9.5k buses), the honest "
     "degradation ladder, and the distinction between the client-side teaching simulation and "
     "the real server-side pipeline (Kalman + headway + MPC). Emphasize deterministic, "
     "explainable control laws with a human in the loop.", italic=True)
h3("5-minute architecture explanation")
para("Walk Figure 1 (two systems, isolated DBs), Figure 5 (GPS data flow), and Figure 7 "
     "(intervention/recovery loop). Land the boundary decision: the web never writes to the "
     "control-service DB; they talk over REST + signed webhooks.", italic=True)
h3("15-minute technical walkthrough")
para("Follow §32 steps 1–9: package.jsons → middleware → live route → normalizer → FleetMap → "
     "estimator → headway/bunching → MPC solver. Use Figures 3, 6, 8, 11.", italic=True)
h3("Deep technical walkthrough")
para("Add §13 formulas (two-way hold, Kalman, EWT), §20 scalability, and §26 recommendations. "
     "Be explicit about what is PROTOTYPE/PLANNED (predictive tier) and the ingestion-enablement "
     "gate, so the reviewer trusts your honesty.", italic=True)
callout("OPENING LINE",
        "“Let me first show you the high-level architecture (Figure 1), then trace one live GPS "
        "fix all the way from the UPSRTC feed to a hold recommendation on a driver’s phone.”",
        fill="DCFCE7", edge_label_color=TEAL)

# =====================================================================================
# 35. APPENDIX
# =====================================================================================
h1("35. Appendix")
h3("A. Key source files by concern")
table(
    ["Concern", "Open these files"],
    [
        ["Entry / auth", "`src/middleware.ts`, `src/app/layout.tsx`, `src/lib/auth/rbac/*`, `src/lib/supabase/*`"],
        ["Live GPS", "`src/app/api/upsrtc/live/route.ts`, `src/lib/upsrtc/{client,normalizer,cache,fixtureFallback}.ts`, `src/hooks/useLiveFleet.ts`"],
        ["Map", "`src/components/map/FleetMap.tsx`, `fleetCanvasLayer.ts`, `src/lib/maps/loader.ts`"],
        ["State", "`src/stores/copilotStore.ts`, `src/models/canonical.ts`"],
        ["Bunching (sim)", "`src/lib/bunching/{math,config,simulation,controller}.ts`, `src/components/bunching/*`"],
        ["State estimation", "`control-service/src/state-estimation/{estimator,kalmanFilter,ordering,mapMatching,confidence}.ts`"],
        ["Headway/bunching (prod)", "`control-service/src/headway/{metrics,bunching,service}.ts`"],
        ["MPC", "`control-service/src/mpc/{solver,twoWayHold,selfEqualizing,terminalDispatch,occupancyMpc,safety}.ts`"],
        ["Ingestion/scheduler", "`control-service/src/ingestion/pipeline.ts`, `scheduler/{gpsPoll,headwayCompute,jobs}.ts`"],
        ["Integration", "`src/lib/controlService/client.ts`, `src/app/api/control-service/webhook/route.ts`, `control-service/src/webhooks/*`"],
        ["Copilot (LLM)", "`src/lib/copilot/*`, `src/app/api/ops/control-room/copilot/*`"],
    ],
    widths=[1.6, 4.7], fs=7.9,
    caption="Table 20 — Reading map by concern."
)
h3("B. Reference docs in the repo")
para("docs/Olympuss_AI_UPSRTC_Bus_Bunching_Technical_Blueprint.(md|docx), "
     "docs/CONTROL_SERVICE_INTEGRATION.md, docs/CONTROL_SERVICE_DEPLOYMENT.md, "
     "docs/API_DISCOVERY.md, docs/ARCHITECTURE.md, docs/PRODUCTION_ROADMAP.md, "
     "docs/olympuss/{OVERVIEW,AUTH,RBAC,COPILOT,DEPLOYMENT,BASELINE}.md.")
h3("C. Method note")
para("Every claim in this document was derived by reading the cited source files directly and "
     "tracing imports/callers along the runtime path. Where the repository’s own comments state "
     "measured facts (e.g. the +5.44h timestamp skew, the 5.1s marker-blocking measurement, the "
     "~665/9,261 live-vehicle split), those figures are quoted as the code records them. No "
     "functionality was invented; anything not found is labelled as such, and simulated / "
     "hard-coded / prototype / planned components are labelled accordingly.")

# =====================================================================================
# SAVE
# =====================================================================================
doc.save(OUT)
print("WROTE", OUT)
print("pages: run `open` in Word; ~", len(doc.element.findall('.//' + qn('w:p'))), "paragraphs")

