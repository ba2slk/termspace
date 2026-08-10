/**
 * Copy and paste inside chrome's own text fields.
 *
 * Only mac needs this. There the Cmd+C/V accelerators belong to the application
 * menu, so the browser's built-in edit commands never run for them and a
 * settings field would otherwise be unable to copy or paste at all.
 */

/** A field the app types into. The terminal is not one of these. */
export type TextField = HTMLInputElement | HTMLTextAreaElement

/** Input types that carry a caret. Buttons, ranges and checkboxes do not. */
const SELECTABLE = new Set(['text', 'search', 'url', 'tel', 'password', 'email'])

export function asTextField(el: Element | null): TextField | null {
  if (el instanceof HTMLTextAreaElement) return el
  if (el instanceof HTMLInputElement && SELECTABLE.has(el.type)) return el
  return null
}

/** What Cmd+C would take out of a field. Empty when nothing is selected. */
export function selectedText(value: string, start: number, end: number): string {
  return value.slice(Math.min(start, end), Math.max(start, end))
}

/** The field after `text` is typed over its selection, and where the caret lands. */
export function withPasted(
  value: string,
  start: number,
  end: number,
  text: string,
): { readonly value: string; readonly caret: number } {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + text.length,
  }
}
