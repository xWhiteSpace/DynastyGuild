import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../services/apiClient';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function emptyHours() {
  return {
    mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
  };
}

function hoursFromMine(mine) {
  const next = emptyHours();
  if (!mine?.hours) return next;
  for (const key of DAY_KEYS) {
    next[key] = Array.isArray(mine.hours[key]) ? [...mine.hours[key]] : [];
  }
  return next;
}

function hasAnyHour(hours) {
  return DAY_KEYS.some((key) => (hours[key] || []).length > 0);
}

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
  const [hours, setHours] = useState(emptyHours);
  const [heatmap, setHeatmap] = useState([]);
  const [peak, setPeak] = useState(null);
  const [filled, setFilled] = useState(0);
  const [total, setTotal] = useState(0);
  const [missing, setMissing] = useState([]);
  const paintRef = useRef(null);

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
      setHours(hoursFromMine(data.mine || null));
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

  useEffect(() => {
    const stopPaint = () => { paintRef.current = null; };
    window.addEventListener('pointerup', stopPaint);
    window.addEventListener('pointercancel', stopPaint);
    return () => {
      window.removeEventListener('pointerup', stopPaint);
      window.removeEventListener('pointercancel', stopPaint);
    };
  }, []);

  const maxCount = useMemo(() => {
    let max = 0;
    for (const row of heatmap) {
      for (const n of row || []) if (n > max) max = n;
    }
    return max;
  }, [heatmap]);

  const setCell = (dayKey, hour, on) => {
    setHours((prev) => {
      const current = new Set(prev[dayKey] || []);
      if (on) current.add(hour);
      else current.delete(hour);
      return { ...prev, [dayKey]: [...current].sort((a, b) => a - b) };
    });
  };

  const paintCell = (dayKey, hour) => {
    const paint = paintRef.current;
    if (!paint) return;
    setCell(dayKey, hour, paint.on);
  };

  const startPaint = (dayKey, hour) => {
    const on = !(hours[dayKey] || []).includes(hour);
    paintRef.current = { on };
    setCell(dayKey, hour, on);
  };

  const copyMondayToWeek = () => {
    setHours((prev) => {
      const monday = [...(prev.mon || [])];
      const next = { ...prev };
      for (const key of DAY_KEYS) next[key] = [...monday];
      return next;
    });
  };

  const clearAll = () => setHours(emptyHours());

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiFetch('/api/attendance/peak-hours/me', {
        method: 'PUT',
        body: JSON.stringify({ hours }),
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

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl overflow-x-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your hours</div>
            <p className="text-[11px] text-slate-500 mt-1">
              Click squares for the hours you play. Drag to fill a stretch. Split sessions are fine.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyMondayToWeek}
              className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white border border-slate-800 rounded-lg px-3 py-1.5"
            >
              Copy Monday to all days
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white border border-slate-800 rounded-lg px-3 py-1.5"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="min-w-[640px] select-none">
          <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 mb-1">
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-[9px] text-center text-slate-600 font-mono">
                {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
              </div>
            ))}
          </div>
          {DAY_KEYS.map((key, dayIndex) => (
            <div key={key} className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-0.5 mb-0.5">
              <div className="text-[10px] text-slate-500 font-mono self-center">{DAY_SHORT[dayIndex]}</div>
              {Array.from({ length: 24 }, (_, hour) => {
                const on = (hours[key] || []).includes(hour);
                return (
                  <button
                    key={`${key}-${hour}`}
                    type="button"
                    title={`${DAY_SHORT[dayIndex]} ${String(hour).padStart(2, '0')}:00–${hour === 23 ? '24:00' : `${String(hour + 1).padStart(2, '0')}:00`}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                      startPaint(key, hour);
                    }}
                    onPointerEnter={() => paintCell(key, hour)}
                    className={`h-6 rounded-sm border touch-none ${
                      on
                        ? 'bg-indigo-500 border-indigo-300'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving || !hasAnyHour(hours)}
            onClick={handleSave}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : mine ? 'Update' : 'Save'}
          </button>
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl overflow-x-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Guild heatmap</div>
          <div className="text-[11px] font-mono text-slate-500">
            {filled} of {total} MasterList members filled this in
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
            {DAY_SHORT.map((label, dayIndex) => (
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

      {user?.isOfficer && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-xl">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Not filled in
          </div>
          <p className="text-[11px] text-slate-500">
            MasterList raid roster without Peak Hours ({missing.length})
          </p>
          {missing.length === 0 ? (
            <p className="text-sm text-slate-500">Everyone on MasterList has set Peak Hours.</p>
          ) : (
            <ol className="list-decimal list-inside space-y-1 text-sm text-slate-200">
              {missing.map((m) => (
                <li key={m.uid}>{m.displayName}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
