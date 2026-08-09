export const APP_NAME = 'Termspace'

/** Used with package.json's version in the window title. */
export function windowTitle(sessionName: string | null): string {
  return sessionName === null ? APP_NAME : `${APP_NAME} — ${sessionName}`
}
