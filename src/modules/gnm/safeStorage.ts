/**
 * safeStorage — key/value storage that never throws and never blocks the flow.
 *
 * Uses @react-native-async-storage/async-storage when it is installed and
 * working. If it is missing or fails, it transparently falls back to an
 * in-memory store for the session (rules cache + backups still work; they are
 * just not kept across an app restart). Callers do not need to care which.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function memoryStore(): KeyValueStore {
  const mem = new Map<string, string>();
  return {
    async getItem(k) {
      return mem.has(k) ? (mem.get(k) as string) : null;
    },
    async setItem(k, v) {
      mem.set(k, v);
    },
    async removeItem(k) {
      mem.delete(k);
    },
  };
}

let impl: KeyValueStore = memoryStore();
let persistent = false;

try {
  // Resolved lazily so a missing native module degrades instead of crashing the bundle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-async-storage/async-storage');
  const asyncStorage = (mod && (mod.default || mod)) as Partial<KeyValueStore> | undefined;
  if (
    asyncStorage &&
    typeof asyncStorage.getItem === 'function' &&
    typeof asyncStorage.setItem === 'function' &&
    typeof asyncStorage.removeItem === 'function'
  ) {
    impl = {
      async getItem(k) {
        try {
          return await asyncStorage.getItem!(k);
        } catch {
          return null;
        }
      },
      async setItem(k, v) {
        try {
          await asyncStorage.setItem!(k, v);
        } catch {
          /* ignore — a failed persist must not stop the user */
        }
      },
      async removeItem(k) {
        try {
          await asyncStorage.removeItem!(k);
        } catch {
          /* ignore */
        }
      },
    };
    persistent = true;
  }
} catch {
  // keep the in-memory fallback
}

export const storage: KeyValueStore = impl;

/** True when writes survive an app restart. False = in-memory fallback in use. */
export const storageIsPersistent = persistent;
