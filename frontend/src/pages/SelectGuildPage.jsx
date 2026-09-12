import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/apiClient';

export default function SelectGuildPage({ user, onSessionUser }) {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [onboardable, setOnboardable] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/tenants/mine', { method: 'GET' });
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) {
          if (res.status === 401 || data.error === 'Login required') {
            localStorage.removeItem('guild_raid_session');
            localStorage.removeItem('dynasty_raid_session');
            onSessionUser(null);
            navigate('/landing', { replace: true });
            return;
          }
          setError(data.error || 'Could not load Discord servers');
          return;
        }
        setTenants(data.tenants || []);
        setOnboardable(data.onboardable || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectTenant = async (tenantId) => {
    setError('');
    const res = await apiFetch('/api/tenants/select', {
      method: 'POST',
      body: JSON.stringify({ tenantId }),
    });
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Could not open that guild');
      return;
    }
    onSessionUser(data.user);
    localStorage.setItem('guild_raid_session', JSON.stringify(data.user));
    navigate(data.onboarded ? '/' : '/onboard');
  };

  const startOnboard = (guild) => {
    navigate('/onboard', { state: { guild } });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-white">Choose a Discord server</h1>
        <p className="mt-2 text-sm text-slate-400">
          Signed in as {user?.displayName || user?.username}. Each server has its own private roster and auctions.
        </p>
        {error && <p className="mt-4 text-xs text-rose-300 font-mono">{error}</p>}
        {loading && <p className="mt-6 text-xs uppercase tracking-widest text-slate-500">Loading servers…</p>}

        {!loading && tenants.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Your guilds on this app</div>
            {tenants.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTenant(t.id)}
                className="w-full text-left rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 hover:border-indigo-500/50 transition"
              >
                <div className="font-semibold">{t.displayName || t.id}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">{t.plan} · {t.onboarded ? 'ready' : 'needs setup'}</div>
              </button>
            ))}
          </div>
        )}

        {!loading && onboardable.length > 0 && (
          <div className="mt-8 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Add a new Discord server</div>
            {onboardable.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => startOnboard(g)}
                className="w-full text-left rounded-xl border border-dashed border-slate-700 px-4 py-3 hover:border-indigo-500/50 transition"
              >
                <div className="font-semibold">{g.name}</div>
                <div className="text-[10px] font-mono text-slate-500 mt-1">Invite the bot, then map channels</div>
              </button>
            ))}
          </div>
        )}

        {!loading && tenants.length === 0 && onboardable.length === 0 && (
          <div className="mt-6 text-sm text-slate-400 space-y-3">
            <p>
              We could not list your Discord servers from this login. Log out and sign in with Discord again.
              Do not invite the bot a second time if it is already in your Discord server.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
