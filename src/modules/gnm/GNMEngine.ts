/**
 * GNMEngine — the pure migration brain.
 *
 * No React, no native modules, no network. Give it contacts + rules, it tells
 * you exactly what would change. Ported from the audited GNM shared package.
 */

import type {
  ContactPhone,
  DetectionResult,
  DeviceContact,
  MigrationCandidate,
  MigrationPlan,
  MigrationRule,
  PhoneNormalizationResult,
  RulesPayload,
  UpdateMode,
} from './types';

// ---------------------------------------------------------------------------
// Phone normalisation
// ---------------------------------------------------------------------------

export function digitsOnly(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

/** Classify a raw number as an old 7-digit, a new 9-digit, or invalid. */
export function normalizeGambianPhone(raw: string): PhoneNormalizationResult {
  const digits = digitsOnly(raw);
  const comparableDigits = digits.startsWith('00220') ? digits.slice(2) : digits;
  let localDigits = comparableDigits;
  let countryCodeStripped = false;

  if (
    comparableDigits.startsWith('220') &&
    (comparableDigits.length === 10 || comparableDigits.length === 12)
  ) {
    localDigits = comparableDigits.slice(3);
    countryCodeStripped = true;
  }

  if (localDigits.length === 7) {
    return { raw, digits, localDigits, type: 'old_7_digit', countryCodeStripped };
  }
  if (localDigits.length === 9) {
    return { raw, digits, localDigits, type: 'new_9_digit', countryCodeStripped };
  }
  return { raw, digits, localDigits, type: 'invalid', countryCodeStripped };
}

export function sameLocalNumber(a: string, b: string): boolean {
  const left = normalizeGambianPhone(a);
  const right = normalizeGambianPhone(b);
  return (
    left.type !== 'invalid' &&
    right.type !== 'invalid' &&
    left.localDigits === right.localDigits
  );
}

/** Keep the migrated number in the same +220 / 00220 / bare format as the original. */
export function formatMigratedLikeOriginal(original: string, migratedLocalDigits: string): string {
  const trimmed = String(original || '').trim();
  const rawDigits = digitsOnly(trimmed);
  if (trimmed.startsWith('+220')) return `+220 ${migratedLocalDigits}`;
  if (rawDigits.startsWith('00220')) return `00220${migratedLocalDigits}`;
  if (rawDigits.startsWith('220')) return `220${migratedLocalDigits}`;
  return migratedLocalDigits;
}

export function formatLocalForDisplay(localDigits: string): string {
  if (localDigits.length === 7) return `${localDigits.slice(0, 3)} ${localDigits.slice(3)}`;
  if (localDigits.length === 9) {
    return `${localDigits.slice(0, 2)} ${localDigits.slice(2, 5)} ${localDigits.slice(5)}`;
  }
  return localDigits;
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

function activeRules(payload: Pick<RulesPayload, 'rules'>): MigrationRule[] {
  return (payload.rules || []).filter((r) => r.status === 'active');
}

/** Higher = more specific. Exact beats range beats a long prefix beats a short one. */
export function ruleSpecificity(rule: MigrationRule): number {
  if (rule.ruleType === 'exact') return 4000;
  if (rule.ruleType === 'exception') {
    return 3000 + Math.max(rule.prefixValue?.length || 0, rule.exactNumber?.length || 0);
  }
  if (rule.ruleType === 'range') return 2000;
  if (rule.ruleType === 'prefix') return 1000 + (rule.prefixValue?.length || 0);
  return 0;
}

export function sortRulesForDetection(rules: MigrationRule[]): MigrationRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return ruleSpecificity(b) - ruleSpecificity(a);
  });
}

function matchesRule(oldNumber: string, rule: MigrationRule): boolean {
  if (rule.ruleType === 'exact') return oldNumber === rule.exactNumber;
  if (rule.ruleType === 'range') {
    return Number(oldNumber) >= Number(rule.rangeFrom) && Number(oldNumber) <= Number(rule.rangeTo);
  }
  if (rule.ruleType === 'prefix') return !!rule.prefixValue && oldNumber.startsWith(rule.prefixValue);
  if (rule.ruleType === 'exception') {
    if (rule.exactNumber && oldNumber === rule.exactNumber) return true;
    if (rule.prefixValue && oldNumber.startsWith(rule.prefixValue)) return true;
    if (
      rule.rangeFrom &&
      rule.rangeTo &&
      Number(oldNumber) >= Number(rule.rangeFrom) &&
      Number(oldNumber) <= Number(rule.rangeTo)
    ) {
      return true;
    }
  }
  return false;
}

/** Which operator does this old 7-digit number belong to, and what does it become? */
export function detectOperator(oldRaw: string, payload: RulesPayload): DetectionResult {
  const normalized = normalizeGambianPhone(oldRaw);
  const versionNumber = payload.versionNumber;
  if (normalized.type !== 'old_7_digit') {
    return {
      matched: false,
      confidence: 'manual_review',
      reason: 'Number is not a 7-digit old Gambian number.',
      rulesVersion: versionNumber,
    };
  }
  const oldNumber = normalized.localDigits;
  const matches = sortRulesForDetection(activeRules(payload)).filter((rule) =>
    matchesRule(oldNumber, rule),
  );
  const matched = matches[0];
  if (!matched) {
    return {
      matched: false,
      confidence: 'manual_review',
      reason: 'No active rule matched this number. Manual review required.',
      rulesVersion: versionNumber,
    };
  }
  const ambiguous = matches.find(
    (rule) =>
      rule.id !== matched.id &&
      rule.priority === matched.priority &&
      ruleSpecificity(rule) === ruleSpecificity(matched) &&
      (rule.operatorId !== matched.operatorId || rule.newPrefix !== matched.newPrefix),
  );
  if (ambiguous) {
    return {
      matched: false,
      confidence: 'manual_review',
      reason: `Conflicting rules matched with equal priority: ${matched.ruleName} and ${ambiguous.ruleName}.`,
      rulesVersion: versionNumber,
    };
  }
  const migratedNumber = `${matched.newPrefix}${oldNumber}`;
  if (!/^\d{9}$/.test(migratedNumber)) {
    return {
      matched: false,
      confidence: 'manual_review',
      reason: 'Matched rule did not produce a valid 9-digit number.',
      rulesVersion: versionNumber,
    };
  }
  return {
    matched: true,
    operatorId: matched.operatorId,
    operatorName: matched.operatorName,
    operatorCode: matched.operatorCode,
    newPrefix: matched.newPrefix,
    migratedNumber,
    confidence: matched.ruleType === 'prefix' ? 'medium' : 'high',
    matchedRuleId: matched.id,
    matchedRuleType: matched.ruleType,
    reason: `${matched.ruleType} rule matched: ${matched.ruleName}`,
    rulesVersion: versionNumber,
  };
}

export function verifyMigratedPair(
  oldRaw: string,
  newRaw: string,
  payload: RulesPayload,
): DetectionResult {
  const oldNormalized = normalizeGambianPhone(oldRaw);
  const newNormalized = normalizeGambianPhone(newRaw);
  if (oldNormalized.type !== 'old_7_digit' || newNormalized.type !== 'new_9_digit') {
    return {
      matched: false,
      confidence: 'manual_review',
      reason: 'Old/new pair is not in the expected 7-digit and 9-digit formats.',
    };
  }
  const detection = detectOperator(oldNormalized.localDigits, payload);
  if (!detection.matched || !detection.migratedNumber) return detection;
  if (detection.migratedNumber !== newNormalized.localDigits) {
    return {
      ...detection,
      matched: false,
      confidence: 'manual_review',
      reason: 'The new number does not match the current rule-generated migrated number.',
    };
  }
  return { ...detection, reason: 'Old and new numbers are a verified migration pair.' };
}

/** True when a rules payload has at least one usable active rule. */
export function rulesUsable(payload: RulesPayload | null | undefined): boolean {
  return !!payload && Array.isArray(payload.rules) && payload.rules.some((r) => r.status === 'active');
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

function snapshot(phones: ContactPhone[]): ContactPhone[] {
  return phones.map((p) => ({ id: p.id, label: p.label, number: p.number }));
}

/**
 * Turn a contact list into a full set of proposed changes.
 * `operatorFilter` (operator codes, e.g. ['COMIUM']) marks non-matching
 * candidates as 'Skipped' instead of 'Ready'. Omit it to migrate every operator.
 */
export function buildCandidates(
  contacts: DeviceContact[],
  payload: RulesPayload,
  updateMode: UpdateMode,
  operatorFilter?: string[],
): MigrationCandidate[] {
  const allow = operatorFilter && operatorFilter.length
    ? new Set(operatorFilter.map((c) => c.toUpperCase()))
    : null;
  const candidates: MigrationCandidate[] = [];

  for (const contact of contacts) {
    const phoneNumbers = contact.phoneNumbers || [];
    const normalizedNumbers = phoneNumbers.map((p) => normalizeGambianPhone(p.number));

    // Old numbers whose migrated form is already saved on the same contact.
    const pairedNewNumbers = new Set<string>();
    for (const normalized of normalizedNumbers) {
      if (normalized.type !== 'old_7_digit') continue;
      const detection = detectOperator(normalized.localDigits, payload);
      if (
        detection.matched &&
        detection.migratedNumber &&
        normalizedNumbers.some(
          (v) => v.type === 'new_9_digit' && v.localDigits === detection.migratedNumber,
        )
      ) {
        pairedNewNumbers.add(detection.migratedNumber);
      }
    }

    phoneNumbers.forEach((phone, phoneIndex) => {
      const normalized = normalizeGambianPhone(phone.number);

      if (normalized.type === 'new_9_digit') {
        if (pairedNewNumbers.has(normalized.localDigits)) return; // covered by its old-number row
        const possibleOld = normalized.localDigits.slice(2);
        const detection = detectOperator(possibleOld, payload);
        const isVerified = detection.matched && detection.migratedNumber === normalized.localDigits;
        candidates.push({
          contactId: contact.id,
          contactName: contact.name || 'Unnamed contact',
          phoneIndex,
          phoneLabel: phone.label,
          originalNumber: phone.number,
          normalizedOldNumber: isVerified ? possibleOld : undefined,
          migratedNumber: normalized.localDigits,
          operatorName: isVerified ? detection.operatorName : undefined,
          operatorId: isVerified ? detection.operatorId : undefined,
          operatorCode: isVerified ? detection.operatorCode : undefined,
          matchConfidence: isVerified ? detection.confidence : 'manual_review',
          matchedRuleId: isVerified ? detection.matchedRuleId : undefined,
          matchedRuleType: isVerified ? detection.matchedRuleType : undefined,
          updateMode,
          status: isVerified ? 'Already Updated' : 'Manual Review',
          reason: isVerified
            ? 'A verified new 9-digit number is already saved on this contact.'
            : 'This is a 9-digit number that does not match a rule. No change will be made.',
          beforePhoneNumbers: snapshot(phoneNumbers),
        });
        return;
      }

      if (normalized.type !== 'old_7_digit') return;

      const detection = detectOperator(normalized.localDigits, payload);
      if (!detection.matched || !detection.migratedNumber) {
        candidates.push({
          contactId: contact.id,
          contactName: contact.name || 'Unnamed contact',
          phoneIndex,
          phoneLabel: phone.label,
          originalNumber: phone.number,
          normalizedOldNumber: normalized.localDigits,
          matchConfidence: detection.confidence,
          updateMode,
          status: 'Manual Review',
          reason: detection.reason,
          beforePhoneNumbers: snapshot(phoneNumbers),
        });
        return;
      }

      const hasMatchingNew = normalizedNumbers.some(
        (n) => n.type === 'new_9_digit' && n.localDigits === detection.migratedNumber,
      );
      const filteredOut = allow && detection.operatorCode
        ? !allow.has(detection.operatorCode.toUpperCase())
        : false;

      candidates.push({
        contactId: contact.id,
        contactName: contact.name || 'Unnamed contact',
        phoneIndex,
        phoneLabel: phone.label,
        originalNumber: phone.number,
        normalizedOldNumber: normalized.localDigits,
        migratedNumber: detection.migratedNumber,
        operatorName: detection.operatorName,
        operatorId: detection.operatorId,
        operatorCode: detection.operatorCode,
        matchConfidence: detection.confidence,
        matchedRuleId: detection.matchedRuleId,
        matchedRuleType: detection.matchedRuleType,
        updateMode,
        status: hasMatchingNew ? 'Duplicate Pair Found' : filteredOut ? 'Skipped' : 'Ready',
        reason: hasMatchingNew
          ? 'The matching new number already exists on this contact.'
          : filteredOut
            ? `${detection.operatorName} numbers are not included in this run.`
            : detection.reason,
        beforePhoneNumbers: snapshot(phoneNumbers),
      });
    });
  }

  return candidates;
}

/** buildCandidates + a headline summary. This is what the UI consumes. */
export function computePlan(
  contacts: DeviceContact[],
  payload: RulesPayload,
  updateMode: UpdateMode = 'add',
  operatorFilter?: string[],
): MigrationPlan {
  const candidates = buildCandidates(contacts, payload, updateMode, operatorFilter);
  const ready = candidates.filter((c) => c.status === 'Ready');
  const alreadyUpdated = candidates.filter(
    (c) => c.status === 'Already Updated' || c.status === 'Duplicate Pair Found',
  );
  const review = candidates.filter((c) => c.status === 'Manual Review');
  const skipped = candidates.filter((c) => c.status === 'Skipped');
  const affected = new Set(ready.map((c) => c.contactId));

  return {
    candidates,
    summary: {
      ready: ready.length,
      alreadyUpdated: alreadyUpdated.length,
      review: review.length,
      skipped: skipped.length,
      totalContacts: contacts.length,
      affectedContacts: affected.size,
    },
    rulesVersion: payload.versionNumber,
    generatedAt: new Date().toISOString(),
  };
}

/** Single-number preview, for an optional inline "what will my number become?" widget. */
export function previewNumber(raw: string, payload: RulesPayload): {
  input: string;
  type: PhoneNormalizationResult['type'];
  result: string | null;
  operatorName?: string;
  reason: string;
} {
  const norm = normalizeGambianPhone(raw);
  if (norm.type === 'new_9_digit') {
    return { input: raw, type: norm.type, result: norm.localDigits, reason: 'Already a 9-digit number.' };
  }
  if (norm.type !== 'old_7_digit') {
    return { input: raw, type: norm.type, result: null, reason: 'Enter a 7-digit Gambian number.' };
  }
  const d = detectOperator(norm.localDigits, payload);
  return {
    input: raw,
    type: norm.type,
    result: d.migratedNumber || null,
    operatorName: d.operatorName,
    reason: d.reason,
  };
}
