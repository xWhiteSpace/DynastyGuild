import { createClient } from '@supabase/supabase-js';

export const LOGO_BUCKET = 'guild-assets';
export const LOGO_MAX_BYTES = 512 * 1024;

let cachedClient = null;

export function getSupabaseAdmin() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function detectLogoType(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  return null;
}

export function discordGuildIconUrl(guildId, iconHash) {
  if (!guildId || !iconHash) return '';
  const hash = String(iconHash);
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${hash}.${ext}?size=128`;
}

export function resolveGuildLogoUrl({ logoUrl, guildId, iconHash } = {}) {
  const imported = String(logoUrl || '').trim();
  if (imported) return imported;
  return discordGuildIconUrl(guildId, iconHash);
}

function objectPaths(tenantId) {
  const id = String(tenantId);
  return [`${id}/logo.png`, `${id}/logo.jpg`];
}

export async function uploadGuildLogo(tenantId, buffer) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, status: 503, error: 'Guild logo storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' };
  }
  if (!buffer || buffer.length > LOGO_MAX_BYTES) {
    return { ok: false, status: 400, error: 'Logo must be a png or jpg of 512 KB or smaller.' };
  }
  const kind = detectLogoType(buffer);
  if (!kind) {
    return { ok: false, status: 400, error: 'Logo must be a png or jpg file.' };
  }

  const paths = objectPaths(tenantId);
  await supabase.storage.from(LOGO_BUCKET).remove(paths);
  const objectPath = `${tenantId}/logo.${kind.ext}`;
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(objectPath, buffer, {
    contentType: kind.mime,
    upsert: true,
  });
  if (error) {
    return { ok: false, status: 502, error: error.message || 'Could not store the logo.' };
  }
  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(objectPath);
  const publicUrl = String(data?.publicUrl || '').trim();
  if (!publicUrl) {
    return { ok: false, status: 502, error: 'Could not read the stored logo URL.' };
  }
  return { ok: true, url: `${publicUrl}?v=${Date.now()}` };
}

export async function deleteGuildLogo(tenantId) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, status: 503, error: 'Guild logo storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' };
  }
  const { error } = await supabase.storage.from(LOGO_BUCKET).remove(objectPaths(tenantId));
  if (error) {
    return { ok: false, status: 502, error: error.message || 'Could not remove the logo.' };
  }
  return { ok: true };
}
