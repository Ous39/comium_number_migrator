/**
 * Core data shapes for the number-migration engine.
 * Portable, framework-free — no React, no native imports here.
 */

export type RuleType = 'prefix' | 'range' | 'exact' | 'exception';
export type RuleStatus = 'active' | 'inactive';
export type OperatorStatus = 'active' | 'disabled';

/** How an accepted change is applied to the contact. */
export type UpdateMode = 'add' | 'replace';

export type MatchConfidence = 'high' | 'medium' | 'low' | 'manual_review';

export type CandidateStatus =
  | 'Ready' // a rule matched, safe to apply
  | 'Manual Review' // 7-digit but no rule matched, or ambiguous
  | 'Already Updated' // the migrated 9-digit number is already on the contact
  | 'Duplicate Pair Found' // both old and new already present
  | 'Skipped'; // excluded by an operator filter

export interface OperatorConfig {
  id: string;
  name: string;
  code: string;
  newPrefix: string;
  color?: string;
  status: OperatorStatus;
  notes?: string | null;
}

export interface MigrationRule {
  id: string;
  operatorId: string;
  operatorName: string;
  operatorCode?: string;
  ruleName: string;
  ruleType: RuleType;
  prefixValue?: string | null;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  exactNumber?: string | null;
  newPrefix: string;
  priority: number;
  status: RuleStatus;
  notes?: string | null;
}

export interface RulesPayload {
  versionNumber: number;
  publishedAt: string;
  operators: OperatorConfig[];
  rules: MigrationRule[];
}

export interface PhoneNormalizationResult {
  raw: string;
  digits: string;
  localDigits: string;
  type: 'old_7_digit' | 'new_9_digit' | 'invalid';
  countryCodeStripped: boolean;
}

export interface DetectionResult {
  matched: boolean;
  operatorId?: string;
  operatorName?: string;
  operatorCode?: string;
  newPrefix?: string;
  /** Local 9-digit migrated number, e.g. "867712345". */
  migratedNumber?: string;
  confidence: MatchConfidence;
  matchedRuleId?: string;
  matchedRuleType?: RuleType;
  reason: string;
  rulesVersion?: number;
}

/** A phone entry on a device contact. */
export interface ContactPhone {
  id?: string;
  label?: string;
  number: string;
}

/** A device contact reduced to what the engine needs. */
export interface DeviceContact {
  id: string;
  name: string;
  phoneNumbers: ContactPhone[];
}

/** One proposed change to one phone number on one contact. */
export interface MigrationCandidate {
  contactId: string;
  contactName: string;
  phoneIndex: number;
  phoneLabel?: string;
  /** The number as saved on the contact. */
  originalNumber: string;
  /** Local digits of the old number, if it was a valid 7-digit number. */
  normalizedOldNumber?: string;
  /** Local 9-digit result. Present only when a rule matched. */
  migratedNumber?: string;
  operatorName?: string;
  operatorId?: string;
  operatorCode?: string;
  matchConfidence: MatchConfidence;
  matchedRuleId?: string;
  matchedRuleType?: RuleType;
  updateMode: UpdateMode;
  status: CandidateStatus;
  reason: string;
  /** Snapshot of every phone on the contact at scan time — used for the backup. */
  beforePhoneNumbers?: ContactPhone[];
}

export interface MigrationPlan {
  candidates: MigrationCandidate[];
  summary: {
    ready: number;
    alreadyUpdated: number;
    review: number;
    skipped: number;
    totalContacts: number;
    affectedContacts: number;
  };
  rulesVersion: number;
  generatedAt: string;
}

export interface ApplyResult {
  updated: number;
  skipped: number;
  failed: number;
  failures: { contactId: string; contactName: string; reason: string }[];
  backupId: string;
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  contactCount: number;
  label: string;
}
