/**
 * ContactUpdater — the only file that writes to the phonebook.
 *
 * Guarantees:
 *  - a backup of every affected contact is taken first
 *  - only the numbers you selected are touched
 *  - a contact that already has the new number is skipped (idempotent)
 *  - every write is read back and verified; a change that did not stick is
 *    reported as a failure (usually a read-only account contact), never a
 *    silent success
 */

import * as Contacts from 'expo-contacts';
import { createBackup } from './BackupManager';
import { formatMigratedLikeOriginal, sameLocalNumber } from './GNMEngine';
import type { ApplyResult, ContactPhone, MigrationCandidate, UpdateMode } from './types';

export type ApplyProgress = {
  processed: number;
  total: number;
  updated: number;
  skipped: number;
  failed: number;
};

function toPhone(p: any): ContactPhone {
  return { id: p.id, label: p.label, number: String(p.number || p.digits || '') };
}

function localSnapshot(phones: ContactPhone[]): string {
  return phones
    .map((p) => String(p.number || '').replace(/\D/g, ''))
    .filter(Boolean)
    .sort()
    .join(',');
}

export interface ApplyOptions {
  onProgress?: (p: ApplyProgress) => void;
  /**
   * Proceed even if the pre-migration backup could not be saved. Default false:
   * applyPlan throws `Error` with `code: 'backup_failed'` so the UI can ask the
   * user. Pass true only after they have explicitly accepted the risk.
   */
  allowNoBackup?: boolean;
}

/**
 * Apply the selected `Ready` candidates.
 * `mode: 'add'`     keeps the old number and adds the new one.
 * `mode: 'replace'` overwrites the old number in place.
 *
 * A backup of every affected contact is taken first. If it cannot be stored and
 * `allowNoBackup` is not set, nothing is changed and the call throws.
 */
export async function applyPlan(
  selected: MigrationCandidate[],
  mode: UpdateMode,
  optsOrProgress?: ApplyOptions | ((p: ApplyProgress) => void),
): Promise<ApplyResult> {
  const opts: ApplyOptions =
    typeof optsOrProgress === 'function' ? { onProgress: optsOrProgress } : optsOrProgress || {};
  const onProgress = opts.onProgress;
  // group actionable candidates by contact
  const byContact = new Map<string, MigrationCandidate[]>();
  for (const c of selected) {
    if (c.status !== 'Ready' || !c.migratedNumber) continue;
    const arr = byContact.get(c.contactId) || [];
    arr.push(c);
    byContact.set(c.contactId, arr);
  }
  const contactIds = [...byContact.keys()];

  // read current state of every affected contact, then back it up
  const affected: { id: string; name: string; phoneNumbers: ContactPhone[] }[] = [];
  for (const id of contactIds) {
    const items = byContact.get(id)!;
    let phones: ContactPhone[] = (items[0].beforePhoneNumbers || []).map(toPhone);
    try {
      const cur = await Contacts.getContactByIdAsync(id, [
        Contacts.Fields.PhoneNumbers,
        Contacts.Fields.FirstName,
        Contacts.Fields.LastName,
      ]);
      if (cur?.phoneNumbers?.length) phones = cur.phoneNumbers.map(toPhone);
      affected.push({ id, name: cur?.name || items[0].contactName, phoneNumbers: phones });
    } catch {
      affected.push({ id, name: items[0].contactName, phoneNumbers: phones });
    }
  }
  const backupId = await createBackup(
    affected,
    mode === 'replace' ? 'Before replace migration' : 'Before add migration',
  );
  if (!backupId && !opts.allowNoBackup) {
    const err = new Error(
      'A backup could not be saved on this device, so nothing was changed. Free up some storage and try again, or choose to continue without a backup.',
    );
    (err as any).code = 'backup_failed';
    throw err;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: ApplyResult['failures'] = [];

  for (let i = 0; i < contactIds.length; i++) {
    const id = contactIds[i];
    const items = byContact.get(id)!;
    try {
      const fresh = await Contacts.getContactByIdAsync(id, [Contacts.Fields.PhoneNumbers]);
      if (!fresh) {
        failed++;
        failures.push({ contactId: id, contactName: items[0].contactName, reason: 'This contact no longer exists.' });
        onProgress?.({ processed: i + 1, total: contactIds.length, updated, skipped, failed });
        continue;
      }

      let phones: ContactPhone[] = (fresh.phoneNumbers || []).map(toPhone);
      const before = localSnapshot(phones);
      let changed = false;

      for (const it of items) {
        const target = it.migratedNumber!; // local 9-digit
        const hasNew = phones.some((p) => sameLocalNumber(p.number, target));

        let oldIdx = phones.findIndex(
          (p, idx) => idx === it.phoneIndex && sameLocalNumber(p.number, it.normalizedOldNumber || it.originalNumber),
        );
        if (oldIdx < 0) {
          oldIdx = phones.findIndex((p) => sameLocalNumber(p.number, it.normalizedOldNumber || it.originalNumber));
        }

        if (hasNew && mode === 'add') continue; // already migrated
        if (oldIdx < 0 && !hasNew) continue; // nothing to act on

        const sourceForFormat = oldIdx >= 0 ? phones[oldIdx].number : it.originalNumber;
        const formattedNew = formatMigratedLikeOriginal(sourceForFormat, target);

        if (mode === 'replace') {
          if (oldIdx >= 0) {
            phones[oldIdx] = { ...phones[oldIdx], number: formattedNew };
            changed = true;
          } else if (!hasNew) {
            phones.push({ label: 'mobile', number: formattedNew });
            changed = true;
          }
        } else {
          if (!hasNew) {
            phones.push({ label: (oldIdx >= 0 && phones[oldIdx].label) || 'mobile', number: formattedNew });
            changed = true;
          }
        }
      }

      if (!changed) {
        skipped++;
        onProgress?.({ processed: i + 1, total: contactIds.length, updated, skipped, failed });
        continue;
      }

      const payload = phones.map((p) => ({
        ...(p.id ? { id: p.id } : {}),
        label: p.label || 'mobile',
        number: p.number,
      }));
      // Only send phoneNumbers — spreading the whole contact can make Android
      // try to write account-owned rows and fail the whole update.
      await Contacts.updateContactAsync({ id, phoneNumbers: payload } as any);

      // verify
      const check = await Contacts.getContactByIdAsync(id, [Contacts.Fields.PhoneNumbers]);
      const checkPhones: ContactPhone[] = (check?.phoneNumbers || []).map(toPhone);
      const allPresent = items.every((it) =>
        checkPhones.some((p) => sameLocalNumber(p.number, it.migratedNumber!)),
      );
      const oldRemoved =
        mode !== 'replace' ||
        items.every((it) => !checkPhones.some((p) => sameLocalNumber(p.number, it.normalizedOldNumber || it.originalNumber)));

      if (allPresent && (oldRemoved || localSnapshot(checkPhones) !== before)) {
        updated++;
      } else {
        failed++;
        failures.push({
          contactId: id,
          contactName: items[0].contactName,
          reason:
            'The change did not save. This contact may be read-only (synced from a Google, iCloud or Exchange account). Edit it in that account or in the Contacts app.',
        });
      }
    } catch (e: any) {
      failed++;
      failures.push({
        contactId: id,
        contactName: items[0].contactName,
        reason: e?.message || 'Could not update this contact.',
      });
    }
    onProgress?.({ processed: i + 1, total: contactIds.length, updated, skipped, failed });
  }

  return { updated, skipped, failed, failures, backupId };
}
