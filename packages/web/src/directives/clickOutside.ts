/**
 * Click Outside Directive
 * Detects clicks outside of an element
 *
 * `binding.value` may be the handler itself, or `{ handler, ignore }` where
 * `ignore` is one or more elements (e.g. the button that opens a teleported
 * panel) that should not count as "outside" — otherwise a click on that
 * trigger both closes the panel via this directive and reopens it via the
 * trigger's own click handler in the same event.
 */

import type { DirectiveBinding } from 'vue'

type ClickOutsideHandler = (event: Event) => void
type ClickOutsideValue =
  | ClickOutsideHandler
  | { handler: ClickOutsideHandler; ignore?: (HTMLElement | null)[] }

interface ClickOutsideElement extends HTMLElement {
  clickOutsideEvent?: (event: Event) => void
}

export const clickOutside = {
  mounted(el: ClickOutsideElement, binding: DirectiveBinding<ClickOutsideValue>) {
    const { handler, ignore } =
      typeof binding.value === 'function' ? { handler: binding.value, ignore: [] } : binding.value

    el.clickOutsideEvent = (event: Event) => {
      const target = event.target as Node
      if (el === target || el.contains(target)) return
      if (ignore?.some((node) => node !== null && (node === target || node.contains(target)))) return

      handler(event)
    }
    document.addEventListener('click', el.clickOutsideEvent)
  },
  unmounted(el: ClickOutsideElement) {
    if (el.clickOutsideEvent) {
      document.removeEventListener('click', el.clickOutsideEvent)
      delete el.clickOutsideEvent
    }
  }
}
