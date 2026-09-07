/**
 * BackupManager — a local, restorable snapshot of every contact that is about
 * to change, taken before any write. Stored in AsyncStorage only; nothing
 * leaves the device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
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

async function readIndex(): Promise<BackupSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as BackupSummary[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: BackupSummary[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list.slice(0, MAX_KEPT))).catch(() => undefined);
}

/** Snapshot the given contacts (as currently saved) and return a backup id. */
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
  await AsyncStorage.setItem(ITEM_KEY(id), JSON.stringify(record));
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
    const raw = await AsyncStorage.getItem(ITEM_KEY(id));
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
  await AsyncStorage.removeItem(ITEM_KEY(id)).catch(() => undefined);
  const index = (await readIndex()).filter((b) => b.id !== id);
  await writeIndex(index);
}
