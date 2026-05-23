# ustowalliance.com — Extracted Design Tokens

Source: live `https://www.ustowalliance.com/` (homepage, light theme) and `/ai-is-here/`
(dark theme). React SPA, Tailwind v3.4.15 + critical-CSS `:root` variables injected inline.

## Brand palette (LIGHT — homepage / public site)

| Role | Value | Notes |
|------|-------|-------|
| Primary brand (deep navy) | `#05162B` | `--primary-bg`, hero/dark sections |
| Hero gradient | `linear-gradient(135deg, #05162B 0%, #00174b 100%)` | `--hero-gradient` |
| Secondary / primary CTA (blue) | `#2563EB` | `--secondary-cta`, most-used color |
| CTA hover (dark blue) | `#003ea8` | `--secondary-cta-dark` (also `#0053db`) |
| Accent green (verified/success) | `#4ade80` | "verified carriers" green |
| Accent amber/gold | `#f59e0b` (also `#fbbf24` light, `#d97706` dark) | gradients, AI accent |
| Accent purple | `#7c3aed` | occasional accent |
| Danger / red | `#ef4444` | |

### Surfaces (light)
| Role | Value |
|------|-------|
| Page background | `#faf8ff` (lavender-white); fallback `#F8FAFC` |
| Card / lowest surface | `#ffffff` (`--surface-container-lowest`) |
| Container low | `#f2f3ff` |
| Container | `#eaedff` |
| Container high | `#e3e7ff` |
| Glass (navbar) bg | `rgba(250, 248, 255, 0.8)` + `backdrop-filter: blur(8px)` |

### Text (light)
| Role | Value |
|------|-------|
| Text primary | `#151b2d` (fallback `#0F172A`) |
| Text secondary | `#44474d` |
| Border / ghost divider | `rgba(197, 198, 205, 0.15)` (`--border-ghost`) |

## Brand palette (DARK — /ai-is-here/, "aih-" tokens)

| Role | Value |
|------|-------|
| Background | `#000e23` (`--aih-bg`) |
| Card surface | `#0a1f3d` (`--aih-card`) |
| Blue | `#3b82f6` (`--aih-blue`); bright `#2563eb`; light `#60a5fa` |
| Amber | `#fbbf24` |
| Green | `#34d399` |
| Red | `#ef4444` |
| Text | `#e2e8f0`; bright `#ffffff`; dim `#94a3b8` |
| Border | `rgba(59,130,246,0.18)`; strong `rgba(59,130,246,0.45)` |

## Typography

- **Display / headings:** `'Manrope', 'Inter', system-ui, sans-serif` — weights 400, 700, 800
- **Body:** `'Inter', system-ui, sans-serif` — weights 400, 500, 600, 700, 800
- **Label / eyebrow:** `'Work Sans', system-ui, sans-serif` — weights 500, 600
- **Mono:** none custom (uses `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`)
- Google Fonts URL: `family=Manrope:wght@400;700;800&family=Inter:wght@400;500;600;700;800&family=Work+Sans:wght@500;600`
- Hero title size: `3.5rem` desktop → `2.5rem` → `2rem` (line-height 1.1) responsive
- Hero feature value: `2rem`

## Radius scale
- `--radius: 12px` (primary, cards/buttons)
- `--radius-xl: 0.75rem`
- Tailwind reset fallback `--radius: 0.375rem`

## Shadow scale
- Ambient (cards): `--shadow-ambient: 0 4px 40px rgba(21, 27, 45, 0.08)`
- Tailwind md/lg/xl in use: `0 4px 6px -1px rgba(0,0,0,.1)…`, `0 10px 15px -3px…`, `0 20px 25px -5px…`

## Layout
- Container max-width: **1400px**
- Header (`.navbar`): `min-height: 70px`, `padding: 1rem 2rem`, glass bg `rgba(255,255,255,0.8)` + `blur(8px)`, logo left / nav center / actions right.
- Breakpoints: 768 / 1024 (px) responsive overrides.

## Buttons (observed)
- Primary CTA: blue `#2563EB` fill, white text, radius 12px, hover → `#003ea8`.
- Ghost: transparent, white text on dark (`.btn-ghost`), hover → `#2563EB`.
- Outline: bordered, full-width on mobile, `box-sizing: border-box`.
