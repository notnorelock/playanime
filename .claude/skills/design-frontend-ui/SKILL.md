---
name: design-frontend-ui
description: PlayAnime's actual visual design system — color tokens, the glassmorphism tiers, component variants, spacing/radius conventions, and responsive patterns — verified against the real CSS and UI primitives, not guessed. Use for any frontend work that involves layout, color, or a new/modified UI element, not only when explicitly asked to "design" something.
---

# PlayAnime's frontend design system

This is a dark, glassmorphic, orange-branded UI. Everything below is verified
against `packages/web/src/styles/main.css` and the actual `components/ui/*`
primitives — not aspirational, what's really there. If a class mentioned
here doesn't visually do anything, it may have rotted (this has happened
before — see "Known dead classes" at the end).

## Color tokens

Defined in `@theme` in `main.css`, consumed as Tailwind utilities
(`text-primary`, `bg-dark-800`, etc.):

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#f47521` (orange) | The brand color. Anything that should read as "this app confirming/highlighting something" — active nav state, primary buttons, a "connected"/"verified" indicator. |
| `--color-primary-hover` | `#e86810` | Hover state for primary-colored elements. |
| `--color-dark-900` | `#0a0a0f` | Page background (`html`, `body`, `#app`). |
| `--color-dark-800` | `#131318` | `Card` `flat` variant background. |
| `--color-dark-700` | `#1a1a22` | `Card` `default` variant, `Button` `secondary` variant. |
| `--color-accent-blue` / `-purple` / `-cyan` / `-pink` | `#3b82f6` / `#a855f7` / `#06b6d4` / `#ec4899` | Status/category badges only — release-status pills, verified checkmarks, format tags. **Not** for brand confirmation (see next point). |
| `--color-text-primary` / `-secondary` / `-muted` | white / `#d1d5db` / `#9ca3af` | Text hierarchy — primary for headings/important content, secondary for body copy, muted for metadata/timestamps/placeholders. |

**A recurring real mistake**: reaching for `accent-cyan` (or another neutral
accent) for something that should confirm *this app's own* action — e.g. a
"Discord connected" success label originally used `accent-cyan`, which read
as clashing next to Discord's own blurple brand icon. A confirmation/success
indicator that isn't itself representing a third-party brand should be
`text-primary`, not a neutral accent color. A third-party service's own logo
or button (Discord, Google, ...) legitimately keeps *that service's* brand
color for itself.

## Glassmorphism — four tiers, pick by context

```css
.glass-light   { background: rgba(255,255,255,0.05); backdrop-filter: blur(8px);  }
.glass-medium  { background: rgba(255,255,255,0.10); backdrop-filter: blur(16px); }
.glass-strong  { background: rgba(255,255,255,0.15); backdrop-filter: blur(24px); }
.bg-glass-medium { background: rgba(255,255,255,0.08); backdrop-filter: blur(16px); } /* for compositing onto something that already has its own bg-* */
```

- `glass-light` — a nested row/item *inside* an already-glass panel (e.g. a
  list row inside a `Card`).
- `glass-medium` — the default panel surface (`Card`'s `glass` variant, most
  standalone widgets).
- `glass-strong` — an element that needs to visually separate from
  content behind it more assertively: the fixed sidebar, a flyout/dropdown
  menu, a modal.

**Backdrop-filter only blurs what's actually painted behind the element in
the same compositing context.** Two real bugs from this exact mistake: (1)
nesting a `glass-*` element inside another `glass-*` element makes the inner
one blur the *outer* element's already-blurred background instead of the
page — it reads as flat/gray instead of glassy. (2) A `Teleport`'d panel
(a flyout menu anchored to a sidebar button, say) needs to actually leave
the DOM subtree of any blurred ancestor to composite against real page
content — see how the account flyout in `Sidebar.vue` is teleported to
`body` specifically for this reason, with its own `position: fixed`
coordinates rather than being a normal nested child.

## Component primitives (`components/ui/`)

- **`Button`** — `variant`: `primary` (solid orange) / `secondary` (dark
  flat with border) / `ghost` (transparent, for a low-emphasis action like
  "cancel") / `glass` (glassmorphic, for an action sitting on a glass
  panel). `size`: `sm`/`md`/`lg`. `icon` (square padding, for an icon-only
  button). `block` (full width).
- **`Card`** — `variant`: `default` (flat dark + border, the "solid" look)
  / `glass` (the glassmorphic look — most content panels use this) / `flat`
  (bare dark background, no border, for a card nested inside another card
  where a second border/glass layer would be visual noise). `hover`
  (defaults true — adds a shadow lift). `padding`: `none`/`sm`/`md`/`lg`.
- **`Input`** / **`Textarea`** / **`Select`** — `variant`: `default` /
  `glass` / `outline`. Nearly everything in this app uses `variant="glass"`
  for form fields sitting on a glass card — it's the de facto standard, not
  really an alternative choice.
- Border radius convention: `rounded-lg` for interactive controls
  (buttons, inputs, list rows), `rounded-xl` for `Card` containers,
  `rounded-full` for avatars, pills/badges, and circular icon buttons.

## Loading, empty, and error states — the three-state shape

Every data-fetching feature component in this app follows the same shape,
in this order:

1. **Loading**: an `.animate-pulse` skeleton shaped roughly like the real
   content (a gray block the size of the text/image it's replacing) — never
   a spinner for a content area, only for a button mid-action.
2. **Error**: a message in a glass panel with a retry affordance where it
   makes sense — never a blank/silent failure.
3. **Empty**: a specific, friendly message (`library.empty`, a "no comments
   yet" line), not a generic "no data."

Look at `ProfileStats.vue`, `AnimeRating.vue`, or `ProfileActivity.vue` for
the template structure to copy.

## Spacing, layout, typography

- Standard Tailwind spacing scale, no custom overrides — `gap-3`/`gap-4`
  between related elements, `p-4`/`p-6` card padding, `mb-6`/`mb-8` between
  major page sections.
- Font: Inter (loaded via Google Fonts `@import` in `main.css`), the only
  typeface in the app.
- Standard Tailwind breakpoints (`sm`/`md`/`lg`/`xl`), no custom breakpoint
  scale. `AnimeGrid`'s `columns` prop (`{ default, md, lg, xl }`) is the
  established pattern for a responsive card grid — reuse it rather than
  writing a new `grid-cols-*` responsive stack from scratch for another
  card-grid feature.
- The sidebar is a fixed, icon-only `w-16` rail (`glass-strong`) on `md:`
  and up; below that, navigation collapses to a different pattern — check
  `Sidebar.vue` / `useNavigation.ts` before assuming desktop nav patterns
  apply at phone width.
- `transition-smooth` (`all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`) is the
  standard transition for hover/state changes — use it instead of a raw
  `transition-all duration-300` so easing stays consistent across the app.

## Icons

`lucide-vue-next` for everything except third-party brand marks it doesn't
carry (Discord, etc.) — those get a small hand-written SVG component under
`components/icons/` (see `DiscordIcon.vue`), not a whole icon-pack
dependency pulled in for one glyph.

## Known dead classes (fixed, but worth knowing the history)

`glow-primary-hover`, `liquid-reflection`, and `shadow-glass` appeared in
`Button.vue` and `Card.vue` as class names with no matching Tailwind
utility or custom CSS rule anywhere in the codebase — they silently did
nothing. Removed as part of writing this doc. If a similarly-named class
shows up again in new code, check `main.css`'s custom utility section
before assuming Tailwind resolves it; a plausible-sounding class name isn't
proof it's defined.
