/**
 * Small dialog for saving the current layout as a session file.
 *
 * Widths and height ratios are the part nobody wants to write by hand, so the
 * arrangement made on screen is what gets written. It asks for a name and
 * nothing else — the layout was already decided.
 */
import { api } from './api'
import { t } from './i18n'

export interface SaveSessionHooks {
  /** Saved; refresh the list. wasBlank marks a newly created blank session. */
  readonly onSaved: (file: string, wasBlank: boolean) => void
  readonly onDismiss: () => void
}

export interface SaveSessionView {
  /** suggested: the current session's name, usually edited rather than replaced. */
  open(
    suggested: string,
    rootCwd: string,
    snapshot: () => import('../shared/protocol').LayoutSnapshot,
  ): void
  /** Create a blank one-pane session; same dialog, since it asks the same thing. */
  openBlank(): void
  close(): void
  readonly visible: boolean
  destroy(): void
}

/** Derive a file name from the display name; spaces become hyphens. */
export function toSessionId(displayName: string): string {
  return displayName
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/^[.-]+/, '')
    .slice(0, 64)
}

export function createSaveSessionView(
  host: HTMLElement,
  hooks: SaveSessionHooks,
): SaveSessionView {
  const layer = document.createElement('div')
  layer.className = 'sheet-layer save-session'
  layer.hidden = true

  const card = document.createElement('div')
  card.className = 'panel save-session__card'

  const title = document.createElement('div')
  title.className = 'save-session__title'
  title.textContent = t.saveSession.title

  const lead = document.createElement('p')
  lead.className = 'save-session__lead'
  lead.textContent = t.saveSession.lead

  const label = document.createElement('label')
  label.className = 'save-session__field'
  const labelText = document.createElement('span')
  labelText.textContent = t.saveSession.nameLabel
  const field = document.createElement('input')
  field.type = 'text'
  field.className = 'save-session__input'
  field.spellcheck = false
  label.append(labelText, field)

  /*
   * A div rather than a label like the row above it: this row holds a button,
   * and inside a label a click on that button is also a click on the label,
   * which yanks focus into the field on the way to the file chooser.
   */
  const cwdRow = document.createElement('div')
  cwdRow.className = 'save-session__field'
  const cwdText = document.createElement('label')
  cwdText.htmlFor = 'save-session-cwd'
  cwdText.textContent = t.saveSession.cwdLabel
  const cwdField = document.createElement('input')
  cwdField.type = 'text'
  cwdField.id = 'save-session-cwd'
  cwdField.className = 'save-session__input save-session__cwd'
  cwdField.spellcheck = false

  const browse = document.createElement('button')
  browse.type = 'button'
  browse.className = 'button save-session__browse'
  browse.textContent = t.saveSession.browse
  browse.addEventListener('click', () => {
    void api.pickDirectory(cwdField.value).then((picked) => {
      // Cancelling leaves whatever was typed; the chooser is an extra way in,
      // not the only one.
      if (picked === null) return
      cwdField.value = picked
      sync()
    })
  })
  cwdRow.append(cwdText, cwdField, browse)

  // One grid so both rows share label and input columns whatever the locale.
  const fields = document.createElement('div')
  fields.className = 'save-session__fields'
  fields.append(label, cwdRow)

  // Show the destination up front, rather than leaving it to be hunted for.
  const path = document.createElement('code')
  path.className = 'save-session__path'

  const status = document.createElement('p')
  status.className = 'save-session__status'

  const actions = document.createElement('div')
  actions.className = 'save-session__actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'button'
  cancel.textContent = t.saveSession.cancel
  cancel.addEventListener('click', () => hooks.onDismiss())
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'button button--accent'
  actions.append(cancel, save)

  card.append(title, lead, fields, path, status, actions)
  layer.append(card)
  host.append(layer)

  /** null means create blank; otherwise save this layout. */
  let getSnapshot: (() => import('../shared/protocol').LayoutSnapshot) | null = null
  /** Whether the name is taken, which turns the button into an overwrite. */
  let exists = false
  let busy = false

  function sync(): void {
    const id = toSessionId(field.value)
    path.textContent = id === '' ? t.saveSession.namePrompt : t.saveSession.pathFor(id)
    save.disabled = id === '' || busy
    // Overwriting is never silent — the label itself changes. Creating a blank
    // session never overwrites, so a taken name simply blocks.
    save.textContent = exists
      ? t.saveSession.overwrite
      : getSnapshot === null
        ? t.saveSession.create
        : t.saveSession.save
    save.classList.toggle('button--danger', exists && getSnapshot !== null)
    save.disabled = id === '' || busy || (exists && getSnapshot === null)
    status.textContent = !exists
      ? ''
      : getSnapshot === null
        ? t.saveSession.nameTakenPickAnother
        : t.saveSession.nameTakenOverwrites
    status.classList.toggle('save-session__status--warn', exists)
  }

  let checkToken = 0
  function checkExists(): void {
    const id = toSessionId(field.value)
    const token = ++checkToken
    if (id === '') {
      exists = false
      sync()
      return
    }
    void api.sessionExists(id).then((found) => {
      // Replies can arrive out of order while typing; keep only the latest.
      if (token !== checkToken) return
      exists = found
      sync()
    })
  }

  field.addEventListener('input', checkExists)

  function submit(): void {
    const id = toSessionId(field.value)
    if (id === '' || busy) return
    busy = true
    sync()
    const snapshot = getSnapshot
    const rootCwd = cwdField.value.trim() === '' ? '~' : cwdField.value.trim()
    const request =
      snapshot === null
        ? api.createBlankSession(id, field.value.trim(), rootCwd)
        : api.saveSessionAs(id, field.value.trim(), snapshot(), exists, rootCwd)
    void request
      .then((result) => {
        busy = false
        if (result.ok) {
          hooks.onSaved(result.file, snapshot === null)
          return
        }
        status.textContent = result.error ?? t.saveSession.saveFailed
        status.classList.add('save-session__status--warn')
        sync()
      })
  }

  save.addEventListener('click', submit)
  // Enter submits from either field: both are part of the same one answer.
  for (const input of [field, cwdField]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    })
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (layer.hidden) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      hooks.onDismiss()
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

    open(suggested, rootCwd, snapshot) {
      getSnapshot = snapshot
      title.textContent = t.saveSession.title
      lead.textContent = t.saveSession.lead
      busy = false
      field.value = suggested
      cwdField.value = rootCwd
      layer.hidden = false
      checkExists()
      field.focus()
      field.select()
    },

    openBlank() {
      getSnapshot = null
      title.textContent = t.saveSession.blankTitle
      lead.textContent = t.saveSession.blankLead
      busy = false
      field.value = ''
      cwdField.value = '~'
      layer.hidden = false
      checkExists()
      field.focus()
    },

    close() {
      layer.hidden = true
      getSnapshot = null
    },

    destroy() {
      window.removeEventListener('keydown', onKeyDown, true)
      layer.remove()
    },
  }
}
