// frontend/src/pages/Profile.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Minus, Plus, User } from 'lucide-react';
import { apiFetch } from '../services/apiClient';
import MemberTrendSparkline, { buildMemberTrendTimeline } from '../components/MemberTrendSparkline';

const EMPTY_AUCTION_STATS = { recordedBattles: 0, totalItemsAcquired: 0, items: [] };

const ITEM_THEME_MAP = {
  purple: 'text-violet-400 border-violet-500/30 bg-violet-950/20',
  yellow: 'text-yellow-400 border-yellow-500/30 bg-yellow-950/10',
  slate: 'text-slate-100 border-slate-700 bg-slate-900/40',
  red: 'text-red-500 border-red-950 bg-black/60',
};

function itemTileTheme(colorTheme) {
  if (typeof colorTheme === 'string' && colorTheme.startsWith('#')) {
    return {
      className: 'border',
      style: {
        color: colorTheme,
        borderColor: `${colorTheme}40`,
        backgroundColor: `${colorTheme}15`,
        boxShadow: `0 0 15px ${colorTheme}20`,
      },
    };
  }
  const preset = ITEM_THEME_MAP[colorTheme] || 'text-slate-300 border-slate-800 bg-slate-950/40';
  return { className: `border ${preset}`, style: {} };
}

export default function Profile({ user }) {
  const { uid: routeUid } = useParams();
  const navigate = useNavigate();
  const isOfficer = user?.isOfficer === true;
  const targetUid = routeUid || user?.id;

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState(null);
  const [jobsCatalog, setJobsCatalog] = useState({});
  const [rolesCatalog, setRolesCatalog] = useState({});
  const [sessions, setSessions] = useState({});
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [auctionStats, setAuctionStats] = useState(EMPTY_AUCTION_STATS);

  const canView = !!targetUid && (String(targetUid) === String(user?.id) || isOfficer);

  const loadProfile = async () => {
    if (!targetUid || !canView) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      setAuctionStats(EMPTY_AUCTION_STATS);
      const isSelf = !routeUid || String(routeUid) === String(user?.id);
      const profilePath = isSelf
        ? '/api/attendance/profile'
        : `/api/attendance/profile?uid=${encodeURIComponent(String(targetUid))}`;
      const res = await apiFetch(profilePath);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to load profile.');
        setMember(null);
        return;
      }
      setMember(data.member);
      setJobsCatalog(data.config?.jobs || {});
      setRolesCatalog(data.config?.roles || {});

      try {
        const [histRes, statsRes] = await Promise.all([
          apiFetch('/api/live-raid/history/all', { method: 'GET' }),
          apiFetch(`/api/requests/member-auction-stats?uid=${encodeURIComponent(String(targetUid))}`),
        ]);
        const histData = await histRes.json();
        if (histData.success) setSessions(histData.sessions || {});
        const statsData = await statsRes.json();
        if (statsRes.ok && statsData.success) {
          setAuctionStats({
            recordedBattles: parseInt(statsData.recordedBattles, 10) || 0,
            totalItemsAcquired: parseInt(statsData.totalItemsAcquired, 10) || 0,
            items: Array.isArray(statsData.items) ? statsData.items : [],
          });
        } else {
          setAuctionStats(EMPTY_AUCTION_STATS);
        }
      } catch (histErr) {
        console.error('Profile history load failed:', histErr);
        setAuctionStats(EMPTY_AUCTION_STATS);
      }
    } catch (err) {
      setError(err.message || 'Failed to load profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [targetUid, user?.id]);

  const timeline = useMemo(
    () => buildMemberTrendTimeline(sessions, targetUid, 8),
    [sessions, targetUid]
  );

  const handleAdjustCredits = async (delta) => {
    if (!isOfficer || !targetUid || adjusting) return;
    setAdjusting(true);
    try {
      const res = await apiFetch(`/api/attendance/members/${encodeURIComponent(targetUid)}/leave-credits`, {
        method: 'POST',
        body: JSON.stringify({ delta }),
      });
      const data = await res.json();
      if (data.success) {
        setMember((prev) => ({ ...prev, leaveCreditsRemaining: data.leaveCreditsRemaining }));
      } else {
        alert(data.error || 'Failed to adjust leave credits.');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setAdjusting(false);
    }
  };

  if (!canView) {
    return <div className="p-6 text-xs text-rose-400 font-mono">You can only view your own profile.</div>;
  }

  if (loading) {
    return <div className="p-6 text-xs font-mono uppercase text-slate-500 animate-pulse">Loading profile…</div>;
  }

  if (error || !member) {
    return <div className="p-6 text-xs text-rose-400 font-mono">{error || 'Member not found.'}</div>;
  }

  const job = jobsCatalog[member.jobCode];
  const role = rolesCatalog[member.roleCode];
  const credits = Number.isInteger(member.leaveCreditsRemaining) ? member.leaveCreditsRemaining : 0;
  const noConfirms = parseInt(member.noConfirmCount, 10) || 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5 font-sans animate-fadeIn p-1">
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 shadow-md flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-indigo-400 shrink-0">
          {job?.iconFile ? (
            <img
              src={`/assets/icons/classes/${job.iconFile}`}
              alt=""
              className="w-7 h-7 object-contain"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <User size={20} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-100 truncate">{member.displayName || 'Raider'}</h1>
          <p className="text-[11px] text-slate-500 font-mono mt-0.5">{targetUid}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Job: {job?.name || '—'}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-300">
              Class: {role?.name || '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Leave Credits</div>
          <div className="flex items-center justify-between">
            <span className={`text-3xl font-black tabular-nums ${credits <= 0 ? 'text-rose-400' : 'text-slate-100'}`}>{credits}</span>
            {isOfficer && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={adjusting || credits <= 0}
                  onClick={() => handleAdjustCredits(-1)}
                  className="p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-rose-400 disabled:opacity-30 cursor-pointer"
                  title="Take 1 credit"
                >
                  <Minus size={14} />
                </button>
                <button
                  type="button"
                  disabled={adjusting}
                  onClick={() => handleAdjustCredits(1)}
                  className="p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-emerald-400 disabled:opacity-30 cursor-pointer"
                  title="Give 1 credit"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>
          {credits <= 0 && (
            <p className="text-[10px] text-rose-400/90">No credits remaining — Leave is locked until an officer grants more or the monthly reset.</p>
          )}
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">No Confirm</div>
          <span className={`text-3xl font-black tabular-nums ${noConfirms > 0 ? 'text-amber-400' : 'text-slate-100'}`}>{noConfirms}</span>
          <p className="text-[10px] text-slate-500">Times this member missed Confirm/Leave before the deadline.</p>
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
        <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 mb-3">Attendance graph</div>
        <MemberTrendSparkline timeline={timeline} displayName={member.displayName || 'Raider'} />
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Auction Rewards</div>
          <p className="text-[10px] text-slate-500 mt-1">Guild loot nights plus this member’s Selected bids.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Recorded Battles</div>
            <span className="text-3xl font-black tabular-nums text-slate-100">{auctionStats.recordedBattles}</span>
            <p className="text-[10px] text-slate-500">Unique nights in View Loot History.</p>
          </div>
          <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Items acquired</div>
            <span className="text-3xl font-black tabular-nums text-slate-100">{auctionStats.totalItemsAcquired}</span>
            <p className="text-[10px] text-slate-500">Pieces won with Bid Status Selected.</p>
          </div>
        </div>

        {auctionStats.items.length === 0 ? (
          <p className="text-[10px] text-slate-500 font-mono italic">No auction catalog or Selected wins recorded yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {auctionStats.items.map((item) => {
              const theme = itemTileTheme(item.colorTheme);
              return (
                <div
                  key={item.itemId}
                  className={`rounded-2xl p-4 space-y-2 ${theme.className}`}
                  style={theme.style}
                >
                  <div className="text-[10px] font-sans font-semibold truncate">{item.name || item.itemId}</div>
                  <span className="text-3xl font-black tabular-nums text-slate-100">{item.quantity || 0}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {routeUid && String(routeUid) !== String(user?.id) && (
        <button
          type="button"
          onClick={() => navigate('/attendance/profile')}
          className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-slate-300 cursor-pointer"
        >
          ← Back to my profile
        </button>
      )}
    </div>
  );
}
