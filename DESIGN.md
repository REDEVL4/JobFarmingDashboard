# Orbital Mission Control & Cyber-Telemetry Design System

**Version:** 2.0  
**Domain:** High-Density Developer & AI Operations Command Center  
**Inspiration:** Linear, Vercel Geist, Palantir Foundry  
**Target Application:** Job Farming Dashboard & Executive Command Center

---

## 1. Core Visual Principles & Aesthetic

1. **High-Density Cyber-Telemetry:**
   Every pixel communicates operational state. Telemetry metrics, KPI counters, latency gauges, and pipeline funnels are laid out in high-contrast Bento grids with strict monospace numerical alignment.

2. **Specular Glass & Atmospheric Depth:**
   Multi-layered translucent surfaces create visual hierarchy above a deep obsidian void with atmospheric cobalt mesh illumination.

3. **Information Integrity & Strict Monospace Telemetry:**
   Zero ambiguity on metrics. All KPI values, timestamps, percentages, latency scores, and assessment evaluations enforce `tabular-nums` via `JetBrains Mono` / `Geist Mono`.

---

## 2. Color Palette & Semantic Surfaces

### A. Surfaces & Canvas
- **Primary Canvas:** Deep Obsidian (`#050811` / `rgba(5, 8, 17, 1)`) with radial cobalt mesh glow (`radial-gradient(ellipse at 50% 0%, rgba(37, 99, 235, 0.08) 0%, transparent 70%)`).
- **Cards Level 1 (Base Layer):** Translucent Midnight Slate (`rgba(15, 23, 42, 0.75)`) with `backdrop-filter: blur(16px)` and specular border `1px solid rgba(148, 163, 184, 0.14)`.
- **Cards Level 2 (Active / Hover / Drawer):** Elevated Midnight Slate (`rgba(30, 41, 59, 0.85)`) with `1px solid rgba(56, 189, 248, 0.45)` electric cyan border and inset top highlight `inset 0 1px 0 0 rgba(255, 255, 255, 0.08)`.

### B. Semantic Telemetry Accents
- **Primary & Interactive Filters:** Electric Cobalt (`#3B82F6`) to Cyan (`#06B6D4`) gradient.
- **Positive / Live / Recruiter Responses:** Neon Emerald (`#10B981`, background `rgba(16, 185, 129, 0.12)`, border `rgba(16, 185, 129, 0.28)`).
- **Urgent / Action Required / Assessments / Interviews:** Amber Pulse (`#F59E0B`, background `rgba(245, 158, 11, 0.14)`, border `rgba(245, 158, 11, 0.35)`).
- **Rejected / Closed:** Crimson Rose (`#F43F5E`, background `rgba(244, 63, 94, 0.12)`, border `rgba(244, 63, 94, 0.30)`).
- **Zero-Value KPIs (Empty / Inactive):** Dimmed Slate (`#64748B`) at 65% opacity until value > 0.
- **Electric Accent:** Neon Cyan (`#38BDF8` / `#22D3EE`).

---

## 3. Typography & Numerical Representation

- **UI Headings & Body:** `Inter`, `Geist Sans`, -apple-system, sans-serif.
  - Heading Tracking: `-0.02em` strictly for all section titles (`h1`, `h2`, `h3`).
  - Body Text: Clean readability at `13px` / `14px` (`leading-relaxed`).
- **Telemetry Counters & Monospace Data:** `JetBrains Mono`, `Geist Mono`, monospace.
  - Strict Enforcement: All KPI values, application counts, status rates (`%`), ISO dates, execution latency, and match scores use font-mono with `tabular-nums font-feature-settings: "tnum" on`.

---

## 4. Layout Architecture & Responsive Breakpoints

### A. Responsive AppShell Navigation
- **Desktop (`>= 1280px`):**
  - Collapsible left command rail (`240px` expanded / `64px` icon-only).
  - Cyan laser indicator (`2px` high-glow cyan bar) for active route.
  - 6 routes:
    1. Executive Dashboard (`/`)
    2. Applications Tracker (`/applications`)
    3. Gmail Monitoring (`/monitoring`)
    4. LinkedIn CRM (`/outreach`)
    5. MCP & Diagnostics (`/diagnostics`)
    6. OAuth Consent (`/oauth/consent`)
- **Mobile (`< 768px`):**
  - Sidebar collapses into a bottom frosted-glass 5-icon tactical dock (`backdrop-blur-xl bg-slate-950/80 border-t border-slate-800/80`).
  - Sticky compact top bar with live telemetry pill and avatar, ensuring zero horizontal overflow.
- **Top Telemetry Header:**
  - Global Search Input (`"Search companies, positions, contacts... [⌘K]"`).
  - Live Status Pill: `"● Supabase jobbot: Read-Only Preview"`.
  - Security Badge: `"Owner Guard Active"`.
  - Original site link, notification bell, user avatar (`"GN — Govardhan Reddy"`).
  - Collapsible top banner: `"Production Safety Policy Active — Connected to Supabase project mldtysploensrrulchdl (schema: jobbot). All dashboard operations are strictly read-only."`

### B. Executive Command Center (`/`)
- **Adaptive 10-Metric KPI Telemetry Grid:**
  - Top 5 Hero Telemetry Cards: Total Applications, Submitted, Recruiter Responses, Action Required, Interviews.
  - Secondary Status Pill Ribbon: Assessments, Rejected, Pending Decision, Under Review, Offers Received (horizontally swipeable on mobile/tablet).
  - All 10 items remain interactive links to `/applications?status=...`.
- **12-Column Bento Analytics:**
  - Column 1-4: Pipeline Funnel & Conversion Intelligence (horizontal progressive bars).
  - Column 5-8: Application & Response Volume (high-contrast dual-series gradient area chart with `Weekly | Monthly` segmented toggle).
  - Column 9-12: Status Distribution (hollow donut ring chart with centered monospaced `463` counter).

### C. Applications Tracker (`/applications`)
- **Sticky Filter & Command Bar:** Instant search, multi-select status dropdown, date range, match score sort, active filter tags, "Clear Filters" button.
- **Zero Clipped Titles:** 2-line smart wrap (`line-clamp-2 leading-snug`) + portal/location badges.
- **Mobile Card Switcher (`< 768px`):** Table rows transform into touch-friendly Tactical Cards with quick details, status badge, and match score gauge.
- **Slide-Over Dossier Drawer (`480px` desktop / full sheet on mobile):** Frosted glass drawer displaying complete dossier, activity timeline, evaluation notes, documents, and interview schedule.

### D. Operations & Telemetry Views
- **Gmail Monitoring (`/monitoring`):** Split-pane layout with parsed email stream + terminal parser inspection log.
- **LinkedIn CRM (`/outreach`):** Recruiter relationship manager with live message fetcher, auto-accept toggles, and signed document chips.
- **MCP & Diagnostics (`/diagnostics`):** Real-time infrastructure latency, Supabase `jobbot` verification, and edge function health.

