import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/apiClient';
import { guildMarkSrc, onGuildMarkError } from '../utils/guildLogo';

function readAuthIntent() {
  const fromQuery = new URLSearchParams(window.location.search).get('intent');
  if (fromQuery === 'signup' || fromQuery === 'signin') return fromQuery;
  try {
    const stored = sessionStorage.getItem('ro_guild_intent');
    if (stored === 'signup' || stored === 'signin') return stored;
  } catch {
    /* ignore */
  }
  return 'signin';
}

export default function SelectGuildPage({ user, onSessionUser }) {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [onboardable, setOnboardable] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState(readAuthIntent);

  useEffect(() => {
    setIntent(readAuthIntent());
  }, []);

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

  const highlightSignup = intent === 'signup';
  const noServers = !loading && tenants.length === 0 && onboardable.length === 0;
  const signInEmpty = !loading && tenants.length === 0 && onboardable.length > 0 && !highlightSignup;
  const signupEmpty = !loading && onboardable.length === 0 && tenants.length > 0 && highlightSignup;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
        <img src="/assets/brand/ro-guild-mark.png" alt="" className="h-10 w-10 mb-4" />
        <h1 className="text-2xl font-semibold text-white">
          {highlightSignup ? 'Create a workspace' : 'Open a guild'}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Signed in as {user?.displayName || user?.username}. Each Discord server is its own private workspace.
        </p>
        {error && <p className="mt-4 text-xs text-rose-300 font-mono">{error}</p>}
        {loading && <p className="mt-6 text-xs uppercase tracking-widest text-slate-500">Loading servers…</p>}

        {signInEmpty && (
          <p className="mt-4 text-sm text-slate-400">
            None of your Discord servers are on RO Guild App yet. Create a workspace below if you have Manage Server, or ask an officer of your guild to Get started.
          </p>
        )}
        {signupEmpty && (
          <p className="mt-4 text-sm text-slate-400">
            You can still open a guild you already belong to. To create a new workspace you need Manage Server on a Discord server that is not set up yet.
          </p>
        )}

        {!loading && tenants.length > 0 && (
          <div className={`mt-6 space-y-2 ${highlightSignup ? 'opacity-80' : ''}`}>
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Your guilds</div>
            {tenants.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTenant(t.id)}
                className="w-full text-left rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 hover:border-indigo-500/50 transition flex items-center gap-3"
              >
                <img
                  src={guildMarkSrc({ logoUrl: t.logoUrl, guildId: t.id, icon: t.icon })}
                  alt=""
                  onError={onGuildMarkError}
                  className="h-12 w-12 rounded-lg object-cover bg-slate-900 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{t.displayName || t.id}</div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1">{t.plan || 'free'} · {t.onboarded ? 'ready' : 'needs setup'}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && onboardable.length > 0 && (
          <div className={`mt-8 space-y-2 ${highlightSignup ? '' : 'opacity-90'}`}>
            <div className={`text-[10px] font-mono uppercase tracking-widest ${highlightSignup ? 'text-indigo-400' : 'text-slate-500'}`}>
              Create a workspace
            </div>
            <p className="text-[11px] text-slate-500">
              Set up this Discord server as an RO Guild App workspace. Payments will attach here later.
            </p>
            {onboardable.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => startOnboard(g)}
                className={`w-full text-left rounded-xl border border-dashed px-4 py-3 hover:border-indigo-500/50 transition flex items-center gap-3 ${
                  highlightSignup ? 'border-indigo-500/40 bg-indigo-950/20' : 'border-slate-700'
                }`}
              >
                <img
                  src={guildMarkSrc({ guildId: g.id, icon: g.icon })}
                  alt=""
                  onError={onGuildMarkError}
                  className="h-12 w-12 rounded-lg object-cover bg-slate-900 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{g.name}</div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1">Invite the bot, then map channels</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {noServers && (
          <div className="mt-6 text-sm text-slate-400 space-y-3">
            <p>
              Discord did not return any servers for this account. Create or join a Discord server, then try again.
            </p>
            <p>
              Ask an officer of your guild to Get started, or Sign in after you join a server that already uses RO Guild App.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
