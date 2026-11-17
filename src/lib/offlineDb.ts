import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {DailyReportRecord} from '../types/opcms';

export type OfflineSyncState =
  | 'saved_locally'
  | 'waiting_sync'
  | 'synchronizing'
  | 'conflict'
  | 'sync_error';

export interface OfflineReportQueueItem {
  localKey: string;
  user_id: string;
  client_report_id: string;
  campaign_day_id: string;
  day_label: string;
  woreda_id: string;
  woreda_name: string;
  zone_name: string;
  payload: Partial<DailyReportRecord> & {
    client_report_id?: string;
    base_version?: number | null;
    base_updated_at?: string | null;
    auto_submit?: boolean;
  };
  intendedAction: 'draft' | 'submit';
  syncState: OfflineSyncState;
  baseVersion: number | null;
  baseUpdatedAt: string | null;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  savedAt: string;
}

interface OpcmsOfflineDB extends DBSchema {
  cachedDatasets: {
    key: string;
    value: {
      key: string;
      user_id: string;
      data: unknown;
      updatedAt: string;
    };
  };
  offlineDrafts: {
    key: string;
    value: OfflineReportQueueItem;
  };
}

let dbPromise: Promise<IDBPDatabase<OpcmsOfflineDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<OpcmsOfflineDB>('opcms-offline-store', 2, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('cachedDatasets')) {
          db.createObjectStore('cachedDatasets', {keyPath: 'key'});
        }
        if (!db.objectStoreNames.contains('offlineDrafts')) {
          db.createObjectStore('offlineDrafts', {keyPath: 'localKey'});
        } else if (oldVersion < 2) {
          db.deleteObjectStore('offlineDrafts');
          db.createObjectStore('offlineDrafts', {keyPath: 'localKey'});
        }
      },
    });
  }
  return dbPromise;
}

function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function cacheScopedDataset(
  userId: string,
  datasetName: string,
  data: unknown,
): Promise<void> {
  try {
    const db = await getDb();
    await db.put('cachedDatasets', {
      key: `${userId}::${datasetName}`,
      user_id: userId,
      data,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // IndexedDB unavailable in restricted mode
  }
}

export async function getCachedScopedDataset<T>(
  userId: string,
  datasetName: string,
): Promise<{data: T; updatedAt: string} | null> {
  try {
    const db = await getDb();
    const record = await db.get('cachedDatasets', `${userId}::${datasetName}`);
    if (!record) return null;
    return {data: record.data as T, updatedAt: record.updatedAt};
  } catch {
    return null;
  }
}

export async function purgeUnassignedUserCaches(activeUserId: string): Promise<void> {
  try {
    const db = await getDb();
    const all = await db.getAll('cachedDatasets');
    for (const entry of all) {
      if (entry.user_id !== activeUserId) {
        await db.delete('cachedDatasets', entry.key);
      }
    }
  } catch {
    // ignore
  }
}

export async function saveOfflineReportItem(params: {
  userId: string;
  campaign_day_id: string;
  day_label: string;
  woreda_id: string;
  woreda_name: string;
  zone_name: string;
  payload: Partial<DailyReportRecord>;
  intendedAction: 'draft' | 'submit';
  syncState: OfflineSyncState;
  baseVersion?: number | null;
  baseUpdatedAt?: string | null;
}): Promise<OfflineReportQueueItem> {
  const db = await getDb();
  const localKey = `${params.userId}::${params.campaign_day_id}::${params.woreda_id}`;
  const existing = await db.get('offlineDrafts', localKey);
  const client_report_id = existing?.client_report_id || generateClientUuid();

  const item: OfflineReportQueueItem = {
    localKey,
    user_id: params.userId,
    client_report_id,
    campaign_day_id: params.campaign_day_id,
    day_label: params.day_label,
    woreda_id: params.woreda_id,
    woreda_name: params.woreda_name,
    zone_name: params.zone_name,
    payload: {
      ...params.payload,
      client_report_id,
      base_version: params.baseVersion ?? existing?.baseVersion ?? null,
      base_updated_at: params.baseUpdatedAt ?? existing?.baseUpdatedAt ?? null,
      auto_submit: params.intendedAction === 'submit',
    },
    intendedAction: params.intendedAction,
    syncState: params.syncState,
    baseVersion: params.baseVersion ?? existing?.baseVersion ?? null,
    baseUpdatedAt: params.baseUpdatedAt ?? existing?.baseUpdatedAt ?? null,
    retryCount: existing?.syncState === 'conflict' ? 0 : existing?.retryCount || 0,
    lastError: null,
    nextRetryAt: null,
    savedAt: new Date().toISOString(),
  };

  await db.put('offlineDrafts', item);
  return item;
}

export async function updateOfflineQueueItem(
  localKey: string,
  patch: Partial<OfflineReportQueueItem>,
): Promise<void> {
  try {
    const db = await getDb();
    const existing = await db.get('offlineDrafts', localKey);
    if (!existing) return;
    await db.put('offlineDrafts', {...existing, ...patch});
  } catch {
    // ignore
  }
}

export async function listOfflineDrafts(userId?: string): Promise<OfflineReportQueueItem[]> {
  try {
    const db = await getDb();
    const all = await db.getAll('offlineDrafts');
    const filtered = userId ? all.filter((i) => i.user_id === userId) : all;
    return filtered.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export async function removeOfflineDraft(localKey: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('offlineDrafts', localKey);
  } catch {
    // ignore
  }
}
