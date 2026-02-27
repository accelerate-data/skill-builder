# Brand Alignment Audit

> **Status: In progress.** CSS variables and semantic color system applied (see `.claude/rules/frontend-design.md`). Typography and remaining items below are pending.

Comparing current app UI (`app/src/styles/globals.css`, `public/`) against Accelerate Data brand guidelines (`/branding/gamma-theme.md`).

---

## 1. Colors

### Primary Color

| | Value | Appearance |
|---|---|---|
| **Current** | `oklch(0.530 0.095 195)` | Darker teal/cyan (~#007ea0) |
| **Brand: Pacific** | `#00b4d8` | Brighter cyan |

Action: Update `--primary` to match Pacific `#00b4d8` (~`oklch(0.680 0.120 210)`).

### Ring / Focus Indicator

| | Value | Appearance |
|---|---|---|
| **Current** | `oklch(0.600 0.120 50)` | Yellow/orange — **off-brand** |
| **Brand: Arctic** | `#90e0ef` | Light cyan |

Action: Replace `--ring` with Arctic `#90e0ef` (~`oklch(0.870 0.065 208)`).

### Background

| | Value | Appearance |
|---|---|---|
| **Current** | `oklch(0.984 0.003 90)` | Near-white with warm tint |
| **Brand: Pearl** | `#f2f2f2` | Cool neutral gray |

Action: Update `--background` to Pearl `#f2f2f2` (~`oklch(0.956 0.000 0)`).

### Foreground / Text

| | Value | Appearance |
|---|---|---|
| **Current** | `oklch(0.185 0.008 260)` | Very dark with slight blue |
| **Brand: Smoke** | `#171c21` | Near-black |

Close match, but headings should use Navy `#03045e` — currently no heading-specific color variable is defined.

Action: Add `--heading-foreground: #03045e` and apply it to `h1`–`h3` headings.

### Missing Brand Colors

These brand colors have no equivalent in the current CSS variables:

| Brand Token | Hex | Use Case |
|---|---|---|
| Seafoam | `#00dd92` | Success states (maps to chat result messages) |
| Navy | `#03045e` | Headings, depth, stability |
| Ocean | `#0077b6` | Link default |
| Pacific | `#00b4d8` | Link hover |

Action: Define these as CSS variables and wire Seafoam into the `--chat-result` background, Ocean/Pacific into `a` link colors.

### Summary of Color Changes

```css
/* Current → Brand */
--primary:        oklch(0.530 0.095 195)  →  #00b4d8  (Pacific)
--ring:           oklch(0.600 0.120 50)   →  #90e0ef  (Arctic)
--background:     oklch(0.984 0.003 90)   →  #f2f2f2  (Pearl)
--foreground:     oklch(0.185 0.008 260)  →  #171c21  (Smoke) — minor

/* Add */
--color-navy:     #03045e
--color-seafoam:  #00dd92
--color-ocean:    #0077b6
--color-pacific:  #00b4d8
--color-arctic:   #90e0ef
--color-pearl:    #f2f2f2
```

---

## 2. Typography

| | Current | Brand |
|---|---|---|
| **UI Font** | System stack (`-apple-system, BlinkMacSystemFont, …`) | **Inter** |
| **Mono Font** | JetBrains Mono Variable | (no brand spec — keep as-is) |

Action: Add Inter via Google Fonts or local import, set as `--font-sans`. Since the app is Tauri (bundled), bundle `inter-variable.woff2` in `public/fonts/` rather than loading from a CDN.

---

## 3. Logo

| | Current | Brand |
|---|---|---|
| **App icon** | `public/icon-256.png` (custom pixel icon) | `full_logo.svg`, `icon.svg` — SVG format |
| **Favicon** | `public/ad-favicon.svg` (already has "ad" initials) | `icon.svg` from `/branding/logo/Light/` |
| **Dark variant** | None | `/branding/logo/Dark/` versions available |

Brand logo assets are available at:
**https://github.com/accelerate-data/vd-gtm/tree/main/branding/logo**

Light and Dark variants are both present (`/Light/`, `/Dark/`), each with `full_logo.svg`, `full_logo.png`, `icon.svg`, `icon.png`, `icon_name.svg`, `icon_name.png`.

Action:

1. Replace `public/icon-256.png` with `icon.png` from the Light variant.
2. Update `public/ad-favicon.svg` to use `icon.svg` from the Light variant.
3. Add the Dark variant `full_logo.svg` for the dark-theme sidebar/header.
4. Replace Tauri app icons in `src-tauri/icons/` with exports of `icon.svg` at required sizes (32, 64, 128, 256 px).

---

## 4. Component Details

### Buttons

Brand spec: Pacific (`#00b4d8`) background, white text.
Current `--primary` is darker than Pacific — will be fixed by the color change above.

### Cards

Brand spec: Arctic (`#90e0ef`) thin border, medium shadow.
Current `--border` is `oklch(0.910 0.006 85)` (warm gray) — should move to Arctic.

Action: Update `--border` to `#90e0ef` (Arctic) for cards specifically, or add a `--card-border` variable.

### Links

Currently no explicit link color override — links inherit from browser defaults or primary.
Action: Set `a { color: #0077b6; } a:hover { color: #00b4d8; }` in `globals.css`.

---

## 5. Priority Order

| Priority | Change | Files |
|---|---|---|
| High | Update primary + ring color to Pacific / Arctic | `app/src/styles/globals.css` |
| High | Replace app logo with brand SVG | `public/icon-256.png`, `public/ad-favicon.svg` |
| High | Replace Tauri app icons | `src-tauri/icons/` |
| Medium | Add Inter font | `public/fonts/`, `globals.css`, `index.html` |
| Medium | Add Navy heading color + apply to h1–h3 | `globals.css` |
| Medium | Add Seafoam to success/result states | `globals.css` |
| Low | Update background to Pearl | `globals.css` |
| Low | Update border to Arctic, link colors to Ocean/Pacific | `globals.css` |
