/**
 * BackupManager — a local, restorable snapshot of every contact that is about
 * to change, taken before any write. Stored on-device only (AsyncStorage, or an
 * in-memory fallback for the session); nothing leaves the device.
 *
 * Nothing here throws in normal use — createBackup returns '' if it truly
 * could not persist, and the caller decides whether to continue.
 */

import * as ContactsMod from 'expo-contacts';
import { storage, storageIsPersistent } from './safeStorage';
import type { BackupSummary, ContactPhone } from './types';

const INDEX_KEY = 'gnm.backups.index.v1';
const ITEM_KEY = (id: string) => `gnm.backup.${id}.v1`;
const MAX_KEPT = 50;

interface BackupItem {
  contactId: string;
  contactName: string;
  phoneNumbers: ContactPhone[];
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  label: string;
  items: BackupItem[];
}

export type RestoreProgress = { processed: number; total: number };

/** False when backups live only in memory (async-storage missing/unavailable). */
export const backupsArePersistent = storageIsPersistent;

async function readIndex(): Promise<BackupSummary[]> {
  try {
    const raw = await storage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as BackupSummary[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: BackupSummary[]): Promise<void> {
  await storage.setItem(INDEX_KEY, JSON.stringify(list.slice(0, MAX_KEPT)));
}

/**
 * Snapshot the given contacts (as currently saved) and return a backup id.
 * Returns '' if the snapshot could not be stored at all.
 */
export async function createBackup(
  contacts: { id: string; name: string; phoneNumbers: ContactPhone[] }[],
  label = 'Before migration',
): Promise<string> {
  const id = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record: BackupRecord = {
    id,
    createdAt: new Date().toISOString(),
    label,
    items: contacts.map((c) => ({
      contactId: c.id,
      contactName: c.name,
      phoneNumbers: c.phoneNumbers.map((p) => ({ id: p.id, label: p.label, number: p.number })),
    })),
  };
  try {
    await storage.setItem(ITEM_KEY(id), JSON.stringify(record));
  } catch {
    return '';
  }
  // verify it can be read back — an in-memory fallback still passes this
  try {
    const check = await storage.getItem(ITEM_KEY(id));
    if (!check) return '';
  } catch {
    return '';
  }
  const index = await readIndex();
  await writeIndex([
    { id, createdAt: record.createdAt, contactCount: record.items.length, label },
    ...index,
  ]);
  return id;
}

export async function listBackups(): Promise<BackupSummary[]> {
  return readIndex();
}

export async function getBackup(id: string): Promise<BackupRecord | null> {
  try {
    const raw = await storage.getItem(ITEM_KEY(id));
    return raw ? (JSON.parse(raw) as BackupRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Write the saved numbers back onto each contact. Best-effort per contact —
 * a contact that no longer exists or is read-only is counted as failed, the
 * rest still restore.
 */
export async function restoreBackup(
  id: string,
  onProgress?: (p: RestoreProgress) => void,
): Promise<{ restored: number; failed: number }> {
  const record = await getBackup(id);
  if (!record) throw new Error('That backup could not be found on this device.');

  const Contacts = ContactsMod as typeof import('expo-contacts');
  let restored = 0;
  let failed = 0;

  for (let i = 0; i < record.items.length; i++) {
    const item = record.items[i];
    try {
      const payload = item.phoneNumbers.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        label: p.label || 'mobile',
        number: p.number,
      }));
      await Contacts.updateContactAsync({ id: item.contactId, phoneNumbers: payload } as any);
      restored++;
    } catch {
      failed++;
    }
    onProgress?.({ processed: i + 1, total: record.items.length });
  }

  return { restored, failed };
}

export async function deleteBackup(id: string): Promise<void> {
  await storage.removeItem(ITEM_KEY(id));
  const index = (await readIndex()).filter((b) => b.id !== id);
  await writeIndex(index);
}
