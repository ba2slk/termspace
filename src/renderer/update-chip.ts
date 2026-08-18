/**
 * The title-bar chip that says a newer release exists.
 *
 * Present only while there is something to say. Dismissing hides it for the
 * run: a restart is when an update can be applied, so it is also when one is
 * worth mentioning again.
 */
import { t } from './i18n'
import type { UpdateState } from '../shared/protocol'

export interface UpdateChipHooks {
  readonly onOpen: () => void
}

export interface UpdateChip {
  readonly element: HTMLElement
  setState(state: UpdateState): void
}

export function createUpdateChip(hooks: UpdateChipHooks): UpdateChip {
  const element = document.createElement('div')
  element.className = 'update-chip'
  element.hidden = true

  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'update-chip__open'
  open.title = t.appBar.updateOpen
  open.addEventListener('click', () => hooks.onOpen())

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'update-chip__dismiss'
  dismiss.title = t.appBar.updateDismiss
  dismiss.setAttribute('aria-label', t.appBar.updateDismiss)
  dismiss.textContent = '×'

  let dismissed = false
  dismiss.addEventListener('click', () => {
    dismissed = true
    element.hidden = true
  })

  element.append(open, dismiss)

  return {
    element,
    setState(state) {
      if (state.kind !== 'available' || dismissed) {
        element.hidden = true
        return
      }
      open.textContent = t.appBar.updateAvailable(state.version)
      element.hidden = false
    },
  }
}
