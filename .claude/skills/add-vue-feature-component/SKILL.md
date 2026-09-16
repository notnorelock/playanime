---
name: add-vue-feature-component
description: Build a new PlayAnime Vue feature component matching the existing glassmorphic design system, data-fetching pattern, and loading/error/empty state conventions. Use whenever a task requires a new .vue component under components/features/ or a new view under views/.
---

# Adding a Vue feature component

This codebase has a very consistent shape for a self-contained feature
component that fetches its own data (a rating widget, a linked-accounts
panel, a library status control, ...). Copy this shape rather than inventing
a new one — a component that doesn't match reads as visibly out of place
next to its siblings.

## The standard shape

1. **A top-of-file doc comment** explaining the component's *purpose and the
   non-obvious reasoning behind a design choice* — not what the template
   does line by line. Look at `LinkedAccounts.vue`, `TwoFactorSettings.vue`,
   or `LibraryStatusControl.vue` for the calibration: 3-8 lines, explains
   *why* this is its own component / why it fetches independently / why a
   particular edge case is handled the way it is.

2. **Own its own loading state**, not a prop passed down from a parent that
   already loaded something else — most of these components mount and fetch
   independently:

   ```ts
   const loading = ref(true)
   let controller: AbortController | null = null

   async function load(): Promise<void> {
     controller?.abort()
     const request = new AbortController()
     controller = request
     loading.value = true
     try {
       const result = await someApi.method(request.signal)
       if (request.signal.aborted) return
       data.value = result
     } catch (cause: unknown) {
       if (AbortError.is(cause)) return
       toast.error(translateError(cause))
     } finally {
       if (controller === request) {
         loading.value = false
         controller = null
       }
     }
   }

   onMounted(load)
   onUnmounted(() => controller?.abort())
   ```

   The `controller === request` check in `finally` matters: it stops a
   superseded request's `finally` block from clearing `loading` after a
   newer request already started.

3. **Read the design system, don't invent colors.** See the
   `design-frontend-ui` skill for the full, verified color tokens,
   glassmorphism tiers, and component-variant reference — don't reach for
   Tailwind's default palette or a plausible-sounding custom class name
   without checking it's actually one of this app's defined tokens first.

4. **Three-state render**: loading skeleton (a `.animate-pulse` placeholder
   matching the real content's rough shape, not a spinner) → error/empty
   state (a message, not a blank panel) → real content. Look at
   `ProfileStats.vue` or `AnimeRating.vue` for the template structure.

5. **Model conversion, not inline formatting.** If the component displays
   something that needs unit conversion, locale-title-picking, or null-
   coalescing shared with other components, that logic belongs in
   `packages/web/src/models/*.ts`, converted once, not duplicated per
   component. Check whether an existing model function already produces
   what you need before writing a new inline `computed()` for it.

6. **Locale strings via `useLocale()`'s `t()`**, added to both
   `en.json`/`pl.json` if they don't already exist — see the
   `add-locale-string` skill.

7. **Icons from `lucide-vue-next`.** For a brand mark lucide doesn't have
   (Discord, etc.), a small inline SVG component under
   `components/icons/` is the existing pattern (`DiscordIcon.vue`) — don't
   pull in a whole icon-pack dependency for one brand glyph.

## Wiring it in

- A feature component goes in `components/features/<Domain>/`
  (or flat under `components/features/` if it's not part of a larger
  domain group).
- A new route/page is a file under `src/views/` — the path *is* the route
  (file-based routing via `unplugin-vue-router`). Use `definePage({ meta:
  {...} })` at the top to set nav visibility (`showInNav`), auth requirement
  (`requiresAuth`), icon, and label — check `src/config/navigation.ts` and a
  few sibling views for the exact meta shape expected.
- If the component needs the current user, `useAuthStore()` from
  `@/store/auth` — never read a JWT or token directly, sessions are
  HttpOnly-cookie-based and invisible to script.

## Verification

- `bun run --filter '@playanime/web' typecheck`.
- If a dev server is already running (don't start one yourself — see the
  dev-server-restart-policy memory / `AGENTS.md`), load the actual page and
  check the three states render correctly, especially the loading skeleton's
  shape and the empty/error state's copy — a type-correct component can
  still look wrong until seen.
