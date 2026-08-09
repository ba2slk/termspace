import type { TermspaceApi } from '../shared/protocol'

declare global {
  interface Window {
    readonly termspace: TermspaceApi
  }
}

/**
 * The surface preload exposes. Renderer code goes through here rather than
 * touching window directly, so its capabilities read from one file.
 */
export const api: TermspaceApi = window.termspace
