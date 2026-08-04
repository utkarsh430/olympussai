# Olympuss AI — Unified Application Overview

One Next.js application serving the public Olympuss AI landing experience, project
authentication, and the protected UPSRTC AI Copilot dashboard — a single
deployment, one domain, one auth system.

## Routes

| URL | Access | What |
| --- | --- | --- |
| `/` | Public | Cinematic Olympuss AI landing (WebGL, 5 scenes) |
| `/login` | Public | Project authentication |
| `/project/upsrtc` | Protected | UPSRTC AI Copilot dashboard |
| `/project/upsrtc/*` | Protected | Future nested dashboard routes |
| `/api/auth/{login,logout,session}` | Mixed | Authentication endpoints |
| `/api/upsrtc/{live,schedule}` | Protected | UPSRTC data proxies (session-gated) |
| `/robots.txt`, `/sitemap.xml` | Public | Crawler policy / homepage only |

## Source layout

```
src/
├── app/
│   ├── layout.tsx                 # root: neutral base, dashboard font vars, metadata
│   ├── icon.png / apple-icon.png  # favicons (generated from the logo)
│   ├── robots.ts / sitemap.ts
│   ├── (public)/
│   │   ├── layout.tsx             # Olympuss fonts + .ol-scope tokens (landing/login only)
│   │   ├── olympuss.css           # design system (scoped)
│   │   ├── page.tsx               # landing composition
│   │   └── login/page.tsx
│   ├── (protected)/
│   │   └── project/upsrtc/
│   │       ├── layout.tsx         # session gate + scoped dashboard shell
│   │       └── page.tsx           # <CommandCenter/> (migrated dashboard)
│   └── api/{auth,upsrtc}/…
├── middleware.ts                  # edge auth (redirect pages / 401 apis)
├── components/{landing,auth,upsrtc,shared,command-center,…}
├── lib/{auth,upsrtc,…}
└── three/                         # WebGL scene (canvas, scene graph, quality, state)
```

## Key architectural decisions

- **Base application:** the existing UPSRTC dashboard was used as the
  base and the landing + auth built around it — the dashboard's proven
  server-proxy/normalizer/fallback code was preserved rather than rewritten.
- **Route groups** keep the public landing, auth, and protected dashboard cleanly
  separated while sharing one deployment.
- **Style + font isolation:** Olympuss gold/serif tokens and fonts load only under
  the public route group (`.ol-scope`); the dashboard keeps its cyan HUD identity
  and never downloads the landing fonts. The dashboard's fixed-viewport styling
  moved off the global `<body>` onto a scoped shell so the landing can scroll.
- **Code splitting:** the three.js bundle is dynamically imported and absent from
  the dashboard route; the landing route does not load any UPSRTC code or data.
- **Auth defence in depth:** middleware + protected-layout gate + per-API check,
  all verifying the session independently. See [`AUTH.md`](./AUTH.md).

## WebGL experience (`src/three`)

One fixed `<Canvas>` with a single continuously-evolving scene. Scroll progress
(GSAP ScrollTrigger) and pointer are written into a plain module singleton read
each frame — the animation loop never re-renders React. A quality tier chosen
from device capability (not viewport width) scales particle counts, DPR and
effects; `prefers-reduced-motion` or missing WebGL falls back to a static CSS
backdrop (a deliberate static edition, not a broken one). The loop pauses when
the tab is hidden.

## Positioning

Olympuss AI is presented as a digital laboratory / research space — no pricing,
sales, client logos, testimonials, fake stats, or claims of customers. The
dashboard is a prototype (clearly labelled) and is not presented as an official
UPSRTC deployment.
