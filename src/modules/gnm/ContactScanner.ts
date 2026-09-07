/**
 * ContactScanner — read-only access to the device phonebook.
 * The only permission this module needs. Nothing here writes or uploads.
 */

import * as Contacts from 'expo-contacts';
import type { DeviceContact } from './types';

export type ScanProgress = { processed: number; total: number; percent: number };

/** Ask for Contacts permission if not already granted. Returns whether it is granted. */
export async function ensureContactsPermission(): Promise<boolean> {
  const current = await Contacts.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const requested = await Contacts.requestPermissionsAsync();
  return requested.status === 'granted';
}

function phoneText(p: { number?: string; digits?: string }): string {
  return String(p.number || p.digits || '');
}

/**
 * Load every contact that has at least one phone number, reduced to
 * `{ id, name, phoneNumbers[] }`. Yields to the event loop periodically so a
 * large phonebook does not freeze the UI. Throws if permission is denied.
 */
export async function readContacts(onProgress?: (p: ScanProgress) => void): Promise<DeviceContact[]> {
  const granted = await ensureContactsPermission();
  if (!granted) {
    throw new Error(
      'Contacts permission is required to scan. Your contacts stay on this device and are never uploaded.',
    );
  }

  const res = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.Company,
    ],
  });

  const total = res.data.length;
  const out: DeviceContact[] = [];

  for (let i = 0; i < total; i++) {
    const c = res.data[i];
    if (c.phoneNumbers && c.phoneNumbers.length) {
      out.push({
        id: c.id || String(i),
        name:
          c.name ||
          `${c.firstName || ''} ${c.lastName || ''}`.trim() ||
          c.company ||
          'Unnamed contact',
        phoneNumbers: c.phoneNumbers.map((p: any) => ({
          id: p.id,
          label: p.label,
          number: phoneText(p),
        })),
      });
    }
    if ((i + 1) % 50 === 0 || i === total - 1) {
      onProgress?.({
        processed: i + 1,
        total,
        percent: total ? Math.round(((i + 1) / total) * 100) : 100,
      });
      // let the UI paint
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return out;
}
