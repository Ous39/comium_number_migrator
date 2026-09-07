# `modules/gnm` — number-migration module

Turns saved 7-digit Gambian contacts into the new 9-digit format. Self-contained,
themeable, backup-first. Copy this folder into your app at
`src/modules/gnm/` and wire one button.

## Install (in the host app)

```bash
npx expo install expo-contacts @react-native-async-storage/async-storage
```

`react` / `react-native` are already there. Nothing else.

iOS — add to `app.json`:

```json
"ios": {
  "infoPlist": {
    "NSContactsUsageDescription": "Used to find and update saved Gambian numbers that are changing from 7 to 9 digits. Contacts stay on your device."
  }
}
```

Android — the module requests `READ_CONTACTS` / `WRITE_CONTACTS` at runtime via `expo-contacts`; Expo adds the manifest entries.

## Wire the "Update contacts" button

```tsx
import { useState } from 'react';
import { Modal, Button } from 'react-native';
import { GNMScreen, configureGNM } from './modules/gnm';

// once, at app start:
configureGNM({
  rulesUrl: 'https://<your-host>/migration-rules', // your JSON endpoint (see below)
  productName: 'Comium Number Migrator',
  // operatorFilter: ['COMIUM'],   // uncomment to only migrate Comium numbers
});

export function ContactsSettings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button title="Update contacts" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <GNMScreen
          onClose={() => setOpen(false)}
          onComplete={(r) => console.log('migrated', r.updated, 'failed', r.failed)}
        />
      </Modal>
    </>
  );
}
```

That is the whole integration. `GNMScreen` renders intro → scan → review → apply →
done, plus a restore path.

## Rules endpoint

The 7→9 rules are versioned JSON. `rulesUrl` must return either the raw payload
or `{ "data": { ... } }`:

```json
{
  "versionNumber": 1,
  "publishedAt": "2026-08-16T01:28:00Z",
  "operators": [{ "id": "...", "name": "Comium", "code": "COMIUM", "newPrefix": "86", "status": "active" }],
  "rules": [{ "id": "...", "operatorId": "...", "operatorName": "Comium", "operatorCode": "COMIUM",
              "ruleName": "Comium 6XXXXXX", "ruleType": "prefix", "prefixValue": "6",
              "newPrefix": "86", "priority": 200, "status": "active" }]
}
```

Host your own copy so ranges can change without an app release. If the fetch
fails the module uses its last cache, then the **bundled** PURA Phase 1 snapshot
(`BUNDLED_RULES`) — so it still works offline on first run.

## Headless (build your own UI)

```ts
import {
  loadRules, requestContactsPermission, readContacts,
  computePlan, applyPlan, openAppSettings,
} from './modules/gnm';

const perm = await requestContactsPermission();
if (perm === 'blocked') { await openAppSettings(); return; }
if (perm === 'denied')  { /* show your own "why we need this" prompt */ return; }

const { rules }                       = await loadRules();          // never throws (bundled fallback)
const { contacts, permission, rawCount } = await readContacts();    // {} shape, not a bare array
if (contacts.length === 0) { /* empty phonebook / limited access */ }

const plan   = computePlan(contacts, rules, 'add' /* or 'replace' */, ['COMIUM'] /* optional */);
// plan.candidates: 'Ready' | 'Manual Review' | 'Already Updated' | 'Duplicate Pair Found' | 'Skipped'
const ready  = plan.candidates.filter((c) => c.status === 'Ready');

try {
  const result = await applyPlan(ready, 'add', { onProgress: (p) => {} });
  // result: { updated, skipped, failed, failures[], backupId }
} catch (e) {
  if ((e as any).code === 'backup_failed') {
    // storage full — ask the user, then retry with { allowNoBackup: true }
  }
}
```

## Guarantees

- Contacts are read on-device; the only network call is fetching the rules JSON.
- A full snapshot of every affected contact is saved **before** any write; `restoreBackup(id)` reverses it.
- Only selected `Ready` numbers are touched. Already-migrated contacts are skipped.
- Each write is read back and verified; a change that did not persist (read-only account contacts) is reported, never counted as success.

## It never gets stuck

Every failure has a way forward, not a dead end:

| Situation | What the screen does |
|---|---|
| Permission not yet asked | asks on "Scan"; iOS "limited" access is accepted and flagged |
| Permission **denied** (can ask again) | a "why we need this" screen with **Allow and continue** |
| Permission **blocked** (permanently) | **Open Settings**, and it auto-continues when you return with it on |
| No contacts / no numbers | a plain "nothing to check" screen with *Scan again* / *Close* |
| Rules URL unreachable | last cache → then the **bundled** PURA snapshot; works fully offline |
| `@react-native-async-storage/async-storage` missing or failing | falls back to in-memory storage for the session (rules cache + backups still work; a footer note says they won't survive an app restart) |
| Backup can't be saved (storage full) | stops **before** any change; **Back — free up space** or **Continue without a backup** |
| A single contact write fails (read-only account) | counted as failed with a clear reason; the rest still migrate |
| App backgrounded mid-run | re-running is safe — already-migrated contacts are skipped (idempotent) |

## Files

| File | Role |
|---|---|
| `GNMEngine.ts` | pure logic — normalise, detect operator, `computePlan`, `previewNumber` |
| `MigrationRules.ts` | fetch + cache rules, bundled offline fallback |
| `ContactScanner.ts` | permission + read contacts (read-only) |
| `ContactUpdater.ts` | apply a plan — backup, write, verify |
| `BackupManager.ts` | create / list / restore / delete local backups |
| `GNMScreen.tsx` | the drop-in UI flow |
| `theme.ts` `config.ts` `types.ts` `index.ts` | tokens, settings, types, exports |
