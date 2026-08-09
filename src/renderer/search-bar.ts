/**
 * The scrollback search bar. One per session; it sits inside the focused
 * pane's body and closes the moment focus moves — the bar is the focused
 * pane's, which keeps its state a single open/closed flag.
 */
import { t } from './i18n'

/** What the bar needs from a pane; TerminalPane satisfies it structurally. */
export interface SearchTarget {
  findNext(query: string, caseSensitive: boolean, incremental?: boolean): void
  findPrevious(query: string, caseSensitive: boolean): void
  clearSearch(): void
  onSearchResults(listener: (resultIndex: number, resultCount: number) => void): () => void
  focus(): void
}

export interface SearchBar {
  /** Open over the pane body, seeded with its selection. Refocuses if open. */
  open(host: HTMLElement, target: SearchTarget, seed: string): void
  close(): void
}

export function createSearchBar(): SearchBar {
  const element = document.createElement('div')
  element.className = 'search-bar'

  const input = document.createElement('input')
  input.className = 'search-bar__input'
  input.type = 'text'
  input.placeholder = t.search.placeholder
  input.spellcheck = false

  const count = document.createElement('span')
  count.className = 'search-bar__count'

  const caseButton = document.createElement('button')
  caseButton.className = 'search-bar__button'
  caseButton.textContent = 'Aa'
  caseButton.title = t.search.matchCase

  const prevButton = document.createElement('button')
  prevButton.className = 'search-bar__button'
  prevButton.textContent = '∧'
  prevButton.title = t.search.previousMatch

  const nextButton = document.createElement('button')
  nextButton.className = 'search-bar__button'
  nextButton.textContent = '∨'
  nextButton.title = t.search.nextMatch

  const closeButton = document.createElement('button')
  closeButton.className = 'search-bar__button'
  closeButton.textContent = '✕'
  closeButton.title = t.search.close

  element.append(input, count, caseButton, prevButton, nextButton, closeButton)

  // Buttons act on the terminal; taking focus from the input would close nothing
  // but does drop the caret mid-typing.
  for (const button of [caseButton, prevButton, nextButton, closeButton]) {
    button.addEventListener('mousedown', (event) => event.preventDefault())
  }

  let target: SearchTarget | null = null
  let offResults: (() => void) | null = null
  let caseSensitive = false

  function showCount(resultIndex: number, resultCount: number): void {
    // -1 means past the highlight limit; the count alone is still true.
    count.textContent = resultIndex < 0 ? `${resultCount}` : `${resultIndex + 1}/${resultCount}`
    element.classList.toggle('search-bar--empty', resultCount === 0 && input.value !== '')
  }

  function research(): void {
    target?.findNext(input.value, caseSensitive, true)
    if (input.value === '') showCount(-1, 0)
  }

  input.addEventListener('input', research)

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) target?.findPrevious(input.value, caseSensitive)
      else target?.findNext(input.value, caseSensitive)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })

  caseButton.addEventListener('click', () => {
    caseSensitive = !caseSensitive
    caseButton.classList.toggle('search-bar__button--on', caseSensitive)
    research()
  })
  prevButton.addEventListener('click', () => target?.findPrevious(input.value, caseSensitive))
  nextButton.addEventListener('click', () => target?.findNext(input.value, caseSensitive))
  closeButton.addEventListener('click', close)

  function close(): void {
    if (target === null) return
    const closing = target
    target = null
    offResults?.()
    offResults = null
    closing.clearSearch()
    element.remove()
    closing.focus()
  }

  return {
    open(host, nextTarget, seed) {
      if (target === nextTarget) {
        input.focus()
        input.select()
        return
      }
      close()
      target = nextTarget
      offResults = nextTarget.onSearchResults(showCount)
      showCount(-1, 0)
      if (seed !== '') input.value = seed
      host.append(element)
      input.focus()
      input.select()
      if (input.value !== '') research()
    },
    close,
  }
}
