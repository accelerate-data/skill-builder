# Brand Alignment Audit

> **Status: Mostly complete.** All color variables, typography, and logo assets are applied. One low-priority item (card border) remains open.

Comparing current app UI (`app/src/styles/globals.css`, `public/`) against Accelerate Data brand guidelines (`/branding/gamma-theme.md`).

---

## 1. Colors ✅ Complete

All color changes are applied in `app/src/styles/globals.css`.

| Item | Status | Implemented value |
|---|---|---|
| `--primary` → Pacific | ✅ Done | `oklch(0.680 0.120 210)` |
| `--ring` → Arctic | ✅ Done | `oklch(0.870 0.065 208)` |
| `--background` → Pearl | ✅ Done | `oklch(0.956 0 0)` |
| `--heading-foreground` → Navy + applied to h1–h3 | ✅ Done | `oklch(0.215 0.105 265)` |
| Brand palette CSS variables | ✅ Done | `--color-navy/seafoam/ocean/pacific/arctic/pearl/violet` |
| Link colors (Ocean / Pacific hover) | ✅ Done | `a { color: var(--color-ocean) }` |
| Dark mode brand palette | ✅ Done | All variables re-tuned for dark theme |

Cards border (`--border`) is still `oklch(0.910 0.006 85)` — not moved to Arctic. Decided to keep warm gray for subtler card outlines; no action needed unless the design direction changes.

---

## 2. Typography ✅ Complete

| | Current | Brand |
|---|---|---|
| **UI Font** | Inter Variable (bundled) | **Inter** |
| **Mono Font** | JetBrains Mono Variable | (no brand spec — keep as-is) |

Inter Variable is bundled at `public/fonts/inter-variable.woff2`, loaded via `@font-face`, and set as `--font-sans`. No CDN dependency.

---

## 3. Logo ✅ Complete

| | File | Status |
|---|---|---|
| **Light logo (full)** | `public/logo-light.svg` | ✅ Added |
| **Dark logo (full)** | `public/logo-dark.svg` | ✅ Added |
| **Light icon** | `public/icon-light-256.png` | ✅ Added |
| **Dark icon** | `public/icon-dark-256.png` | ✅ Added |
| **Favicon** | `public/ad-favicon.svg` | ✅ Present |
| **Tauri app icons** | `src-tauri/icons/` | ✅ Present (32, 64, 128 px + .ico/.icns) |

---

## 4. Component Details

### Buttons ✅

`--primary` is now Pacific (`oklch(0.680 0.120 210)`), white foreground. Brand-aligned.

### Cards ⚠️ Low priority

`--border` remains `oklch(0.910 0.006 85)` (warm gray) rather than Arctic. Current choice keeps card outlines subtle. Revisit if brand review flags this.

### Links ✅

`a { color: var(--color-ocean); }` and `a:hover { color: var(--color-pacific); }` applied in `globals.css`.

---

## 5. Remaining Items

| Priority | Change | Files | Status |
|---|---|---|---|
| Low | Update `--border` to Arctic for card outlines | `globals.css` | Open (intentionally deferred) |
