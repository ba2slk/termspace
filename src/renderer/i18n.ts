/**
 * The catalogue is picked once, here, because every screen bakes its strings in
 * as it is built — there is no moment later at which switching would take.
 *
 * The choice arrives in the page URL rather than over IPC: the settings file is
 * main's to read, and a reply would land long after these modules have run.
 */
import { stringsFor } from '../shared/ui-strings'

const chosen = new URLSearchParams(location.search).get('locale')
const locale = chosen === null || chosen === '' ? navigator.language : chosen

export const t = stringsFor(locale)

// The static file can only declare one language; correct it to the one chosen.
document.documentElement.lang = t === stringsFor('ko') ? 'ko' : 'en'
