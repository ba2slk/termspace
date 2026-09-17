/**
 * One row of the pane jump list, and the line that stands in for no rows at all.
 * All of the list's copy is read here, so a row reads the same wherever it is built.
 */
import { t } from './i18n'
import type { JumpResult } from './pane-jump-model'

function span(className: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  return element
}

export function buildRow({ entry }: JumpResult, selected: boolean): HTMLLIElement {
  const row = document.createElement('li')
  row.className = selected ? 'pane-jump__row pane-jump__row--selected' : 'pane-jump__row'
  row.setAttribute('role', 'option')
  row.dataset.paneId = entry.id

  const name = span('pane-jump__name')
  if (entry.wants) name.append(span('pane-jump__dot'))
  name.append(document.createTextNode(entry.name))
  row.append(name)

  if (entry.focused) {
    const tag = span('pane-jump__tag')
    tag.textContent = t.paneJump.current
    row.append(tag)
  }

  const where = span('pane-jump__where')
  where.textContent = t.paneJump.column(entry.column)
  row.append(where)

  const sub = span('pane-jump__sub')
  // Program output; it reaches the panel as text and never as markup.
  sub.textContent = [entry.command, entry.windowTitle].filter((part) => part !== '').join(' · ')
  row.append(sub)
  return row
}

export function buildEmptyRow(): HTMLLIElement {
  const empty = document.createElement('li')
  empty.className = 'pane-jump__empty'
  empty.textContent = t.paneJump.empty
  return empty
}
