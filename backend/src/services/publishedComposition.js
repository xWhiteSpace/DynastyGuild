/**
 * Published (sent) Raid Compose snapshots + Set Active anchor.
 * Party / Attendance Discord cards read the anchor; Live Raid starts from a snapshot.
 */
import { getDatabase } from '../db/database.js';
import { buildLiveGridsFromComposition } from '@guildname/shared/compositionTabs';

export const PUBLISHED_PATH = 'attendance/published';
export const ANCHOR_PATH = 'attendance/published_anchor';

export function publishedIdFromSession(session, sessionId) {
  if (sessionId) return String(sessionId);
  if (session?.eventDate && session?.eventKey) {
    return `${session.eventDate}_${session.eventKey}`;
  }
  return null;
}

function snapshotGrids(grids) {
  try {
    return JSON.parse(JSON.stringify(grids || {}));
  } catch {
    return grids || {};
  }
}

export async function resolveAnchoredComposition(dbArg) {
  const db = dbArg || getDatabase();
  const anchorSnap = await db.ref(ANCHOR_PATH).once('value');
  const id = anchorSnap.exists() ? anchorSnap.val() : null;
  if (!id) return null;
  const snap = await db.ref(`${PUBLISHED_PATH}/${id}`).once('value');
  if (!snap.exists()) return null;
  return { id, ...snap.val() };
}

export async function listPublished(dbArg) {
  const db = dbArg || getDatabase();
  const [listSnap, anchorSnap] = await Promise.all([
    db.ref(PUBLISHED_PATH).once('value'),
    db.ref(ANCHOR_PATH).once('value'),
  ]);
  return {
    published: listSnap.exists() ? listSnap.val() : {},
    anchor: anchorSnap.exists() ? anchorSnap.val() : null,
  };
}

/**
 * Persist a compose-session snapshot. First publish auto-anchors if none is set.
 * Re-send of the same id keeps existing grids unless the caller sends a non-empty grid map.
 */
export async function writePublishedSnapshot({ db, session, sessionId, sentBy }) {
  const database = db || getDatabase();
  const id = publishedIdFromSession(session, sessionId);
  if (!id || !session) {
    return { ok: false, error: 'No compose session to publish.' };
  }

  const existingSnap = await database.ref(`${PUBLISHED_PATH}/${id}`).once('value');
  const existing = existingSnap.exists() ? existingSnap.val() : null;
  const incomingGrids = snapshotGrids(session.grids);
  const hasIncomingGrids = Object.keys(incomingGrids || {}).length > 0;
  const grids = hasIncomingGrids ? incomingGrids : snapshotGrids(existing?.grids);
  const selectedGridIds = Array.isArray(session.selectedGridIds) && session.selectedGridIds.length > 0
    ? session.selectedGridIds
    : (existing?.selectedGridIds || Object.keys(grids));

  const payload = {
    eventKey: session.eventKey || existing?.eventKey || '',
    eventDate: session.eventDate || existing?.eventDate || '',
    eventTitle: session.eventTitle || session.eventKey || existing?.eventTitle || 'Raid',
    timeStart: session.timeStart || existing?.timeStart || '',
    configId: session.configId || existing?.configId || '',
    configTitle: session.configTitle || session.configId || existing?.configTitle || '',
    grids,
    selectedGridIds,
    sentAt: Date.now(),
    sentBy: sentBy || 'Officer',
    sourceComposeId: id,
    lastUpdated: Date.now(),
  };
  await database.ref(`${PUBLISHED_PATH}/${id}`).set(payload);

  const anchorSnap = await database.ref(ANCHOR_PATH).once('value');
  const currentAnchor = anchorSnap.exists() ? anchorSnap.val() : null;
  let autoAnchored = false;
  if (!currentAnchor) {
    await database.ref(ANCHOR_PATH).set(id);
    autoAnchored = true;
  }
  return { ok: true, id, autoAnchored, payload };
}

export async function addConfigToPublished({ db, id, configId, composition }) {
  const database = db || getDatabase();
  const key = String(id || '');
  if (!key) return { ok: false, error: 'Composition id is required.' };
  if (!configId || !composition) {
    return { ok: false, error: 'Raid config is required.' };
  }

  const snap = await database.ref(`${PUBLISHED_PATH}/${key}`).once('value');
  if (!snap.exists()) {
    return { ok: false, error: 'Published composition not found.' };
  }

  const current = snap.val() || {};
  const { grids: builtGrids, selectedGridIds: builtIds } = buildLiveGridsFromComposition(composition, configId);
  const grids = { ...(current.grids || {}) };
  const selectedGridIds = Array.isArray(current.selectedGridIds)
    ? [...current.selectedGridIds]
    : Object.keys(grids);

  let added = 0;
  (builtIds || []).forEach((tabId) => {
    const gridKey = `${configId}__${tabId}`;
    if (grids[gridKey] || !builtGrids[tabId]) return;
    grids[gridKey] = { ...builtGrids[tabId], id: gridKey };
    selectedGridIds.push(gridKey);
    added += 1;
  });

  if (added === 0) {
    return { ok: false, error: 'That raid config is already on this composition.' };
  }

  const patch = {
    configId,
    configTitle: composition.title || configId,
    grids,
    selectedGridIds,
    lastUpdated: Date.now(),
  };
  await database.ref(`${PUBLISHED_PATH}/${key}`).update(patch);
  return { ok: true, id: key, payload: { id: key, ...current, ...patch } };
}

export function configIdFromGridKey(gridKey) {
  const key = String(gridKey || '');
  const idx = key.indexOf('__');
  return idx > 0 ? key.slice(0, idx) : null;
}

function configIdForGrid(gridKey, grid, fallbackConfigId) {
  return configIdFromGridKey(gridKey) || grid?.parentConfigId || fallbackConfigId || '';
}

function titleForConfigId(configId, grids, fallbackTitle) {
  if (!configId) return '';
  const match = Object.entries(grids).find(([gridKey, grid]) => (
    configIdForGrid(gridKey, grid, '') === configId
  ));
  return match?.[1]?.parentConfigTitle || fallbackTitle || configId;
}

export async function removeConfigFromPublished({ db, id, configId }) {
  const database = db || getDatabase();
  const key = String(id || '');
  const targetConfigId = String(configId || '').trim();
  if (!key) return { ok: false, error: 'Composition id is required.' };
  if (!targetConfigId) return { ok: false, error: 'configId is required.' };

  const snap = await database.ref(`${PUBLISHED_PATH}/${key}`).once('value');
  if (!snap.exists()) {
    return { ok: false, error: 'Published composition not found.' };
  }

  const current = snap.val() || {};
  const grids = { ...(current.grids || {}) };
  const selectedGridIds = Array.isArray(current.selectedGridIds)
    ? [...current.selectedGridIds]
    : Object.keys(grids);

  const belongsToTarget = (gridKey, grid) => (
    configIdForGrid(gridKey, grid, current.configId) === targetConfigId
  );

  let removed = 0;
  Object.entries(grids).forEach(([gridKey, grid]) => {
    if (!belongsToTarget(gridKey, grid)) return;
    delete grids[gridKey];
    removed += 1;
  });

  if (removed === 0 && current.configId !== targetConfigId) {
    return { ok: false, error: 'That raid config is not on this composition.' };
  }

  const nextIds = selectedGridIds.filter((gridKey) => grids[gridKey]);
  const remainingConfigIds = [...new Set(
    Object.entries(grids)
      .map(([gridKey, grid]) => configIdForGrid(gridKey, grid, ''))
      .filter(Boolean)
  )];
  const nextConfigId = remainingConfigIds.includes(current.configId)
    ? current.configId
    : (remainingConfigIds[0] || '');
  const nextTitle = nextConfigId === current.configId
    ? (current.configTitle || titleForConfigId(nextConfigId, grids, ''))
    : titleForConfigId(nextConfigId, grids, '');

  const patch = {
    configId: nextConfigId,
    configTitle: nextTitle,
    lastUpdated: Date.now(),
  };
  await database.ref(`${PUBLISHED_PATH}/${key}`).update(patch);
  await database.ref(`${PUBLISHED_PATH}/${key}/grids`).set(Object.keys(grids).length ? grids : null);
  await database.ref(`${PUBLISHED_PATH}/${key}/selectedGridIds`).set(nextIds.length ? nextIds : null);

  return {
    ok: true,
    id: key,
    payload: {
      id: key,
      ...current,
      ...patch,
      grids,
      selectedGridIds: nextIds,
    },
  };
}

export async function savePublishedGrids({ db, id, grids }) {
  const database = db || getDatabase();
  const key = String(id || '');
  if (!key) return { ok: false, error: 'Composition id is required.' };
  if (!grids || typeof grids !== 'object') {
    return { ok: false, error: 'grids are required.' };
  }

  const snap = await database.ref(`${PUBLISHED_PATH}/${key}`).once('value');
  if (!snap.exists()) {
    return { ok: false, error: 'Published composition not found.' };
  }

  const nextGrids = snapshotGrids(grids);
  const patch = {
    grids: nextGrids,
    selectedGridIds: Object.keys(nextGrids),
    lastUpdated: Date.now(),
  };
  await database.ref(`${PUBLISHED_PATH}/${key}`).update(patch);
  return { ok: true, id: key, payload: { id: key, ...snap.val(), ...patch } };
}

export async function setPublishedAnchor({ db, id, active }) {
  const database = db || getDatabase();
  const key = String(id || '');
  if (!key) return { ok: false, error: 'Composition id is required.' };

  if (active) {
    const snap = await database.ref(`${PUBLISHED_PATH}/${key}`).once('value');
    if (!snap.exists()) {
      return { ok: false, error: 'Published composition not found.' };
    }
    await database.ref(ANCHOR_PATH).set(key);
    return { ok: true, id: key };
  }

  const current = (await database.ref(ANCHOR_PATH).once('value')).val();
  if (current === key) {
    await database.ref(ANCHOR_PATH).remove();
  }
  return { ok: true, id: null };
}

export async function deletePublished({ db, id }) {
  const database = db || getDatabase();
  const key = String(id || '');
  if (!key) return { ok: false, error: 'Composition id is required.' };
  await database.ref(`${PUBLISHED_PATH}/${key}`).remove();
  const current = (await database.ref(ANCHOR_PATH).once('value')).val();
  if (current === key) {
    await database.ref(ANCHOR_PATH).remove();
  }
  return { ok: true };
}
