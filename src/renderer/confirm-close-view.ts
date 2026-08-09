/**
 * Confirmation for irreversible actions.
 *
 * Without detach, closing kills every process inside. Nothing to lose means no
 * dialog — asking when there is no answer to give trains people to dismiss it.
 */
import { t } from './i18n'

export interface RunningSession {
  readonly name: string
  readonly paneCount: number
}

export interface ConfirmCloseHooks {
  readonly onCancel: () => void
}

/** What is being asked: wording and button label. */
export interface ConfirmRequest {
  readonly title: string
  /** Items to list; empty hides the list entirely. */
  readonly items: readonly RunningSession[]
  readonly lead: string
  readonly confirmLabel: string
}

export interface ConfirmCloseView {
  ask(request: ConfirmRequest, onConfirm: () => void): void
  close(): void
  readonly visible: boolean
  destroy(): void
}

export function createConfirmCloseView(
  host: HTMLElement,
  hooks: ConfirmCloseHooks,
): ConfirmCloseView {
  const layer = document.createElement('div')
  layer.className = 'sheet-layer save-session confirm-close'
  layer.hidden = true

  const card = document.createElement('div')
  card.className = 'panel save-session__card'

  const title = document.createElement('div')
  title.className = 'save-session__title'

  const list = document.createElement('div')
  list.className = 'confirm-close__list'

  const lead = document.createElement('p')
  lead.className = 'save-session__lead'

  const actions = document.createElement('div')
  actions.className = 'save-session__actions'

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'button'
  cancel.textContent = t.confirmClose.cancel
  cancel.addEventListener('click', () => hooks.onCancel())

  // The irreversible option is the one that carries colour.
  let onConfirm: (() => void) | null = null
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.className = 'button button--danger'
  confirm.addEventListener('click', () => onConfirm?.())

  actions.append(cancel, confirm)
  card.append(title, list, lead, actions)
  layer.append(card)
  host.append(layer)

  function onKeyDown(event: KeyboardEvent): void {
    if (layer.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hooks.onCancel()
      return
    }
    // Shortcuts must not leak through to the session behind.
    event.stopPropagation()
  }
  window.addEventListener('keydown', onKeyDown, true)

  return {
    get visible() {
      return !layer.hidden
    },

    ask(request, confirmed) {
      onConfirm = confirmed
      title.textContent = request.title
      lead.textContent = request.lead
      confirm.textContent = request.confirmLabel
      list.hidden = request.items.length === 0

      list.replaceChildren(
        ...request.items.map((session) => {
          const row = document.createElement('div')
          row.className = 'confirm-close__row'

          const dot = document.createElement('span')
          dot.className = 'sidebar__dot sidebar__dot--on'

          const name = document.createElement('span')
          name.className = 'confirm-close__name'
          name.textContent = session.name

          const meta = document.createElement('span')
          meta.className = 'confirm-close__meta'
          meta.textContent = t.confirmClose.paneCount(String(session.paneCount))

          row.append(dot, name, meta)
          return row
        }),
      )

      layer.hidden = false
      // Focus cancel, so a reflexive Enter doesn't confirm.
      cancel.focus()
    },

    close() {
      layer.hidden = true
      onConfirm = null
    },

    destroy() {
      window.removeEventListener('keydown', onKeyDown, true)
      layer.remove()
    },
  }
}
