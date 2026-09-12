import { query } from './pool.js';
import { getCurrentTenantId, setCachedConfig } from './tenantContext.js';
import { DEFAULT_CONFIGURATION } from '../config/defaultConfiguration.js';

const COLLECTION_MAP = {
  'auction/members': { table: 'members', idCol: 'discord_id' },
  'auction/web_requests': { table: 'auction_requests', idCol: 'id' },
  'auction/past_auctions': { table: 'past_auction_awards', idCol: 'id' },
  'auction/loot_history': { table: 'loot_history', idCol: 'id' },
  'scheduler/instances': { table: 'schedule_instances', idCol: 'id' },
  'scheduler/special_events': { table: 'special_events', idCol: 'id' },
};

function normalizePath(path) {
  if (!path) return '';
  return String(path).replace(/^\/+/, '').replace(/\/+$/, '');
}

function pathParts(path) {
  return normalizePath(path).split('/').filter(Boolean);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function getNested(obj, parts) {
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setNested(target, parts, value) {
  if (parts.length === 0) return value === undefined ? null : value;
  const root = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  if (parts.length === 1) {
    if (value === null || value === undefined) {
      delete root[parts[0]];
    } else {
      root[parts[0]] = value;
    }
    return root;
  }
  root[parts[0]] = setNested(root[parts[0]], parts.slice(1), value);
  return root;
}

function mergeDeep(base, patch) {
  if (patch === null || patch === undefined) return patch;
  if (typeof patch !== 'object' || Array.isArray(patch)) return cloneJson(patch);
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = mergeDeep(out[k], v);
    else out[k] = cloneJson(v);
  }
  return out;
}

function resolveTenantId(tenantId) {
  return tenantId || getCurrentTenantId() || null;
}

function requireTenant(tenantId) {
  const id = resolveTenantId(tenantId);
  if (!id) {
    throw new Error('No tenant in context. Log in and select a Discord server first.');
  }
  return String(id);
}

function isPlatformPath(path) {
  const parts = pathParts(path);
  return parts[0] === 'scheduler' && parts[1] === 'discord_circuit';
}

function encodePushKey() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `-${now}${rand}`;
}

class DataSnapshot {
  constructor(key, value) {
    this.key = key ?? null;
    this._value = value === undefined ? null : value;
  }

  exists() {
    return this._value !== null && this._value !== undefined;
  }

  val() {
    return this._value === undefined ? null : cloneJson(this._value);
  }

  forEach(cb) {
    if (!this._value || typeof this._value !== 'object' || Array.isArray(this._value)) return false;
    for (const [key, child] of Object.entries(this._value)) {
      const stop = cb(new DataSnapshot(key, child));
      if (stop) return true;
    }
    return false;
  }
}

async function loadCollection(tenantId, spec) {
  const { rows } = await query(
    `SELECT ${spec.idCol} AS id, data FROM ${spec.table} WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!rows.length) return null;
  const out = {};
  for (const row of rows) out[row.id] = row.data;
  return out;
}

async function loadCollectionRow(tenantId, spec, id) {
  const { rows } = await query(
    `SELECT data FROM ${spec.table} WHERE tenant_id = $1 AND ${spec.idCol} = $2`,
    [tenantId, id]
  );
  return rows[0]?.data;
}

async function upsertCollectionRow(tenantId, spec, id, data) {
  if (data === null || data === undefined) {
    await query(`DELETE FROM ${spec.table} WHERE tenant_id = $1 AND ${spec.idCol} = $2`, [tenantId, id]);
    return;
  }
  await query(
    `INSERT INTO ${spec.table} (tenant_id, ${spec.idCol}, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, ${spec.idCol}) DO UPDATE SET data = EXCLUDED.data`,
    [tenantId, id, JSON.stringify(data)]
  );
}

async function replaceCollection(tenantId, spec, obj) {
  await query(`DELETE FROM ${spec.table} WHERE tenant_id = $1`, [tenantId]);
  if (!obj || typeof obj !== 'object') return;
  for (const [id, data] of Object.entries(obj)) {
    if (data === null || data === undefined) continue;
    await upsertCollectionRow(tenantId, spec, id, data);
  }
}

async function loadCommitments(tenantId, eventKey, memberId) {
  if (!eventKey) {
    const { rows } = await query(
      'SELECT event_key, member_id, data FROM attendance_commitments WHERE tenant_id = $1',
      [tenantId]
    );
    const tree = {};
    for (const row of rows) {
      if (!tree[row.event_key]) tree[row.event_key] = {};
      tree[row.event_key][row.member_id] = row.data;
    }
    return tree;
  }
  if (!memberId) {
    const { rows } = await query(
      'SELECT member_id, data FROM attendance_commitments WHERE tenant_id = $1 AND event_key = $2',
      [tenantId, eventKey]
    );
    const out = {};
    for (const row of rows) out[row.member_id] = row.data;
    return out;
  }
  const { rows } = await query(
    'SELECT data FROM attendance_commitments WHERE tenant_id = $1 AND event_key = $2 AND member_id = $3',
    [tenantId, eventKey, memberId]
  );
  return rows[0]?.data;
}

async function writeCommitment(tenantId, eventKey, memberId, data) {
  if (!memberId) {
    await query('DELETE FROM attendance_commitments WHERE tenant_id = $1 AND event_key = $2', [tenantId, eventKey]);
    if (data && typeof data === 'object') {
      for (const [uid, row] of Object.entries(data)) {
        if (row == null) continue;
        await query(
          `INSERT INTO attendance_commitments (tenant_id, event_key, member_id, data)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (tenant_id, event_key, member_id) DO UPDATE SET data = EXCLUDED.data`,
          [tenantId, eventKey, uid, JSON.stringify(row)]
        );
      }
    }
    return;
  }
  if (data === null || data === undefined) {
    await query(
      'DELETE FROM attendance_commitments WHERE tenant_id = $1 AND event_key = $2 AND member_id = $3',
      [tenantId, eventKey, memberId]
    );
    return;
  }
  await query(
    `INSERT INTO attendance_commitments (tenant_id, event_key, member_id, data)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant_id, event_key, member_id) DO UPDATE SET data = EXCLUDED.data`,
    [tenantId, eventKey, memberId, JSON.stringify(data)]
  );
}

async function loadConfig(tenantId) {
  const { rows } = await query(
    'SELECT configuration FROM tenant_settings WHERE tenant_id = $1',
    [tenantId]
  );
  if (!rows[0]) return null;
  return rows[0].configuration;
}

async function saveConfig(tenantId, configuration) {
  await query(
    `INSERT INTO tenant_settings (tenant_id, configuration, discord_channels)
     VALUES ($1, $2::jsonb, '{}'::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET configuration = $2::jsonb, updated_at = NOW()`,
    [tenantId, JSON.stringify(configuration || {})]
  );
  setCachedConfig(tenantId, { ...DEFAULT_CONFIGURATION, ...(configuration || {}) });
}

function docRootFor(parts) {
  if (parts.length <= 2) return parts.join('/');
  return `${parts[0]}/${parts[1]}`;
}

async function loadDoc(tenantId, docPath) {
  const { rows } = await query(
    'SELECT data FROM json_docs WHERE tenant_id = $1 AND path = $2',
    [tenantId, docPath]
  );
  if (!rows[0]) return undefined;
  return rows[0].data;
}

async function saveDoc(tenantId, docPath, data) {
  if (data === null || data === undefined || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0 && docPath.includes('/'))) {
    if (data === null || data === undefined) {
      await query('DELETE FROM json_docs WHERE tenant_id = $1 AND path = $2', [tenantId, docPath]);
      return;
    }
  }
  await query(
    `INSERT INTO json_docs (tenant_id, path, data)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, path) DO UPDATE SET data = EXCLUDED.data`,
    [tenantId, docPath, JSON.stringify(data ?? null)]
  );
}

async function readPath(tenantId, path) {
  const parts = pathParts(path);
  if (parts.length === 0) {
    throw new Error('Root read is not supported; read a specific node');
  }

  if (isPlatformPath(path)) {
    const { rows } = await query('SELECT data FROM platform_state WHERE key = $1', ['discord_circuit']);
    const data = rows[0]?.data;
    if (parts.length === 2) return data ?? null;
    return getNested(data, parts.slice(2)) ?? null;
  }

  tenantId = requireTenant(tenantId);

  if (parts[0] === 'settings' && parts[1] === 'configuration') {
    const config = await loadConfig(tenantId);
    if (parts.length === 2) return config ?? null;
    return getNested(config, parts.slice(2)) ?? null;
  }

  if (parts[0] === 'attendance' && parts[1] === 'commitments') {
    const value = await loadCommitments(tenantId, parts[2], parts[3]);
    if (parts.length <= 4) return value ?? null;
    return getNested(value, parts.slice(4)) ?? null;
  }

  const two = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  const spec = COLLECTION_MAP[two];
  if (spec) {
    if (parts.length === 2) return await loadCollection(tenantId, spec);
    const row = await loadCollectionRow(tenantId, spec, parts[2]);
    if (parts.length === 3) return row ?? null;
    return getNested(row, parts.slice(3)) ?? null;
  }

  const docPath = docRootFor(parts);
  const doc = await loadDoc(tenantId, docPath);
  if (doc === undefined) return null;
  const rest = parts.slice(pathParts(docPath).length);
  if (!rest.length) return doc;
  const nested = getNested(doc, rest);
  return nested === undefined ? null : nested;
}

async function writePath(tenantId, path, value) {
  const parts = pathParts(path);
  if (parts.length === 0) {
    throw new Error('Cannot set the database root');
  }

  if (isPlatformPath(path)) {
    if (parts.length === 2) {
      if (value === null) {
        await query('DELETE FROM platform_state WHERE key = $1', ['discord_circuit']);
      } else {
        await query(
          `INSERT INTO platform_state (key, data, updated_at) VALUES ('discord_circuit', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [JSON.stringify(value)]
        );
      }
      return;
    }
    const current = (await readPath(tenantId, 'scheduler/discord_circuit')) || {};
    const next = setNested(current, parts.slice(2), value);
    await writePath(tenantId, 'scheduler/discord_circuit', next);
    return;
  }

  tenantId = requireTenant(tenantId);

  if (parts[0] === 'settings' && parts[1] === 'configuration') {
    if (parts.length === 2) {
      await saveConfig(tenantId, value || {});
      return;
    }
    const current = (await loadConfig(tenantId)) || { ...DEFAULT_CONFIGURATION };
    const next = setNested(current, parts.slice(2), value);
    await saveConfig(tenantId, next);
    return;
  }

  if (parts[0] === 'attendance' && parts[1] === 'commitments') {
    if (parts.length === 2) {
      await query('DELETE FROM attendance_commitments WHERE tenant_id = $1', [tenantId]);
      if (value && typeof value === 'object') {
        for (const [eventKey, members] of Object.entries(value)) {
          await writeCommitment(tenantId, eventKey, null, members);
        }
      }
      return;
    }
    if (parts.length === 3) {
      await writeCommitment(tenantId, parts[2], null, value);
      return;
    }
    if (parts.length === 4) {
      await writeCommitment(tenantId, parts[2], parts[3], value);
      return;
    }
    const current = (await loadCommitments(tenantId, parts[2], parts[3])) || {};
    const next = setNested(current, parts.slice(4), value);
    await writeCommitment(tenantId, parts[2], parts[3], next);
    return;
  }

  const two = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  const spec = COLLECTION_MAP[two];
  if (spec) {
    if (parts.length === 2) {
      await replaceCollection(tenantId, spec, value);
      return;
    }
    if (parts.length === 3) {
      await upsertCollectionRow(tenantId, spec, parts[2], value);
      return;
    }
    const current = (await loadCollectionRow(tenantId, spec, parts[2])) || {};
    const next = setNested(current, parts.slice(3), value);
    await upsertCollectionRow(tenantId, spec, parts[2], next);
    return;
  }

  const docPath = docRootFor(parts);
  const rest = parts.slice(pathParts(docPath).length);
  if (!rest.length) {
    await saveDoc(tenantId, docPath, value);
    return;
  }
  const current = (await loadDoc(tenantId, docPath));
  const base = current === undefined ? {} : current;
  const next = setNested(base, rest, value);
  await saveDoc(tenantId, docPath, next);
}

async function updateAtPath(tenantId, path, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    await writePath(tenantId, path, patch);
    return;
  }
  const current = await readPath(tenantId, path);
  const next = mergeDeep(current && typeof current === 'object' ? current : {}, patch);
  await writePath(tenantId, path, next);
}

class QueryRef {
  constructor(tenantId, path, filters = []) {
    this._tenantId = tenantId;
    this.path = normalizePath(path);
    this._filters = filters;
    this.key = pathParts(this.path).slice(-1)[0] || null;
  }

  child(childPath) {
    const suffix = normalizePath(childPath);
    const next = this.path ? `${this.path}/${suffix}` : suffix;
    return new QueryRef(this._tenantId, next);
  }

  orderByChild(field) {
    return new QueryRef(this._tenantId, this.path, [...this._filters, { type: 'orderByChild', field }]);
  }

  equalTo(value) {
    return new QueryRef(this._tenantId, this.path, [...this._filters, { type: 'equalTo', value }]);
  }

  push() {
    const key = encodePushKey();
    const child = this.child(key);
    child.key = key;
    return child;
  }

  async once() {
    let value = await readPath(this._tenantId, this.path);
    const order = this._filters.find((f) => f.type === 'orderByChild');
    const eq = this._filters.find((f) => f.type === 'equalTo');
    if (order && eq && value && typeof value === 'object' && !Array.isArray(value)) {
      const filtered = {};
      for (const [k, row] of Object.entries(value)) {
        if (row && typeof row === 'object' && row[order.field] === eq.value) filtered[k] = row;
      }
      value = filtered;
    }
    const key = this.key;
    return new DataSnapshot(key, value);
  }

  async set(value) {
    await writePath(this._tenantId, this.path, value);
  }

  async update(patch) {
    if (this.path === '' || this.path === '/') {
      const entries = Object.entries(patch || {});
      for (const [subPath, val] of entries) {
        await writePath(this._tenantId, subPath, val);
      }
      return;
    }
    await updateAtPath(this._tenantId, this.path, patch);
  }

  async remove() {
    await writePath(this._tenantId, this.path, null);
  }

  async transaction(updater) {
    const current = await readPath(this._tenantId, this.path);
    const next = updater(current === null ? null : cloneJson(current));
    if (next === undefined) return { committed: false, snapshot: new DataSnapshot(this.key, current) };
    await writePath(this._tenantId, this.path, next);
    return { committed: true, snapshot: new DataSnapshot(this.key, next) };
  }

  on(event, callback, errorCallback) {
    if (event !== 'value') return () => {};
    const tick = () => {
      this.once('value')
        .then((snap) => callback(snap))
        .catch((err) => {
          if (errorCallback) errorCallback(err);
          else console.error('tenant store listener:', err.message);
        });
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }

  off() {}
}

class DatabaseHandle {
  constructor(tenantId) {
    this._tenantId = tenantId;
  }

  ref(path = '') {
    return new QueryRef(this._tenantId, path);
  }
}

export function getDatabase() {
  return new DatabaseHandle(resolveTenantId(null));
}

export function getDatabaseFor(tenantId) {
  return new DatabaseHandle(resolveTenantId(tenantId));
}

export { QueryRef, DataSnapshot };
