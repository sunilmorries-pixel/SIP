# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** SIP Insights
**Generated:** 2026-07-04 20:15:33 · **Rebranded to Tricog:** v3.0 (2026-07-04) · **Updated:** 2026-07-07
**Category:** Healthcare Device Fleet / Operations Dashboard

> **SOURCE OF TRUTH:** the shipped tokens live in `src/client/Styles.html` `:root` /
> `[data-theme]`. This file records the **Tricog brand** (tricog.com). The original
> generated brief (blue `#1E40AF` + amber, Fira Code/Sans) was superseded by the
> Tricog rebrand on day one — the values below reflect what actually ships.

---

## Global Rules

### Color Palette (Tricog — dark theme `:root`)

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary / brand (CTA, active nav, logo) | `#E5344F` (red) | `--primary` |
| Secondary (data viz) | `#2E9BD6` (blue) | `--secondary` |
| Accent (data viz) | `#04E0B8` (teal) | `--accent` |
| Background | `#04182C` / `#072238` (navy) | `--bg-0` / `--bg-1` |
| Surface | `#0A2340` / `#0E2C48` | `--surface-solid` / `--surface-2` |
| Foreground / text | `#EAF1F8` / `#A2B4C8` / `#869AB2` | `--text-1/2/3` |
| Border | `rgba(46,155,214,.16 / .34)` | `--border` / `--border-strong` |
| OK / Warn / Danger | `#2FD39B` / `#F5B301` / `#FF6262` | `--ok` / `--warn` / `--danger` |

**Brand rule:** red = brand identity (logo, primary CTAs, active tab); blue + teal carry
the data visualization. A full **light theme** is defined under `[data-theme="light"]` in Styles.html.

**Base brand colors** (from tricog.com): navy `#01294E`, red `#DA2C46`, blue `#0170B9`,
teal `#04FFC4` — the token values above are the theme-tuned variants.

### Typography

- **Heading & Body Font:** Lato (300/400/700/900) — tabular nums for numerals
- **Mood:** clinical, trustworthy, data-forward (healthcare device operations)
- **Google Fonts:** [Lato](https://fonts.google.com/specimen/Lato)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap');
```

### Spacing & Shape (shipped tokens — 4/8 scale)

| Token | Value | Usage |
|-------|-------|-------|
| `--gap` | `16px` | Grid/card gaps |
| `--pad` | `20px` | Card/panel padding |
| `--radius-sm` | `10px` | Chips, small controls |
| `--radius` | `16px` | Cards, inputs |
| `--radius-lg` | `20px` | Drawer, large surfaces |

### Shadow / Glow

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 8px 28px rgba(2,12,24,0.55)` (dark) / `0 8px 28px rgba(1,41,78,0.10)` (light) | Cards, drawer, modals |
| `--glow-primary` | `0 0 18px rgba(229,52,79,0.30)` | Active/brand emphasis |

### Motion tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--dur-fast` | `160ms` | Hover, small state changes |
| `--dur` | `240ms` | Panel/drawer transitions |
| `--ease-out` | `cubic-bezier(0.16,1,0.3,1)` | Entrances |

All motion is disabled under `prefers-reduced-motion`.

---

## Component Specs

> These are illustrative — the authoritative component CSS lives in `src/client/Styles.html`.

### Buttons

```css
/* Primary / brand button (Refresh, CTAs) */
.btn-primary {
  background: var(--primary);          /* Tricog red #E5344F */
  color: #fff;
  padding: 12px 20px;
  border-radius: var(--radius-sm);
  font-weight: 700;
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  cursor: pointer;
}
.btn-primary:hover { box-shadow: var(--glow-primary); transform: translateY(-1px); }
.btn-primary:active { transform: scale(0.97); }

/* Toggle / secondary button — active state uses brand */
.btn.is-active {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
}
```

### Cards

```css
.card {
  background: var(--surface);          /* translucent navy */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--pad);
  box-shadow: var(--shadow-card);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}
.card:hover { box-shadow: var(--shadow-card); transform: translateY(-3px); }  /* transform-only, no layout shift */
```

### Inputs

```css
.input {
  padding: 12px 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-size: 16px;                     /* ≥16px avoids iOS zoom */
  transition: border-color var(--dur-fast) var(--ease-out);
}
.input:focus {
  border-color: var(--secondary);      /* blue focus ring */
  outline: none;
  box-shadow: 0 0 0 3px rgba(46,155,214,0.25);
}
```

### Drawer / Modal

```css
.scrim { background: rgba(2,12,24,0.55); backdrop-filter: blur(4px); }  /* blur = dismissable bg */
.drawer {
  background: var(--surface-solid);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  box-shadow: var(--shadow-card);
  animation: drawer-in var(--dur) var(--ease-out);
}
```

---

## Style Guidelines

**Style:** Tricog-branded analytics — deep-navy surfaces with red brand accents. Full **light + dark themes** (toggle persisted; `[data-theme]` on root).

**Keywords:** clinical, trustworthy, data-forward, healthcare device ops, high contrast, navy + red, calm, precise

**Best For:** operations/monitoring dashboards, healthcare device fleets, executive rollups

**Key Effects:** subtle brand glow on active/CTA (`--glow-primary`), card hover-lift (transform-only), staggered panel/card entrance, drawer slide-in + scrim blur, count-up KPIs — all `prefers-reduced-motion` guarded

### Page Pattern

**Pattern Name:** Real-Time / Operations Landing

- **Conversion Strategy:** For ops/security/iot products. Demo or sandbox link. Trust signals.
- **CTA Placement:** Primary CTA in nav + After metrics
- **Section Order:** 1. Hero (product + live preview or status), 2. Key metrics/indicators, 3. How it works, 4. CTA (Start trial / Contact)

---

## Anti-Patterns (Do NOT Use)

- ❌ Slow updates
- ❌ No automation

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
