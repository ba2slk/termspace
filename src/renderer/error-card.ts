/**
 * Error card shown in a pane's place. A single typo must not cost the whole
 * session, so the error explains itself where it happened.
 */
import type { ConfigIssue } from '../shared/protocol'
import { t } from './i18n'

export function renderConfigError(body: HTMLElement, issue: ConfigIssue, file: string): void {
  const card = document.createElement('div')
  card.className = 'error-card'

  const title = document.createElement('div')
  title.className = 'error-card__title'
  title.textContent = t.errorCard.configError

  const where = document.createElement('div')
  where.textContent = issue.path === '' ? t.errorCard.topLevel : issue.path

  const what = document.createElement('div')
  what.textContent = issue.message

  const path = document.createElement('div')
  path.className = 'error-card__path'
  path.textContent = file // Nothing can be fixed without knowing which file to fix.

  card.append(title, where, what, path)
  body.replaceChildren(card)
}

export interface ExitBannerOptions {
  readonly exitCode: number
  readonly signal: number | null
  readonly onRestart: () => void
}

/** Overlaid on the terminal; the output underneath says why it died. */
export function renderExitBanner(body: HTMLElement, options: ExitBannerOptions): HTMLElement {
  body.querySelector('.exit-banner')?.remove()

  const banner = document.createElement('div')
  banner.className = 'exit-banner'

  const label = document.createElement('span')
  label.textContent =
    options.signal === null || options.signal === 0
      ? t.errorCard.exitedCode(String(options.exitCode))
      : t.errorCard.exitedSignal(String(options.signal))

  const restart = document.createElement('button')
  restart.className = 'button'
  restart.textContent = t.errorCard.restart
  restart.addEventListener('click', () => {
    banner.remove()
    options.onRestart()
  })

  banner.append(label, restart)
  body.append(banner)
  return banner
}
