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

/**
 * The field's text, with the letters the query landed on wrapped in a <b>.
 * Everything else is a text node: pane-supplied text never becomes markup.
 */
function appendMarked(parent: Node, text: string, positions: readonly number[] = []): void {
  let at = 0
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i] as number
    // Letters typed in a row share one <b>, so a run reads as one word.
    let end = start + 1
    while (positions[i + 1] === end) [end, i] = [end + 1, i + 1]
    if (start > at) parent.appendChild(document.createTextNode(text.slice(at, start)))
    const mark = document.createElement('b')
    mark.className = 'pane-jump__match'
    mark.textContent = text.slice(start, end)
    parent.appendChild(mark)
    at = end
  }
  if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)))
}

export function buildRow(result: JumpResult, selected: boolean): HTMLLIElement {
  const { entry } = result
  const row = document.createElement('li')
  row.className = selected ? 'pane-jump__row pane-jump__row--selected' : 'pane-jump__row'
  row.setAttribute('role', 'option')
  row.dataset.paneId = entry.id

  const name = span('pane-jump__name')
  if (entry.wants) name.append(span('pane-jump__dot'))
  appendMarked(name, entry.name, result.name?.positions)
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
  appendMarked(sub, entry.command, result.command?.positions)
  if (entry.windowTitle !== '') {
    // The separator only stands between two things; a title alone carries none.
    if (entry.command !== '') {
      const sep = span('pane-jump__sep')
      sep.textContent = ' · '
      sub.append(sep)
    }
    appendMarked(sub, entry.windowTitle, result.windowTitle?.positions)
  }
  row.append(sub)
  return row
}

export function buildEmptyRow(): HTMLLIElement {
  const empty = document.createElement('li')
  empty.className = 'pane-jump__empty'
  empty.textContent = t.paneJump.empty
  return empty
}
