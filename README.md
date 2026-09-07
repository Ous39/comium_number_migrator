# Comium Number Migrator

A **drop-in React Native module** that updates the numbers saved in a phone's
contacts from the old 7-digit Gambian format to the new 9-digit PURA format —
scan, preview, back up, migrate, restore.

It is designed to live **inside the Comium app**, behind an "Update contacts"
button. No separate app, no store account of its own, no payment, no login.

```
src/modules/gnm/        ← copy this folder into your app
  GNMEngine.ts          pure logic: normalise, detect operator, computePlan, previewNumber
  MigrationRules.ts     fetch + cache the 7→9 rules; bundled offline fallback (PURA Phase 1)
  ContactScanner.ts     permission + read contacts (read-only)
  ContactUpdater.ts     apply a plan — backup first, write, verify each change
  BackupManager.ts      create / list / restore / delete local backups
  GNMScreen.tsx          the themed UI flow (Comium red by default)
  config.ts theme.ts types.ts index.ts

example/App.tsx          the entire integration: a button + <GNMScreen> in a Modal
```

## Quick start

1. Copy `src/modules/gnm/` into the Comium app.
2. Install the two peer deps:
   ```bash
   npx expo install expo-contacts @react-native-async-storage/async-storage
   ```
3. Add the iOS contacts purpose string (`src/modules/gnm/README.md`).
4. Wire the button:
   ```tsx
   import { GNMScreen, configureGNM } from './modules/gnm';

   configureGNM({ rulesUrl: 'https://<your-host>/migration-rules', productName: 'Comium Number Migrator' });

   <Modal visible={open} animationType="slide" onRequestClose={close}>
     <GNMScreen onClose={close} onComplete={(r) => {/* r.updated / r.failed */}} />
   </Modal>
   ```

Full details, the rules-JSON shape, headless usage, and per-file docs are in
[`src/modules/gnm/README.md`](src/modules/gnm/README.md).

## Guarantees

- Contacts are read and written **on the device**. The only network call is
  fetching the rules JSON — no contact data leaves the phone, no accounts, no PII.
- A snapshot of every affected contact is saved **before** any write; one tap
  restores it.
- Only the numbers the user selected are changed; already-migrated contacts are
  skipped; every write is verified and read-only contacts are reported honestly.

## It never dead-ends

Denied permission → a "why", plus **Open Settings** that auto-resumes when the
user comes back. Blocked storage → stop before any change, offer *continue
without a backup*. Rules URL down → last cache, then the bundled PURA snapshot
(fully offline). `async-storage` missing → in-memory fallback for the session.
Empty phonebook, a read-only contact, the app backgrounded mid-run — each has a
clear next step, and re-running is always safe (idempotent). Full table in
[`src/modules/gnm/README.md`](src/modules/gnm/README.md).

## Rules

`configureGNM({ rulesUrl })` should point at a JSON endpoint Comium hosts, so the
operator ranges can be corrected without shipping an app update. If it is
unreachable the module falls back to the last cache, then the bundled PURA
Phase 1 snapshot (`BUNDLED_RULES` in `MigrationRules.ts`).

## Restricting to Comium numbers (optional)

```ts
configureGNM({ operatorFilter: ['COMIUM'] });
```

Numbers on other operators then show as "not included" instead of "ready".
Leave it unset to migrate every Gambian number.
