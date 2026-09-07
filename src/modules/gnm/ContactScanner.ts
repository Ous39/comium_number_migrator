/**
 * ContactScanner — read-only access to the device phonebook.
 * The only permission this module needs. Nothing here writes or uploads.
 *
 * Permission is handled so the flow never dead-ends:
 *   getPermissionState()      -> what the OS currently allows
 *   requestContactsPermission -> ask; distinguishes "ask again later" from "blocked"
 *   openAppSettings()         -> deep link to the app's settings page
 */

import { Linking, Platform } from 'react-native';
import type { DeviceContact } from './types';

export type ScanProgress = { processed: number; total: number; percent: number };

export type PermissionState =
  | 'granted' // full access
  | 'limited' // iOS 18 partial access — usable, but the user picked a subset
  | 'undetermined' // never asked
  | 'denied' // said no, but we can ask again
  | 'blocked'; // said no permanently — only Settings can change it

let ContactsMod: typeof import('expo-contacts') | null = null;
function contacts(): typeof import('expo-contacts') {
  if (ContactsMod) return ContactsMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ContactsMod = require('expo-contacts');
  } catch {
    ContactsMod = null;
  }
  if (!ContactsMod || typeof ContactsMod.getContactsAsync !== 'function') {
    throw new Error(
      "The contacts module isn't installed in this app. Run:  npx expo install expo-contacts",
    );
  }
  return ContactsMod;
}

function mapStatus(res: {
  status: string;
  canAskAgain?: boolean;
  accessPrivileges?: string;
}): PermissionState {
  if (res.status === 'granted') {
    return res.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }
  if (res.status === 'undetermined') return 'undetermined';
  // denied
  return res.canAskAgain === false ? 'blocked' : 'denied';
}

/** What the OS currently allows, without prompting. */
export async function getPermissionState(): Promise<PermissionState> {
  try {
    return mapStatus(await contacts().getPermissionsAsync());
  } catch {
    return 'undetermined';
  }
}

/** Prompt for Contacts permission. Safe to call repeatedly. */
export async function requestContactsPermission(): Promise<PermissionState> {
  const current = await contacts().getPermissionsAsync();
  const mappedCurrent = mapStatus(current);
  if (mappedCurrent === 'granted' || mappedCurrent === 'limited') return mappedCurrent;
  if (mappedCurrent === 'blocked') return 'blocked';
  return mapStatus(await contacts().requestPermissionsAsync());
}

/** Legacy convenience: true when scanning can proceed. */
export async function ensureContactsPermission(): Promise<boolean> {
  const s = await requestContactsPermission();
  return s === 'granted' || s === 'limited';
}

/** Open this app's page in the system Settings so the user can flip the toggle. */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:').catch(() => undefined);
    }
  }
}

function phoneText(p: { number?: string; digits?: string }): string {
  return String(p.number || p.digits || '');
}

export interface ReadContactsResult {
  contacts: DeviceContact[];
  permission: PermissionState;
  /** Total contact records the OS returned (including any with no phone number). */
  rawCount: number;
}

/**
 * Load every contact that has a phone number. Never throws for an empty
 * phonebook or limited access — inspect the returned `permission` / counts.
 * Throws only if permission is fully denied/blocked or the native module is
 * missing, so the screen can route to the right recovery.
 */
export async function readContacts(
  onProgress?: (p: ScanProgress) => void,
): Promise<ReadContactsResult> {
  const permission = await requestContactsPermission();
  if (permission === 'denied' || permission === 'blocked') {
    const err = new Error(
      'Contacts permission is required. Your contacts stay on this device and are never uploaded.',
    );
    (err as any).code = permission === 'blocked' ? 'permission_blocked' : 'permission_denied';
    throw err;
  }

  const C = contacts();
  const res = await C.getContactsAsync({
    fields: [
      C.Fields.PhoneNumbers,
      C.Fields.FirstName,
      C.Fields.LastName,
      C.Fields.Company,
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
      await new Promise((resolve) => setTimeout(resolve, 0)); // let the UI paint
    }
  }

  return { contacts: out, permission, rawCount: total };
}
