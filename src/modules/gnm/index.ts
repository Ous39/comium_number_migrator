/**
 * GNM number-migration module — public surface.
 *
 * Drop-in usage (React Native / Expo):
 *
 *   import { GNMScreen, configureGNM } from './modules/gnm';
 *
 *   configureGNM({ rulesUrl: 'https://<your-host>/migration-rules', productName: 'Comium Migrator' });
 *
 *   {open && (
 *     <Modal animationType="slide" onRequestClose={() => setOpen(false)}>
 *       <GNMScreen onClose={() => setOpen(false)} onComplete={(r) => console.log(r)} />
 *     </Modal>
 *   )}
 *
 * Headless usage (bring your own UI):
 *
 *   const { rules } = await loadRules();
 *   const contacts  = await readContacts();
 *   const plan      = computePlan(contacts, rules, 'add');
 *   const result    = await applyPlan(plan.candidates.filter(c => c.status === 'Ready'), 'add');
 */

export { GNMScreen, default as GNMScreenDefault } from './GNMScreen';
export type { GNMScreenProps } from './GNMScreen';

export { configureGNM, getConfig, resetGNMConfig } from './config';
export type { GnmConfig } from './config';

export { COMIUM_THEME } from './theme';
export type { GnmTheme } from './theme';

export { loadRules, refreshRules, BUNDLED_RULES } from './MigrationRules';
export type { RulesSource } from './MigrationRules';

export { ensureContactsPermission, readContacts } from './ContactScanner';
export type { ScanProgress } from './ContactScanner';

export {
  computePlan,
  buildCandidates,
  previewNumber,
  detectOperator,
  verifyMigratedPair,
  normalizeGambianPhone,
  sameLocalNumber,
  formatLocalForDisplay,
  formatMigratedLikeOriginal,
  rulesUsable,
} from './GNMEngine';

export { applyPlan } from './ContactUpdater';
export type { ApplyProgress } from './ContactUpdater';

export {
  createBackup,
  listBackups,
  getBackup,
  restoreBackup,
  deleteBackup,
} from './BackupManager';
export type { BackupRecord, RestoreProgress } from './BackupManager';

export type {
  ApplyResult,
  BackupSummary,
  CandidateStatus,
  ContactPhone,
  DetectionResult,
  DeviceContact,
  MatchConfidence,
  MigrationCandidate,
  MigrationPlan,
  MigrationRule,
  OperatorConfig,
  PhoneNormalizationResult,
  RulesPayload,
  UpdateMode,
} from './types';
