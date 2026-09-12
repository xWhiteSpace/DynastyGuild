import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../services/apiClient';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_DAYS = [...DAY_KEYS];
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hour = String(Math.floor(i / 2)).padStart(2, '0');
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
});

function cellClass(count, max) {
  if (!count) return 'bg-slate-950';
  if (!max) return 'bg-indigo-950';
  const t = count / max;
  if (t >= 1) return 'bg-amber-400';
  if (t >= 0.7) return 'bg-indigo-400';
  if (t >= 0.4) return 'bg-indigo-600';
  return 'bg-indigo-950';
}

export default function PeakHoursTab({ user }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [mine, setMine] = useState(null);
  const [start, setStart] = useState('21:00');
  const [end, setEnd] = useState('23:30');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [heatmap, setHeatmap] = useState([]);
  const [peak, setPeak] = useState(null);
  const [filled, setFilled] = useState(0);
  const [total, setTotal] = useState(0);
  const [missing, setMissing] = useState([]);

  const load = async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError('');
      const res = await apiFetch('/api/attendance/peak-hours', { method: 'GET' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not load Peak Hours.');
        return;
      }
      setTimezone(data.timezone || 'Asia/Manila');
      setMine(data.mine || null);
      setStart(data.mine?.start || '21:00');
      setEnd(data.mine?.end || '23:30');
      setDays(data.mine?.days?.length ? data.mine.days : DEFAULT_DAYS);
      setHeatmap(Array.isArray(data.heatmap) ? data.heatmap : []);
      setPeak(data.peak || null);
      setFilled(data.filled || 0);
      setTotal(data.total || 0);
      setMissing(Array.isArray(data.missing) ? data.missing : []);
    } catch (err) {
      setError(err.message || 'Could not load Peak Hours.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const row of heatmap) {
      for (const n of row || []) if (n > max) max = n;
    }
    return max;
  }, [heatmap]);

  const toggleDay = (key) => {
    setDays((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiFetch('/api/attendance/peak-hours/me', {
        method: 'PUT',
        body: JSON.stringify({ start, end, days }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not save Peak Hours.');
        return;
      }
      setMine(data.mine || null);
      setSuccess('Peak Hours saved.');
      await load({ quiet: true });
    } catch (err) {
      setError(err.message || 'Could not save Peak Hours.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium animate-pulse text-xs font-mono uppercase tracking-widest">
        Loading Peak Hours...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[98vw] mx-auto p-2 font-sans animate-fadeIn">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 shadow-md">
        <h1 className="text-lg font-bold tracking-wider text-slate-200 uppercase">Guild Peak Hours</h1>
        <p className="text-[11px] font-mono text-slate-500 mt-1">
          When this guild is usually online ({timezone})
        </p>
      </div>

      {error && (
        <div className="bg-rose-950/30 border border-rose-500/30 text-rose-400 text-xs p-3.5 rounded-xl font-semibold">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 text-xs p-3.5 rounded-xl font-semibold">
          {success}
        </div>
      )}

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your window</div>
        <p className="text-[11px] text-slate-500">
          Two times, then tap days off. Overnight is fine (22:00 to 02:00).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            From
            <select
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 block bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={`s-${t}`} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
            To
            <select
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 block bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={`e-${t}`} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={saving || days.length === 0}
            onClick={handleSave}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : mine ? 'Update' : 'Save'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {DAY_KEYS.map((key, i) => {
            const on = days.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleDay(key)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${
                  on
                    ? 'border-indigo-500 bg-indigo-600 text-white'
                    : 'border-slate-800 bg-slate-950 text-slate-500'
                }`}
              >
                {DAY_LABELS[i]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl overflow-x-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Guild heatmap</div>
          <div className="text-[11px] font-mono text-slate-500">
            {filled} of {total} members filled this in
          </div>
        </div>
        {peak?.label && (
          <p className="text-sm font-semibold text-amber-300">{peak.label}</p>
        )}
        {maxCount === 0 ? (
          <p className="text-sm text-slate-500">No one has set Peak Hours yet.</p>
        ) : (
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 mb-1">
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-[9px] text-center text-slate-600 font-mono">
                  {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                </div>
              ))}
            </div>
            {DAY_LABELS.map((label, dayIndex) => (
              <div key={label} className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 mb-0.5">
                <div className="text-[10px] text-slate-500 font-mono self-center">{label}</div>
                {Array.from({ length: 24 }, (_, hour) => {
                  const count = heatmap[dayIndex]?.[hour] || 0;
                  const isPeak = peak && count === maxCount && count > 0;
                  return (
                    <div
                      key={`${dayIndex}-${hour}`}
                      title={`${label} ${String(hour).padStart(2, '0')}:00 · ${count}`}
                      className={`h-5 rounded-sm ${cellClass(count, maxCount)} ${isPeak ? 'ring-1 ring-amber-300' : ''}`}
                    />
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-2 mt-3 text-[10px] font-mono text-slate-500">
              <span>Fewer</span>
              <span className="h-3 w-3 rounded-sm bg-slate-950 border border-slate-800" />
              <span className="h-3 w-3 rounded-sm bg-indigo-950" />
              <span className="h-3 w-3 rounded-sm bg-indigo-600" />
              <span className="h-3 w-3 rounded-sm bg-indigo-400" />
              <span className="h-3 w-3 rounded-sm bg-amber-400" />
              <span>Peak</span>
            </div>
          </div>
        )}
      </div>

      {user?.isOfficer && missing.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-xl">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Not filled in ({missing.length})
          </div>
          <p className="text-[11px] text-slate-500">Officers only. Names, not their hours.</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((m) => (
              <span
                key={m.uid}
                className="px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-950 text-[11px] text-slate-300"
              >
                {m.displayName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
