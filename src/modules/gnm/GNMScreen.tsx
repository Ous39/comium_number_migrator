/**
 * GNMScreen — the full drop-in migration flow.
 *
 *   <GNMScreen onClose={() => ...} onComplete={(summary) => ...} />
 *
 * Renders its own screens: intro -> scan -> review -> apply -> done, plus a
 * "restore a backup" path. Pure React Native primitives, themed via
 * configureGNM({ theme }). The host provides navigation/modal chrome.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getConfig } from './config';
import {
  computePlan,
  formatLocalForDisplay,
  normalizeGambianPhone,
  rulesUsable,
} from './GNMEngine';
import { loadRules, RulesSource } from './MigrationRules';
import {
  getPermissionState,
  openAppSettings,
  PermissionState,
  readContacts,
} from './ContactScanner';
import { applyPlan, ApplyProgress } from './ContactUpdater';
import { backupsArePersistent, deleteBackup, listBackups, restoreBackup } from './BackupManager';
import type {
  ApplyResult,
  BackupSummary,
  MigrationCandidate,
  MigrationPlan,
  UpdateMode,
} from './types';

export interface GNMScreenProps {
  /** Called when the user closes the flow (X button or "Done"). */
  onClose?: () => void;
  /** Called once the migration finishes, with the result counts. */
  onComplete?: (result: ApplyResult) => void;
  /** Start on the restore screen instead of the intro. */
  initialView?: 'intro' | 'restore';
}

type View_ =
  | 'intro'
  | 'scanning'
  | 'permission'
  | 'empty'
  | 'review'
  | 'backupWarn'
  | 'applying'
  | 'done'
  | 'error'
  | 'restore'
  | 'restoring'
  | 'restoreDone';

const TOP_PAD = Platform.OS === 'android' ? 24 : 8;

export function GNMScreen({ onClose, onComplete, initialView = 'intro' }: GNMScreenProps) {
  const cfg = getConfig();
  const t = cfg.theme;

  const [view, setView] = useState<View_>(initialView);
  const [errorMsg, setErrorMsg] = useState('');
  const [scanText, setScanText] = useState('');
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [rulesSource, setRulesSource] = useState<RulesSource>('bundled');
  const [mode, setMode] = useState<UpdateMode>(cfg.defaultMode);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [applyProg, setApplyProg] = useState<ApplyProgress | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [restoreProg, setRestoreProg] = useState<{ processed: number; total: number } | null>(null);
  const [restoreOutcome, setRestoreOutcome] = useState<{ restored: number; failed: number } | null>(null);
  const [permState, setPermState] = useState<PermissionState>('undetermined');
  const [limited, setLimited] = useState(false);
  const pendingChosen = useRef<MigrationCandidate[]>([]);

  const keyOf = (c: MigrationCandidate) =>
    `${c.contactId}:${c.phoneIndex}:${c.originalNumber}:${c.migratedNumber || 'x'}`;

  const readyCandidates = useMemo(
    () => (plan ? plan.candidates.filter((c) => c.status === 'Ready') : []),
    [plan],
  );
  const reviewCandidates = useMemo(
    () => (plan ? plan.candidates.filter((c) => c.status === 'Manual Review') : []),
    [plan],
  );
  const doneCandidates = useMemo(
    () =>
      plan
        ? plan.candidates.filter(
            (c) => c.status === 'Already Updated' || c.status === 'Duplicate Pair Found',
          )
        : [],
    [plan],
  );

  const startScan = useCallback(async () => {
    setView('scanning');
    setErrorMsg('');
    try {
      setScanText('Loading the numbering rules…');
      const { rules, source } = await loadRules();
      setRulesSource(source);
      if (!rulesUsable(rules)) {
        setErrorMsg(
          'The numbering rules could not be loaded and no offline copy is available. Connect to the internet and try again.',
        );
        setView('error');
        return;
      }

      setScanText('Reading your contacts…');
      const { contacts, permission, rawCount } = await readContacts((p) =>
        setScanText(`Reading your contacts… ${p.processed} / ${p.total}`),
      );
      setPermState(permission);
      setLimited(permission === 'limited');

      if (rawCount === 0 || contacts.length === 0) {
        setView('empty');
        return;
      }

      setScanText('Checking against the rules…');
      const nextPlan = computePlan(contacts, rules, mode, cfg.operatorFilter);
      setPlan(nextPlan);
      setSelectedKeys(new Set(nextPlan.candidates.filter((c) => c.status === 'Ready').map(keyOf)));
      setView('review');
    } catch (e: any) {
      const code = e?.code;
      if (code === 'permission_blocked') {
        setPermState('blocked');
        setView('permission');
        return;
      }
      if (code === 'permission_denied') {
        setPermState('denied');
        setView('permission');
        return;
      }
      setErrorMsg(e?.message || 'Something went wrong while scanning.');
      setView('error');
    }
  }, [mode, cfg.operatorFilter]);

  // While the permission screen is up, re-check whenever the app returns to the
  // foreground (the user may have flipped the toggle in Settings) and proceed.
  useEffect(() => {
    if (view !== 'permission') return;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      const now = await getPermissionState();
      if (now === 'granted' || now === 'limited') startScan();
    });
    return () => sub.remove();
  }, [view, startScan]);

  // Recompute when the user flips add/replace on the review screen.
  useEffect(() => {
    if (view !== 'review' || !plan) return;
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            candidates: prev.candidates.map((c) => ({ ...c, updateMode: mode })),
          }
        : prev,
    );
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (c: MigrationCandidate) => {
    const k = keyOf(c);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };
  const setAll = (on: boolean) =>
    setSelectedKeys(on ? new Set(readyCandidates.map(keyOf)) : new Set());

  const doApply = useCallback(
    async (chosen: MigrationCandidate[], allowNoBackup: boolean) => {
      setView('applying');
      setApplyProg({ processed: 0, total: chosen.length, updated: 0, skipped: 0, failed: 0 });
      try {
        const r = await applyPlan(chosen, mode, { onProgress: setApplyProg, allowNoBackup });
        setResult(r);
        setView('done');
        onComplete?.(r);
      } catch (e: any) {
        if (e?.code === 'backup_failed') {
          pendingChosen.current = chosen;
          setView('backupWarn');
          return;
        }
        setErrorMsg(e?.message || 'The migration could not be completed.');
        setView('error');
      }
    },
    [mode, onComplete],
  );

  const runMigration = useCallback(() => {
    if (!plan) return;
    const chosen = readyCandidates.filter((c) => selectedKeys.has(keyOf(c)));
    if (!chosen.length) return;
    doApply(chosen, false);
  }, [plan, readyCandidates, selectedKeys, doApply]);

  const openRestore = useCallback(async () => {
    setBackups(await listBackups());
    setView('restore');
  }, []);

  const runRestore = useCallback(async (id: string) => {
    setView('restoring');
    setRestoreProg({ processed: 0, total: 1 });
    try {
      const outcome = await restoreBackup(id, setRestoreProg);
      setRestoreOutcome(outcome);
      setView('restoreDone');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Restore failed.');
      setView('error');
    }
  }, []);

  const styles = useMemo(() => makeStyles(t), [t]);
  const selectedCount = selectedKeys.size;

  // -------------------------------------------------------------- render
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {view === 'restore' || view === 'restoring' || view === 'restoreDone'
            ? 'Restore contacts'
            : cfg.productName}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={12}
          style={styles.closeBtn}
        >
          <Text style={styles.closeX}>✕</Text>
        </Pressable>
      </View>

      {view === 'intro' && (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>Update your saved contacts</Text>
          <Text style={styles.p}>
            The Gambia is moving mobile numbers from 7 digits to 9 digits. This updates the
            numbers already saved in your phone so your contacts keep working.
          </Text>
          <View style={styles.noteCard}>
            <Bullet t={t}>Your contacts are read on this device only — nothing is uploaded.</Bullet>
            <Bullet t={t}>A backup is taken before any change, and you can undo it.</Bullet>
            <Bullet t={t}>You choose exactly which contacts to update.</Bullet>
          </View>
          <PrimaryButton t={t} label="Scan my contacts" onPress={startScan} />
          <GhostButton t={t} label="Restore a previous backup" onPress={openRestore} />
        </ScrollView>
      )}

      {view === 'scanning' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={styles.centeredText}>{scanText}</Text>
        </View>
      )}

      {view === 'permission' && (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>Allow access to contacts</Text>
          <Text style={styles.p}>
            {permState === 'blocked'
              ? 'Contacts access is turned off for this app. Open Settings, turn on Contacts, then come back — this screen continues on its own.'
              : 'This needs permission to read your contacts so it can find the numbers that are changing. Your contacts stay on this device and are never uploaded.'}
          </Text>
          {permState === 'blocked' ? (
            <>
              <PrimaryButton t={t} label="Open Settings" onPress={openAppSettings} />
              <GhostButton t={t} label="I've turned it on — check again" onPress={startScan} />
            </>
          ) : (
            <>
              <PrimaryButton t={t} label="Allow and continue" onPress={startScan} />
              <GhostButton t={t} label="Not now" onPress={onClose} />
            </>
          )}
        </ScrollView>
      )}

      {view === 'empty' && (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>No contacts to check</Text>
          <Text style={styles.p}>
            {limited
              ? "You've shared only some contacts with this app, and none of them have a phone number to update. Share more contacts, then scan again."
              : 'No saved contacts with a phone number were found on this device. Add a contact with a number and scan again.'}
          </Text>
          {limited && <PrimaryButton t={t} label="Choose which contacts to share" onPress={openAppSettings} />}
          <GhostButton t={t} label="Scan again" onPress={startScan} />
          <GhostButton t={t} label="Close" onPress={onClose} />
        </ScrollView>
      )}

      {view === 'backupWarn' && (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>Backup couldn't be saved</Text>
          <Text style={styles.p}>
            A backup of the contacts about to change could not be stored on this device — usually
            because storage is full. Nothing has been changed yet. Free up some space and try again,
            or continue without a backup (you won't be able to undo with one tap).
          </Text>
          <PrimaryButton t={t} label="Back — I'll free up space" onPress={() => setView('review')} />
          <GhostButton
            t={t}
            label="Continue without a backup"
            onPress={() => doApply(pendingChosen.current, true)}
          />
        </ScrollView>
      )}

      {view === 'review' && plan && (
        <>
          {limited && (
            <Pressable onPress={openAppSettings} style={styles.limitedBar}>
              <Text style={styles.limitedText}>
                You've shared only some contacts. Tap to choose more.
              </Text>
            </Pressable>
          )}
          <View style={styles.reviewTop}>
            <View style={styles.chipRow}>
              <Chip t={t} tone="primary" label={`${plan.summary.ready} to update`} />
              {plan.summary.review > 0 && (
                <Chip t={t} tone="warning" label={`${plan.summary.review} to review`} />
              )}
              {plan.summary.alreadyUpdated > 0 && (
                <Chip t={t} tone="muted" label={`${plan.summary.alreadyUpdated} already done`} />
              )}
              {plan.summary.skipped > 0 && (
                <Chip t={t} tone="muted" label={`${plan.summary.skipped} not included`} />
              )}
            </View>

            <View style={styles.modeRow}>
              <ModeToggle
                t={t}
                value={mode}
                onChange={setMode}
                options={[
                  { key: 'add', label: 'Add new, keep old' },
                  { key: 'replace', label: 'Replace old number' },
                ]}
              />
            </View>

            {readyCandidates.length > 0 && (
              <View style={styles.selectRow}>
                <Text style={styles.selectMeta}>
                  {selectedCount} of {readyCandidates.length} selected
                </Text>
                <View style={{ flexDirection: 'row', gap: 14 }}>
                  <Pressable onPress={() => setAll(true)} hitSlop={8}>
                    <Text style={styles.link}>All</Text>
                  </Pressable>
                  <Pressable onPress={() => setAll(false)} hitSlop={8}>
                    <Text style={styles.link}>None</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 16 }}
            data={[
              ...sectionHeader('Ready to update', readyCandidates),
              ...readyCandidates.map((c) => ({ kind: 'ready' as const, c })),
              ...sectionHeader('Needs manual review', reviewCandidates),
              ...reviewCandidates.map((c) => ({ kind: 'review' as const, c })),
              ...sectionHeader('Already updated', doneCandidates),
              ...doneCandidates.map((c) => ({ kind: 'done' as const, c })),
            ]}
            keyExtractor={(row, idx) =>
              row.kind === 'header' ? `h-${row.title}-${idx}` : `${row.kind}-${keyOf(row.c)}`
            }
            renderItem={({ item }) => {
              if (item.kind === 'header') {
                return <Text style={styles.sectionTitle}>{item.title}</Text>;
              }
              const { c } = item;
              const checked = selectedKeys.has(keyOf(c));
              return (
                <CandidateRow
                  t={t}
                  name={c.contactName}
                  from={displayNumber(c.originalNumber)}
                  to={
                    c.migratedNumber
                      ? formatLocalForDisplay(c.migratedNumber)
                      : undefined
                  }
                  meta={c.operatorName || c.reason}
                  reason={item.kind === 'review' ? c.reason : undefined}
                  selectable={item.kind === 'ready'}
                  checked={checked}
                  muted={item.kind === 'done'}
                  onPress={() => item.kind === 'ready' && toggle(c)}
                />
              );
            }}
          />

          <View style={styles.footer}>
            {rulesSource === 'bundled' && (
              <Text style={styles.footerNote}>Using offline rules — connect once to get the latest.</Text>
            )}
            {!backupsArePersistent && (
              <Text style={styles.footerNote}>
                Backups will only last until you close the app on this device.
              </Text>
            )}
            <PrimaryButton
              t={t}
              label={
                selectedCount > 0
                  ? `Update ${selectedCount} number${selectedCount === 1 ? '' : 's'}`
                  : 'Select numbers to update'
              }
              disabled={selectedCount === 0}
              onPress={runMigration}
            />
          </View>
        </>
      )}

      {view === 'applying' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={styles.centeredText}>
            {applyProg
              ? `Updating contacts… ${applyProg.processed} / ${applyProg.total}`
              : 'Backing up your contacts…'}
          </Text>
          {applyProg && <ProgressBar t={t} pct={applyProg.total ? applyProg.processed / applyProg.total : 0} />}
        </View>
      )}

      {view === 'done' && result && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.badge, { backgroundColor: t.success }]}>
            <Text style={styles.badgeMark}>✓</Text>
          </View>
          <Text style={styles.h1}>Contacts updated</Text>
          <Text style={styles.p}>
            {result.updated} contact{result.updated === 1 ? '' : 's'} updated
            {result.skipped ? ` · ${result.skipped} already done` : ''}
            {result.failed ? ` · ${result.failed} could not be changed` : ''}.
          </Text>

          {result.failures.length > 0 && (
            <View style={styles.noteCard}>
              <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Couldn't update</Text>
              {result.failures.slice(0, 20).map((f, i) => (
                <Text key={i} style={styles.failLine}>
                  <Text style={{ fontWeight: '700' }}>{f.contactName}</Text> — {f.reason}
                </Text>
              ))}
            </View>
          )}

          <PrimaryButton t={t} label="Done" onPress={onClose} />
          <GhostButton
            t={t}
            label="Undo — restore the backup"
            onPress={() => runRestore(result.backupId)}
          />
        </ScrollView>
      )}

      {view === 'restore' && (
        <View style={{ flex: 1 }}>
          {backups.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.centeredText}>No backups on this device yet.</Text>
              <GhostButton t={t} label="Back" onPress={() => setView('intro')} />
            </View>
          ) : (
            <FlatList
              contentContainerStyle={{ padding: 16 }}
              data={backups}
              keyExtractor={(b) => b.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.backupRow}
                  onPress={() => runRestore(item.id)}
                  onLongPress={async () => {
                    await deleteBackup(item.id);
                    setBackups(await listBackups());
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.backupTitle}>{item.label}</Text>
                    <Text style={styles.backupMeta}>
                      {new Date(item.createdAt).toLocaleString()} · {item.contactCount} contact
                      {item.contactCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={[styles.link, { color: t.primary }]}>Restore</Text>
                </Pressable>
              )}
              ListFooterComponent={
                <Text style={styles.footerNote}>Long-press a backup to delete it.</Text>
              }
            />
          )}
        </View>
      )}

      {view === 'restoring' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={t.primary} />
          <Text style={styles.centeredText}>
            {restoreProg ? `Restoring… ${restoreProg.processed} / ${restoreProg.total}` : 'Restoring…'}
          </Text>
        </View>
      )}

      {view === 'restoreDone' && restoreOutcome && (
        <View style={styles.body}>
          <Text style={styles.h1}>Restore complete</Text>
          <Text style={styles.p}>
            {restoreOutcome.restored} contact{restoreOutcome.restored === 1 ? '' : 's'} restored
            {restoreOutcome.failed ? ` · ${restoreOutcome.failed} could not be restored` : ''}.
          </Text>
          <PrimaryButton t={t} label="Done" onPress={onClose} />
        </View>
      )}

      {view === 'error' && (
        <View style={styles.body}>
          <Text style={styles.h1}>Something went wrong</Text>
          <Text style={styles.p}>{errorMsg}</Text>
          <PrimaryButton t={t} label="Try again" onPress={() => setView('intro')} />
          <GhostButton t={t} label="Close" onPress={onClose} />
        </View>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------- bits

type Row =
  | { kind: 'header'; title: string }
  | { kind: 'ready' | 'review' | 'done'; c: MigrationCandidate };

function sectionHeader(title: string, list: unknown[]): Row[] {
  return list.length ? [{ kind: 'header', title }] : [];
}

function displayNumber(raw: string): string {
  const n = normalizeGambianPhone(raw);
  return n.type === 'invalid' ? raw : formatLocalForDisplay(n.localDigits);
}

function Bullet({ children, t }: { children: React.ReactNode; t: any }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
      <Text style={{ color: t.primary, fontWeight: '900' }}>•</Text>
      <Text style={{ color: t.subtext, flex: 1, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  t,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  t: any;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: disabled ? t.border : t.primary,
          borderRadius: t.radius,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 14,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Text style={{ color: disabled ? t.subtext : t.primaryText, fontWeight: '800', fontSize: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function GhostButton({ label, onPress, t }: { label: string; onPress?: () => void; t: any }) {
  return (
    <Pressable onPress={onPress} style={{ minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
      <Text style={{ color: t.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, tone, t }: { label: string; tone: 'primary' | 'warning' | 'muted'; t: any }) {
  const map = {
    primary: { bg: t.primary + '18', fg: t.primary, bd: t.primary },
    warning: { bg: t.warning + '18', fg: t.warning, bd: t.warning },
    muted: { bg: t.track, fg: t.subtext, bd: t.border },
  }[tone];
  return (
    <View style={{ backgroundColor: map.bg, borderColor: map.bd, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ color: map.fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function ProgressBar({ pct, t }: { pct: number; t: any }) {
  return (
    <View style={{ height: 6, backgroundColor: t.track, borderRadius: 3, width: '80%', marginTop: 16, overflow: 'hidden' }}>
      <View style={{ height: 6, width: `${Math.max(4, Math.min(100, pct * 100))}%`, backgroundColor: t.primary }} />
    </View>
  );
}

function ModeToggle<T extends string>({
  value,
  onChange,
  options,
  t,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
  t: any;
}) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.track, borderRadius: t.radius, padding: 3 }}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={{
              flex: 1,
              minHeight: 38,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius - 3,
              backgroundColor: active ? t.card : 'transparent',
            }}
          >
            <Text style={{ color: active ? t.text : t.subtext, fontWeight: '700', fontSize: 13 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CandidateRow({
  name,
  from,
  to,
  meta,
  reason,
  selectable,
  checked,
  muted,
  onPress,
  t,
}: {
  name: string;
  from: string;
  to?: string;
  meta?: string;
  reason?: string;
  selectable?: boolean;
  checked?: boolean;
  muted?: boolean;
  onPress?: () => void;
  t: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!selectable}
      style={{
        backgroundColor: t.card,
        borderColor: checked ? t.primary : t.border,
        borderWidth: 1,
        borderRadius: t.radius,
        padding: 12,
        marginBottom: 8,
        flexDirection: 'row',
        gap: 12,
        opacity: muted ? 0.6 : 1,
      }}
    >
      {selectable && (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: checked ? t.primary : t.border,
            backgroundColor: checked ? t.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
          }}
        >
          {checked && <Text style={{ color: t.primaryText, fontWeight: '900', fontSize: 13 }}>✓</Text>}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>
          {name}
        </Text>
        <Text style={{ color: t.subtext, marginTop: 2 }} numberOfLines={1}>
          {from}
          {to ? `  →  ` : ''}
          {to ? <Text style={{ color: t.text, fontWeight: '700' }}>{to}</Text> : null}
        </Text>
        {(meta || reason) && (
          <Text style={{ color: t.subtext, fontSize: 12, marginTop: 3 }} numberOfLines={2}>
            {reason || meta}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function makeStyles(t: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg, paddingTop: TOP_PAD },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
      backgroundColor: t.card,
    },
    headerTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: t.text },
    closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    closeX: { fontSize: 18, color: t.subtext },
    body: { padding: 20, gap: 4 },
    h1: { fontSize: 22, fontWeight: '800', color: t.text, marginBottom: 6 },
    p: { fontSize: 15, color: t.subtext, lineHeight: 22, marginBottom: 6 },
    noteCard: {
      backgroundColor: t.card,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: t.radius,
      padding: 14,
      marginVertical: 12,
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
    centeredText: { color: t.subtext, fontSize: 15, textAlign: 'center' },
    reviewTop: { paddingHorizontal: 16, paddingTop: 12, gap: 12, backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border, paddingBottom: 12 },
    limitedBar: { backgroundColor: t.warning + '1F', paddingHorizontal: 16, paddingVertical: 8 },
    limitedText: { color: t.warning, fontSize: 12, fontWeight: '600', textAlign: 'center' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    modeRow: {},
    selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    selectMeta: { color: t.subtext, fontSize: 13 },
    link: { color: t.primary, fontWeight: '700', fontSize: 13 },
    sectionTitle: { color: t.subtext, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 16, marginBottom: 8 },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: 16,
      backgroundColor: t.card,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    footerNote: { color: t.subtext, fontSize: 12, textAlign: 'center', marginBottom: 6 },
    badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    badgeMark: { color: '#fff', fontSize: 30, fontWeight: '900' },
    failLine: { color: t.subtext, fontSize: 13, marginTop: 6, lineHeight: 19 },
    backupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.card,
      borderColor: t.border,
      borderWidth: 1,
      borderRadius: t.radius,
      padding: 14,
      marginBottom: 8,
    },
    backupTitle: { color: t.text, fontWeight: '700' },
    backupMeta: { color: t.subtext, fontSize: 12, marginTop: 3 },
  });
}

export default GNMScreen;
