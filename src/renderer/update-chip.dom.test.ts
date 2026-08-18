import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('termspace', { platform: 'linux' })
const { createUpdateChip } = await import('./update-chip')
const { t } = await import('./i18n')

let onOpen: ReturnType<typeof vi.fn<() => void>>
let chip: ReturnType<typeof createUpdateChip>

beforeEach(() => {
  document.body.replaceChildren()
  onOpen = vi.fn<() => void>()
  chip = createUpdateChip({ onOpen })
  document.body.append(chip.element)
})

const button = () => chip.element.querySelector<HTMLButtonElement>('.update-chip__open')

describe('update chip', () => {
  it('is hidden at idle', () => {
    chip.setState({ kind: 'idle' })
    expect(chip.element.hidden).toBe(true)
  })

  it('shows the version through the catalog when available', () => {
    chip.setState({ kind: 'available', version: '1.2.0' })
    expect(chip.element.hidden).toBe(false)
    expect(button()?.textContent).toBe(t.appBar.updateAvailable('1.2.0'))
    expect(button()?.title).toBe(t.appBar.updateOpen)
  })

  it('opens the release on click', () => {
    chip.setState({ kind: 'available', version: '1.2.0' })
    button()?.click()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('stays hidden for the run once dismissed, even when available arrives again', () => {
    chip.setState({ kind: 'available', version: '1.2.0' })
    chip.element.querySelector<HTMLButtonElement>('.update-chip__dismiss')?.click()
    expect(chip.element.hidden).toBe(true)
    chip.setState({ kind: 'available', version: '1.2.0' })
    expect(chip.element.hidden).toBe(true)
  })

  it('ignores states that are not an offer', () => {
    chip.setState({ kind: 'available', version: '1.2.0' })
    chip.setState({ kind: 'up-to-date' })
    expect(chip.element.hidden).toBe(true)
    chip.setState({ kind: 'failed' })
    expect(chip.element.hidden).toBe(true)
  })
})
