import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/apiClient';

const emptyRooms = {
  DISCORD_WARROOM_ID_1: '',
  DISCORD_WARROOM_ID_2: '',
  DISCORD_WARROOM_ID_3: '',
  DISCORD_WARROOM_ID_4: '',
  DISCORD_WARROOM_ID_5: '',
};

export default function OnboardGuildPage({ onSessionUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const guild = location.state?.guild || null;
  const [inviteUrl, setInviteUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    guildName: guild?.name || '',
    timezone: 'Asia/Manila',
    auctionChannelId: '',
    aucreqChannelId: '',
    genroomId: '',
    attendanceId: '',
    warAnnounceChannelId: '',
    warRooms: { ...emptyRooms },
  });

  const guildId = guild?.id;

  useEffect(() => {
    if (!guildId) return undefined;
    apiFetch(`/api/tenants/invite-url?guildId=${encodeURIComponent(guildId)}`, { method: 'GET' })
      .then((r) => r.json())
      .then((data) => { if (data.url) setInviteUrl(data.url); })
      .catch(() => {});
    return undefined;
  }, [guildId]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!guildId) {
      setError('Pick a Discord server from the previous screen.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/tenants/onboard', {
        method: 'POST',
        body: JSON.stringify({
          guildId,
          ...form,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.inviteUrl) setInviteUrl(data.inviteUrl);
        setError(data.error || 'Setup failed');
        return;
      }
      onSessionUser(data.user);
      localStorage.setItem('guild_raid_session', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, placeholder) => (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        value={form[key]}
        onChange={(e) => setField(key, e.target.value.trim())}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
      />
    </label>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl space-y-4">
        <h1 className="text-2xl font-semibold">Set up {guild?.name || 'your Discord server'}</h1>
        <p className="text-sm text-slate-400">
          Invite the bot, then paste channel IDs (Discord Developer Mode → right-click channel → Copy Channel ID).
        </p>
        {inviteUrl && (
          <a href={inviteUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-[#5865F2] px-5 py-2 text-sm font-semibold">
            1. Invite bot to this server
          </a>
        )}
        {error && <p className="text-xs text-rose-300 font-mono">{error}</p>}
        {field('Guild display name', 'guildName', 'ASCENDANTS')}
        {field('Timezone', 'timezone', 'Asia/Manila')}
        {field('Auction announce channel ID', 'auctionChannelId', 'numbers only')}
        {field('Auction request / claim card channel ID', 'aucreqChannelId', '')}
        {field('General / slash-command channel ID', 'genroomId', '')}
        {field('Attendance thread parent channel ID', 'attendanceId', '')}
        {field('War-announce channel ID', 'warAnnounceChannelId', '')}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.keys(emptyRooms).map((key, idx) => (
            <label key={key} className="block text-xs text-slate-400">
              Voice war room {idx + 1}
              <input
                value={form.warRooms[key]}
                onChange={(e) => setForm((prev) => ({
                  ...prev,
                  warRooms: { ...prev.warRooms, [key]: e.target.value.trim() },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : '2. Finish setup'}
        </button>
      </form>
    </div>
  );
}
