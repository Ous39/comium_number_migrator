/**
 * MigrationRules — fetch the numbering rules, cache them, fall back offline.
 *
 * Resolution order: network (configured URL) -> last cached copy -> the
 * bundled snapshot below. The bundled copy is PURA Phase 1 (published
 * 2026-08-16, effective 4 September 2026) so the module is usable on first
 * run with no connection.
 */

import { getConfig } from './config';
import { storage } from './safeStorage';
import type { RulesPayload } from './types';

const CACHE_KEY = 'gnm.rules.cache.v1';

export const BUNDLED_RULES: RulesPayload = {
  versionNumber: 1,
  publishedAt: '2026-08-16T01:28:00.893Z',
  operators: [
    { id: '7fd079fd-ed92-40d3-8d77-f5822b0d5da5', name: 'Africell', code: 'AFRICELL', newPrefix: '87', color: '#49225B', status: 'active', notes: 'PURA Ref P/TR/NP/VOL.XV/(457), 9 July 2026; Phase 1 effective 4 September 2026.' },
    { id: 'c78dd296-86b6-4e54-ba4c-679cc3efb8f5', name: 'Comium', code: 'COMIUM', newPrefix: '86', color: '#A56ABD', status: 'active', notes: 'PURA Ref P/TR/NP/VOL.XV/(457), 9 July 2026; Phase 1 effective 4 September 2026.' },
    { id: '889f64f4-9a8f-4551-a529-2caa25f13fee', name: 'QCell', code: 'QCELL', newPrefix: '83', color: '#6E3482', status: 'active', notes: 'PURA Ref P/TR/NP/VOL.XV/(457), 9 July 2026; Phase 1 effective 4 September 2026.' },
  ],
  rules: [
    { id: '348abf3d-77e9-45d8-8de0-24de8b165377', operatorId: '889f64f4-9a8f-4551-a529-2caa25f13fee', operatorName: 'QCell', operatorCode: 'QCELL', ruleName: 'QCell 5XXXXXX', ruleType: 'prefix', prefixValue: '5', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '83', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: 'd6f9d779-1973-47ba-b6ea-5052f7a14fa2', operatorId: '889f64f4-9a8f-4551-a529-2caa25f13fee', operatorName: 'QCell', operatorCode: 'QCELL', ruleName: 'QCell 3XXXXXX', ruleType: 'prefix', prefixValue: '3', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '83', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '1d5dab0a-98d9-4b7d-864e-a4c18f8df423', operatorId: 'c78dd296-86b6-4e54-ba4c-679cc3efb8f5', operatorName: 'Comium', operatorCode: 'COMIUM', ruleName: 'Comium 87XXXXX', ruleType: 'prefix', prefixValue: '87', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '86', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: 'e1097507-8367-4e1e-9164-72f8d0c8f291', operatorId: 'c78dd296-86b6-4e54-ba4c-679cc3efb8f5', operatorName: 'Comium', operatorCode: 'COMIUM', ruleName: 'Comium 86XXXXX', ruleType: 'prefix', prefixValue: '86', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '86', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '1d6ddac9-a02e-46ff-bbe8-2f60347c2655', operatorId: 'c78dd296-86b6-4e54-ba4c-679cc3efb8f5', operatorName: 'Comium', operatorCode: 'COMIUM', ruleName: 'Comium 85XXXXX', ruleType: 'prefix', prefixValue: '85', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '86', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '9ad5b90d-56bb-455b-b9e9-29f947604a65', operatorId: 'c78dd296-86b6-4e54-ba4c-679cc3efb8f5', operatorName: 'Comium', operatorCode: 'COMIUM', ruleName: 'Comium 84XXXXX', ruleType: 'prefix', prefixValue: '84', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '86', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '7f449da7-bbc1-4bce-9c3b-4cc1010f94e9', operatorId: 'c78dd296-86b6-4e54-ba4c-679cc3efb8f5', operatorName: 'Comium', operatorCode: 'COMIUM', ruleName: 'Comium 6XXXXXX', ruleType: 'prefix', prefixValue: '6', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '86', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '91d1e603-28ea-460c-b3d3-4611fa23df56', operatorId: '7fd079fd-ed92-40d3-8d77-f5822b0d5da5', operatorName: 'Africell', operatorCode: 'AFRICELL', ruleName: 'Africell 45XXXXX', ruleType: 'prefix', prefixValue: '45', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '87', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '7fece7b8-eb6b-4598-babc-87de12fd4287', operatorId: '7fd079fd-ed92-40d3-8d77-f5822b0d5da5', operatorName: 'Africell', operatorCode: 'AFRICELL', ruleName: 'Africell 41XXXXX', ruleType: 'prefix', prefixValue: '41', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '87', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '689ae5de-8fa6-49f4-808c-436ff32ef820', operatorId: '7fd079fd-ed92-40d3-8d77-f5822b0d5da5', operatorName: 'Africell', operatorCode: 'AFRICELL', ruleName: 'Africell 40XXXXX', ruleType: 'prefix', prefixValue: '40', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '87', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: 'f9dbc56c-cba8-43e8-9816-1018165d2593', operatorId: '7fd079fd-ed92-40d3-8d77-f5822b0d5da5', operatorName: 'Africell', operatorCode: 'AFRICELL', ruleName: 'Africell 2XXXXXX', ruleType: 'prefix', prefixValue: '2', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '87', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
    { id: '9b58c379-d314-43c4-b856-1186685c3fb6', operatorId: '7fd079fd-ed92-40d3-8d77-f5822b0d5da5', operatorName: 'Africell', operatorCode: 'AFRICELL', ruleName: 'Africell 7XXXXXX', ruleType: 'prefix', prefixValue: '7', rangeFrom: null, rangeTo: null, exactNumber: null, newPrefix: '87', priority: 200, status: 'active', notes: 'PURA official Phase 1 allocation; parallel running ends 30 November 2026.' },
  ],
};

export type RulesSource = 'network' | 'cache' | 'bundled';

function coerce(json: any): RulesPayload | null {
  const d = json && typeof json === 'object' && 'data' in json ? json.data : json;
  if (!d || !Array.isArray(d.rules) || !Array.isArray(d.operators)) return null;
  return {
    versionNumber: Number(d.versionNumber) || 0,
    publishedAt: String(d.publishedAt || ''),
    operators: d.operators,
    rules: d.rules,
  };
}

function hasActiveRules(p: RulesPayload | null): p is RulesPayload {
  return !!p && p.rules.some((r) => r.status === 'active');
}

/**
 * Returns the best available ruleset and where it came from. Never throws.
 * Pass { preferCache: true } for an instant start when you'll refresh later.
 */
export async function loadRules(opts?: { preferCache?: boolean }): Promise<{ rules: RulesPayload; source: RulesSource }> {
  const { rulesUrl, requestTimeoutMs } = getConfig();

  const readCache = async (): Promise<RulesPayload | null> => {
    try {
      const raw = await storage.getItem(CACHE_KEY);
      return raw ? coerce(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  if (opts?.preferCache) {
    const cached = await readCache();
    if (hasActiveRules(cached)) return { rules: cached, source: 'cache' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const res = await fetch(rulesUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (res.ok) {
      const payload = coerce(await res.json());
      if (hasActiveRules(payload)) {
        await storage.setItem(CACHE_KEY, JSON.stringify(payload)).catch(() => undefined);
        return { rules: payload, source: 'network' };
      }
    }
  } catch {
    // fall through to cache/bundled
  }

  const cached = await readCache();
  if (hasActiveRules(cached)) return { rules: cached, source: 'cache' };

  return { rules: BUNDLED_RULES, source: 'bundled' };
}

/** Force a network refresh; returns false if it could not be updated. */
export async function refreshRules(): Promise<boolean> {
  const before = getConfig();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), before.requestTimeoutMs);
    const res = await fetch(before.rulesUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return false;
    const payload = coerce(await res.json());
    if (!hasActiveRules(payload)) return false;
    await storage.setItem(CACHE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
