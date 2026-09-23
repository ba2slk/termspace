import { describe, expect, it, vi } from 'vitest'

// Every name is taken: the question is what the dialog does about it.
vi.stubGlobal('termspace', {
  platform: 'linux',
  sessionExists: vi.fn(async () => true),
})

const { createSaveSessionView } = await import('./save-session-view')
const { t } = await import('./i18n')

const snapshot = () => ({ columns: [] }) as never

async function openWith(mayOverwrite: boolean | undefined) {
  document.body.innerHTML = '<div id="host"></div>'
  const view = createSaveSessionView(document.getElementById('host')!, {
    onSaved: vi.fn(),
    onDismiss: vi.fn(),
  })
  view.open('work', '~', snapshot, mayOverwrite === undefined ? undefined : { mayOverwrite })
  // The exists check is one promise away.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return {
    save: document.querySelector<HTMLButtonElement>('.save-session .button--accent')!,
    status: document.querySelector<HTMLElement>('.save-session__status')!,
  }
}

describe('saving over a taken name', () => {
  it('offers to overwrite by default', async () => {
    const { save } = await openWith(undefined)
    expect(save.disabled).toBe(false)
    expect(save.textContent).toBe(t.saveSession.overwrite)
  })

  // From the default terminal: the session with that id may be open.
  it('refuses when overwriting is not allowed', async () => {
    const { save, status } = await openWith(false)
    expect(save.disabled).toBe(true)
    expect(status.textContent).toBe(t.saveSession.nameTakenPickAnother)
  })
})
