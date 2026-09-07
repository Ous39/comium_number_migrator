import { COMIUM_THEME, GnmTheme } from './theme';

export interface GnmConfig {
  /**
   * URL that returns the numbering-rules JSON. Accepts either the raw payload
   * `{ versionNumber, operators, rules }` or `{ data: { ... } }`.
   * Default points at the reference GNM service; host your own copy so ranges
   * can change without shipping an app update.
   */
  rulesUrl: string;
  /** Abort the rules fetch after this many ms and fall back to cache/bundled. */
  requestTimeoutMs: number;
  /** Visual overrides for the built-in screen. */
  theme: GnmTheme;
  /**
   * Restrict migration to these operator codes (e.g. ['COMIUM']). Non-matching
   * numbers are shown as "not included" instead of "ready". Omit to migrate all.
   */
  operatorFilter?: string[];
  /** Default apply mode when the screen opens. */
  defaultMode: 'add' | 'replace';
  /** Product name shown in the screen header. */
  productName: string;
}

const DEFAULTS: GnmConfig = {
  rulesUrl: 'https://api.oceanbrown.gm/api/migration-rules',
  requestTimeoutMs: 10000,
  theme: COMIUM_THEME,
  operatorFilter: undefined,
  defaultMode: 'add',
  productName: 'Number Migrator',
};

let current: GnmConfig = { ...DEFAULTS };

/** Call once near app start (before rendering GNMScreen). Merges over defaults. */
export function configureGNM(patch: Partial<GnmConfig>): void {
  current = {
    ...current,
    ...patch,
    theme: { ...current.theme, ...(patch.theme || {}) },
  };
}

export function getConfig(): GnmConfig {
  return current;
}

export function resetGNMConfig(): void {
  current = { ...DEFAULTS };
}
