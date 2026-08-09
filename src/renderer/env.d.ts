/// <reference types="vite/client" />

/**
 * Build-time flags.
 *
 * Declared so they can be read as `import.meta.env.VITE_SELFCHECK`. Vite only
 * substitutes the dot form; through a bracket the value stays a lookup at
 * runtime, the branch never folds, and the self-check ends up in the release.
 */
interface ImportMetaEnv {
  /** '1' while building for the self-check. Unset everywhere else. */
  readonly VITE_SELFCHECK?: string
  /** Where the self-check writes screenshots. */
  readonly VITE_SHOT_DIR?: string
}
