/**
 * Which platform the window runs on, read once — like the locale, and for the
 * same reason: it cannot change while the app is open, and every view bakes its
 * key labels in as it is built.
 *
 * It decides two things: which default bindings apply (Cmd on mac, Alt off it),
 * and how a chord is spelled (⇧ + ⌘ + W against Ctrl + Shift + W).
 */
import { api } from './api'

export const IS_MAC = api.platform === 'darwin'
/** The one platform where text rendering is a choice; see AppSettings.textRendering. */
export const IS_LINUX = api.platform === 'linux'
