// frontend/src/components/UserPanel.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_TZ } from '../utils/guildTime';
import { apiFetch } from '../services/apiClient';
import DiscordSignInButton from './DiscordSignInButton';

const IconUser = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconShield = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconLogout = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
const IconClock = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;

function tzShortLabel(timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone || DEFAULT_TZ, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? (timezone || DEFAULT_TZ);
  } catch {
    return timezone || DEFAULT_TZ;
  }
}

export default function UserPanel({ user, onLogout, onSessionUser }) {
  const navigate = useNavigate();
  const [clockDisplay, setClockDisplay] = useState('');
  const [tenants, setTenants] = useState([]);
  const [onboardable, setOnboardable] = useState([]);
  const [guildTz, setGuildTz] = useState(DEFAULT_TZ);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockDisplay(
        now.toLocaleTimeString('en-US', {
          timeZone: guildTz || DEFAULT_TZ,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [guildTz]);

  useEffect(() => {
    if (!user) return undefined;
    apiFetch('/api/tenants/mine', { method: 'GET' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setTenants(data.tenants || []);
          setOnboardable(data.onboardable || []);
        }
      })
      .catch(() => {});
    apiFetch('/api/requests/settings/help', { method: 'GET' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.timezone) setGuildTz(data.timezone);
      })
      .catch(() => {});
    return undefined;
  }, [user]);

  const switchTenant = async (tenantId) => {
    if (!tenantId || tenantId === user?.currentTenantId) return;
    const res = await apiFetch('/api/tenants/select', {
      method: 'POST',
      body: JSON.stringify({ tenantId }),
    });
    const data = await res.json();
    if (data.success && data.user) {
      onSessionUser?.(data.user);
      localStorage.setItem('guild_raid_session', JSON.stringify(data.user));
      window.location.assign('/');
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-slate-100 shadow-md">
      {user ? (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Signed in as</div>
            <div className="text-sm font-semibold text-slate-200 truncate mt-1 flex items-center gap-1.5">
              <span className="text-indigo-400"><IconUser /></span> {user.displayName || user.username}
            </div>
            {user.tenantName && (
              <div className="text-[10px] font-mono text-slate-500 mt-1">{user.tenantName}</div>
            )}
            {tenants.length > 1 && (
              <select
                className="mt-2 max-w-full rounded-md border border-slate-800 bg-slate-950 text-[11px] text-slate-200 px-2 py-1"
                value={user.currentTenantId || ''}
                onChange={(e) => switchTenant(e.target.value)}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.displayName || t.id}</option>
                ))}
              </select>
            )}
            {onboardable.length > 0 && (
              <button
                type="button"
                onClick={() => navigate('/select-guild')}
                className="mt-2 text-[10px] font-mono uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
              >
                Add Discord server
              </button>
            )}
            
            {user.roles && user.roles.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 select-none">
                {user.roles.map((role, idx) => (
                  <span 
                    key={idx} 
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-sm"
                  >
                    <IconShield /> {role}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-0.5 px-4 border-x border-slate-800 select-none" title={`Guild time · ${guildTz}`}>
            <div className="flex items-center gap-1.5 text-slate-400">
              <IconClock />
              <span className="text-[9px] font-mono font-bold uppercase tracking-widest">Server Time</span>
            </div>
            <span className="text-base font-mono font-bold text-slate-200 tabular-nums leading-tight">
              {clockDisplay || '--:--:--'}
            </span>
            <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{tzShortLabel(guildTz)}</span>
          </div>
          
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-[10px] uppercase font-bold tracking-wider rounded-xl text-slate-400 hover:text-white transition cursor-pointer shadow-sm shrink-0"
          >
            Logout <IconLogout />
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-3 w-full">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Authentication Required</div>
          <DiscordSignInButton
            compact
            className="flex items-center justify-center gap-2 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold uppercase tracking-wider rounded-xl transition shadow-lg"
          />
        </div>
      )}
    </div>
  );
}
