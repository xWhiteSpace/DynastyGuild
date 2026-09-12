// frontend/src/pages/Scheduler.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { 
  Plus, 
  Check, 
  X, 
  Clock, 
  Tag, 
  Trash2, 
  Edit3, 
  AlertCircle,
  Calendar,
  Users,
  Zap,
  Sparkles,
  Sword,
  RefreshCw
} from 'lucide-react';
import { apiFetch, getBackendUrl } from '../services/apiClient';
import {
  formatGuildDate,
  getWeekMonday,
  buildCompositeKey,
  DEFAULT_TZ,
  guildWallTimeToUtcMs,
} from '../utils/guildTime';

const backendUrl = getBackendUrl();

export default function Scheduler({ user }) {
  const calendarRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [eventsCatalog, setEventsCatalog] = useState({});
  const [commitments, setCommitments] = useState({});
  const [specialEvents, setSpecialEvents] = useState({});
  const [weekInstances, setWeekInstances] = useState({});
  const [weekMonday, setWeekMonday] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [specialCategoriesList, setSpecialCategoriesList] = useState(['Raid', 'Meeting', 'PVP', 'Casual']);
  const [selectedDayContext, setSelectedDayContext] = useState(null);
  const [refreshingWeek, setRefreshingWeek] = useState(false);
  const [leaveCreditsRemaining, setLeaveCreditsRemaining] = useState(null);
  
  // Modal Multi-Day States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editEventId, setEditEventId] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDateStart, setFormDateStart] = useState('');
  const [formDateEnd, setFormDateEnd] = useState('');
  const [formTimeStart, setFormTimeStart] = useState('21:30');
  const [formTimeEnd, setFormTimeEnd] = useState('23:00');
  const [formType, setFormType] = useState('Raid');
  const [formDesc, setFormDesc] = useState('');
  const [formTracked, setFormTracked] = useState(true);
  const [formIsRecurring, setFormIsRecurring] = useState(false);
  const [formDaysOfWeek, setFormDaysOfWeek] = useState([]);
  const [formAllDay, setFormAllDay] = useState(false);

  const ensureCurrentWeek = async (force = false, tzOverride) => {
    const tz = tzOverride || timezone;
    const monday = getWeekMonday(tz);
    const res = await apiFetch('/api/attendance/ensure-week', {
      method: 'POST',
      body: JSON.stringify({ weekMonday: monday, force }),
    });
    const data = await res.json();
    if (data.success) {
      setWeekMonday(data.weekMonday);
      setWeekInstances(data.instances || {});
      if (data.timezone) setTimezone(data.timezone);
    }
    return data;
  };

  const loadSchedulerEcosystem = async () => {
    try {
      setLoading(true);
      const configRes = await apiFetch('/api/requests/settings/get', { method: 'GET' });
      const configData = await configRes.json();
      let nextTz = timezone;
      if (configData.success && configData.config?.events) setEventsCatalog(configData.config.events);
      if (configData.success && configData.config?.specialEventCategories) {
        setSpecialCategoriesList(configData.config.specialEventCategories);
      }
      if (configData.success && configData.config?.timezone) {
        nextTz = configData.config.timezone;
        setTimezone(nextTz);
      }

      const specialRes = await apiFetch('/api/attendance/special-events', { method: 'GET' });
      const specialData = await specialRes.json();
      if (specialData.success) setSpecialEvents(specialData.specialEvents || {});

      await ensureCurrentWeek(false, nextTz);

      const meRes = await apiFetch('/api/attendance/me', { method: 'GET' });
      const meData = await meRes.json();
      if (meData.success) setLeaveCreditsRemaining(meData.leaveCreditsRemaining);
    } catch (err) {
      console.error("Scheduler load failure:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCommitmentsFromApi = async () => {
    try {
      const res = await apiFetch('/api/attendance/commitments', { method: 'GET' });
      const data = await res.json();
      if (data.success && data.commitments) {
        setCommitments(data.commitments);
      }
    } catch (err) {
      console.error('Commitments poll failed:', err);
    }
  };

  /** Resolve RSVP status for a user under a composite key (string/number snowflake safe). */
  const getCommitmentStatus = (compositeKey, userId) => {
    if (!compositeKey || userId == null) return null;
    const bucket = commitments[compositeKey];
    if (!bucket) return null;
    const entry = bucket[userId] || bucket[String(userId)];
    return entry?.status || null;
  };

  const getInstanceDeadlineMs = (item) => {
    if (!item?.dateStr && !item?.date) return NaN;
    const dateStr = item.dateStr || item.date;
    const startMs = guildWallTimeToUtcMs(item.timeStart || '20:55', timezone, dateStr);
    if (!Number.isFinite(startMs)) return NaN;
    return startMs - 24 * 60 * 60 * 1000;
  };

  const isPastDeadline = (item) => {
    const deadline = getInstanceDeadlineMs(item);
    return Number.isFinite(deadline) && Date.now() > deadline;
  };

  useEffect(() => {
    loadSchedulerEcosystem();
    fetchCommitmentsFromApi();

    // Admin-SDK poll — reliable when client RTDB rules block browser listeners
    const pollId = setInterval(fetchCommitmentsFromApi, 4000);

    return () => {
      clearInterval(pollId);
    };
  }, [user]);

  // Re-ensure when timezone changes after first load
  useEffect(() => {
    if (!loading && timezone) {
      const monday = getWeekMonday(timezone);
      if (monday !== weekMonday) {
        ensureCurrentWeek(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  const handleRefreshWeek = async () => {
    try {
      setRefreshingWeek(true);
      await ensureCurrentWeek(true);
    } finally {
      setRefreshingWeek(false);
    }
  };

  // 🛡️ MEMOIZED COMPILER GATEWAY: Prevents array reference loops from breaking FullCalendar's internal memory index
  const formattedEvents = useMemo(() => {
    const list = [];

    // 1. Weekly Base Template Events (FullCalendar handles daysOfWeek repetition natively)
    Object.entries(eventsCatalog).forEach(([id, ev]) => {
      const p3 = ev.phases?.[3];
      if (p3) {
        list.push({
          id,
          title: ev.title,
          startTime: p3.timeStart || "20:55",
          endTime: p3.timeEnd || "22:15",
          daysOfWeek: [parseInt(p3.dayStart, 10)],
          backgroundColor: 'rgba(30, 41, 59, 0.45)', // Native color configuration theme tokens
          borderColor: 'rgb(51, 65, 85)',
          extendedProps: { isSpecial: false, config: ev }
        });
      }
    });

    // 2. Absolute Multi-Day Ad-Hoc Special Events
    Object.entries(specialEvents).forEach(([id, ev]) => {
      // 🛡️ DATA SANITIZATION GATE: Defends against non-standard database data mutations
      let validatedDays = null;
      if (ev.daysOfWeek) {
        if (Array.isArray(ev.daysOfWeek)) {
          validatedDays = ev.daysOfWeek.map(Number);
        } else if (typeof ev.daysOfWeek === 'string') {
          try {
            const parsed = JSON.parse(ev.daysOfWeek);
            if (Array.isArray(parsed)) validatedDays = parsed.map(Number);
          } catch (e) {
            // Handle comma-separated string fallbacks if SQL column was cast to Text
            validatedDays = ev.daysOfWeek.split(',').map(Number).filter(n => !isNaN(n));
          }
        }
      }

      const item = {
        id,
        title: ev.title,
        allDay: !!ev.allDay,
        backgroundColor: 'rgba(109, 40, 217, 0.25)', 
        borderColor: 'rgba(139, 92, 246, 0.5)',
        extendedProps: { 
          isSpecial: true, 
          config: { title: ev.title, phases: { 3: { timeStart: ev.timeStart || '00:00', timeEnd: ev.timeEnd || '24:00' } } }, 
          details: ev, 
          dateStr: ev.date 
        }
      };

      // Professional separation using native parameter contracts
      if (validatedDays && validatedDays.length > 0) {
        item.daysOfWeek = validatedDays;
        item.startRecur = ev.date;
        item.endRecur = ev.dateEnd;
        if (!ev.allDay) {
          item.startTime = ev.timeStart;
          item.endTime = ev.timeEnd;
        }
      } else {
        if (ev.allDay) {
          item.start = ev.date;
          item.end = ev.dateEnd || ev.date;
        } else {
          item.start = `${ev.date}T${ev.timeStart}`;
          item.end = `${ev.dateEnd || ev.date}T${ev.timeEnd}`;
        }
      }

      list.push(item);
    });

    return list;
  }, [eventsCatalog, specialEvents]);

  // 🛡️ MEMOIZED BACKGROUND SHADING: Generates custom baseline operational indicators safely
  const recurringBusinessHours = useMemo(() => {
    return Object.values(eventsCatalog).map(ev => ({
      daysOfWeek: [ parseInt(ev.phases?.[3]?.dayStart, 10) ],
      startTime: ev.phases?.[3]?.timeStart || '20:55',
      endTime: ev.phases?.[3]?.timeEnd || '22:15'
    }));
  }, [eventsCatalog]);

  const weeklyUpcomingInstances = useMemo(() => {
    const list = Object.values(weekInstances || {}).map((inst) => ({
      id: inst.eventId,
      title: inst.title,
      dateStr: inst.date,
      isSpecial: !!inst.isSpecial,
      timeStart: inst.timeStart || '20:55',
      timeEnd: inst.timeEnd || '22:15',
      isCancelled: inst.isCancelled === true,
      notes: inst.notes || '',
    }));
    return list.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.timeStart.localeCompare(b.timeStart));
  }, [weekInstances]);

  const handleAddSpecialEvent = async () => {
    if (!formTitle.trim() || !formDateStart || !formDateEnd) return alert("Fill required inputs.");
    try {
      const isEdit = !!editEventId;
      const url = isEdit ? `/api/attendance/special-events/${editEventId}` : `/api/attendance/special-events/add`;

      const res = await apiFetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify({ 
          title: formTitle, 
          description: formDesc, 
          date: formDateStart, 
          dateEnd: formDateEnd, 
          timeStart: formAllDay ? '00:00' : formTimeStart, 
          timeEnd: formAllDay ? '24:00' : formTimeEnd, 
          type: formType, 
          isAttendanceTracked: formTracked,
          daysOfWeek: formIsRecurring ? formDaysOfWeek : null,
          allDay: formAllDay
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        setFormTitle('');
        setFormDesc('');
        setFormIsRecurring(false);
        setFormDaysOfWeek([]);
        setFormAllDay(false);
        setEditEventId(null);
        setSelectedDayContext(null);
        await loadSchedulerEcosystem();
        await ensureCurrentWeek(true);
      } else {
        alert(data.error || data.message || "Database synchronization failed. Check entry schema fields.");
      }
    } catch (err) {
      console.error(err);
      alert("Network transmission failure. Check backend service connection.");
    }
  };

  const handleDeleteSpecialEvent = async (eventId) => {
    if (!window.confirm("Are you absolutely certain you want to purge this special instance from the cloud? This action cannot be undone.")) return;
    try {
      const res = await apiFetch(`/api/attendance/special-events/${eventId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setSelectedDayContext(null);
        await loadSchedulerEcosystem();
        await ensureCurrentWeek(true);
      } else {
        alert(data.message || "Failed to purge event from cloud.");
      }
    } catch (err) {
      console.error(err);
      alert("Network transmission failure while processing event deletion.");
    }
  };

  const handleLogCommitment = async (dateStr, eventId, statusTarget) => {
    try {
      const compositeKey = buildCompositeKey(dateStr, eventId);
      const uid = String(user.id);
      setCommitments(prev => {
        const updated = { ...prev };
        if (statusTarget === 'None') {
          if (updated[compositeKey]) {
            const nextBucket = { ...updated[compositeKey] };
            delete nextBucket[uid];
            delete nextBucket[user.id];
            updated[compositeKey] = nextBucket;
          }
        } else {
          updated[compositeKey] = {
            ...updated[compositeKey],
            [uid]: { displayName: user.displayName || user.username || 'Raider', status: statusTarget, declaredAt: Date.now() }
          };
        }
        return updated;
      });

      const res = await apiFetch('/api/attendance/commit-availability', {
        method: 'POST',
        body: JSON.stringify({ dateStr, eventId, status: statusTarget }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Could not update attendance.');
        await fetchCommitmentsFromApi();
        return;
      }
      if (Number.isInteger(data.leaveCreditsRemaining)) {
        setLeaveCreditsRemaining(data.leaveCreditsRemaining);
      }
      await fetchCommitmentsFromApi();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not update attendance.');
      fetchCommitmentsFromApi();
    }
  };

  const activeDayFocus = selectedDayContext;
  const userCurrentStatus = activeDayFocus
    ? getCommitmentStatus(`${activeDayFocus.dateStr}_${activeDayFocus.eventId}`, user?.id)
    : null;

  if (loading) {
    return <div className="p-6 text-xs font-mono text-slate-500 animate-pulse uppercase tracking-widest">Calling Pre-Built API Pipelines...</div>;
  }

  return (
    <div 
      className="grid grid-cols-12 gap-5 max-w-[98vw] mx-auto p-1 font-sans text-slate-200"
      onClick={() => setSelectedDayContext(null)}
    >
      
      {/* 🏛️ REFACTORED STYLE SYSTEM: Audited, streamlined, and structured to prevent layout rendering collision */}
      <style>{`
        /* === ZONE 1: UNIFIED CANVAS LAYER === */
        .fc-scrollgrid, .fc .fc-scroller, .fc .fc-popover,
        .fc .fc-col-header-cell, .fc .fc-timegrid-axis, .fc .fc-timegrid-axis-frame,
        .fc .fc-daygrid-day, .fc .fc-timegrid-slot, .fc .fc-day-today { background-color: #020617 !important; }
        .fc .fc-non-business, .fc .fc-timegrid-col { background-color: transparent !important; }

        /* === ZONE 2: NAVIGATION & TOOLBAR CONSOLE === */
        .fc .fc-toolbar { display: flex; justify-content: space-between; align-items: center; background: #020617 !important; border-bottom: 1px solid #1e293b !important; padding: 16px 0px; margin-bottom: 20px; }
        .fc .fc-button { background-color: #020617 !important; border: 1px solid #1e293b !important; color: #94a3b8 !important; font-size: 10px !important; text-transform: uppercase !important; font-weight: 700 !important; border-radius: 8px !important; padding: 6px 14px !important; transition: all 150ms; cursor: pointer; }
        .fc .fc-button:hover { background-color: #1e293b !important; color: #fff !important; border-color: #334155 !important; }
        .fc .fc-button-active { background-color: #4f46e5 !important; color: #fff !important; border-color: transparent !important; }
        .fc .fc-button:disabled { opacity: 0.25 !important; cursor: not-allowed; }
        .fc .fc-popover { border: 1px solid #1e293b !important; border-radius: 12px !important; box-shadow: 0 12px 24px rgba(0,0,0,0.6); }

        /* === ZONE 3: TYPOGRAPHY & TEXT ALIGNMENTS === */
        .fc .fc-toolbar-title { font-size: 13px !important; font-family: monospace; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #cbd5e1; }
        .fc .fc-col-header-cell-cushion { color: #94a3b8 !important; display: inline-block !important; padding: 8px 0 !important; text-transform: uppercase !important; font-size: 10px !important; font-weight: 700 !important; text-decoration: none !important; font-family: monospace; }
        .fc .fc-timegrid-slot-label-cushion { color: #64748b !important; font-size: 9px !important; text-transform: uppercase !important; font-family: monospace; }

        /* === ZONE 4: THE HAIRLINE GRID MATRIX === */
        .fc-theme-standard td, .fc-theme-standard th, .fc-scrollgrid { border: 1px solid #1e293b !important; }
        .fc .fc-timegrid-col, .fc .fc-col-header-cell { border-left: 1px dotted #1e293b !important; }

        /* === ZONE 5: INTERACTIVE HOVER & SELECTION GLOWS === */
        .fc .fc-highlight { background: rgba(79, 70, 229, 0.08) !important; }
        .fc-theme-standard td:has(.fc-highlight) { outline: 1px solid #4f46e5 !important; outline-offset: -1px !important; box-shadow: inset 0 0 8px rgba(79, 70, 229, 0.3) !important; }
        .fc-theme-standard td.fc-daygrid-day:hover, .fc-theme-standard td.fc-timegrid-slot:hover, .fc-theme-standard td.fc-timegrid-col:hover { outline: 1px solid #334155 !important; outline-offset: -1px !important; }
        
        /* Edge Safety Protection for Saturday column boundary clipping */
        .fc-theme-standard td.fc-day-sat:has(.fc-highlight), .fc-theme-standard td:last-child:has(.fc-highlight) { outline-offset: -2px !important; }
        .fc-theme-standard td.fc-day-sat:hover, .fc-theme-standard td:last-child:hover { outline-offset: -2px !important; }

        /* === ZONE 6: EVENT HALO & ENGINE PATCHES === */
        .fc .fc-timegrid-event, .fc .fc-v-event, .fc .fc-daygrid-event, .fc .fc-h-event { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
        .fc-scroller-spacer, .fc-scroller-scrollbar-geometry { pointer-events: none !important; width: 0 !important; display: none !important; }
        .fc .fc-now-indicator-line { border-color: #4f46e5 !important; border-width: 1px !important; }
        .fc .fc-now-indicator-arrow { border-left-color: #4f46e5 !important; }
      `}</style>
      
      {/* LEFT COMPONENT: CORE FULLCALENDAR ENGINE */}
      <div className="col-span-12 lg:col-span-9 space-y-4">
        {user?.isOfficer && (
          <div className="bg-slate-900/40 border border-slate-800 h-[52px] px-5 rounded-2xl flex justify-between items-center select-none">
            <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">Officer Tools:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefreshWeek}
                disabled={refreshingWeek}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-[10px] uppercase font-bold text-slate-200 transition flex items-center gap-1.5 border border-slate-700 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={13} strokeWidth={2.5} className={refreshingWeek ? 'animate-spin' : ''} /> Refresh Week
              </button>
              <button
                type="button"
                onClick={() => {
                  const todayGuild = formatGuildDate(new Date(), timezone);
                  setFormTitle(''); setFormDesc(''); setFormDateStart(todayGuild); setFormDateEnd(todayGuild); setEditEventId(null); setShowAddModal(true);
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-[10px] uppercase font-bold text-white transition flex items-center gap-1.5 shadow cursor-pointer"
              >
                <Plus size={13} strokeWidth={2.5} /> Create Special Event
              </button>
            </div>
          </div>
        )}

        <div className="border border-slate-800 bg-slate-950/40 rounded-3xl p-4 shadow-xl contextual-calendar-provider">
          <FullCalendar
            ref={calendarRef}
            key={loading ? 'loading' : 'synchronized-grid'} // 🛡️ REDRAW FORCE FENCE: Guarantees async records manifest instantly
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            allDaySlot={false}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            slotLabelFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }}
            slotEventOverlap={false}
            height="auto"
            
            // 🛠 *CONNECT NATIVE TOOLBAR API STRUCTURES*
            headerToolbar={{
              left: 'title',
              center: '',
              right: 'prev,next dayGridMonth,timeGridWeek'
            }}

            // 🛠 *CALL BUILT-IN CHANNELS NATIVELY*
            events={formattedEvents}
            selectable={!!user?.isOfficer}
            selectMirror={true}
            editable={!!user?.isOfficer}
            dayMaxEvents={true}
            nowIndicator={true}
            businessHours={recurringBusinessHours}

            // 🛠 *MULTI-DAY CELL DRAG INPUT FORMS SELECTION CAPTURE*
            select={(selectionInfo) => {
              setFormDateStart(selectionInfo.startStr.split('T')[0]);
              
              let targetEnd = selectionInfo.endStr.split('T')[0];
              if (selectionInfo.view.type === 'dayGridMonth') {
                const d = new Date(selectionInfo.end);
                d.setDate(d.getDate() - 1);
                targetEnd = d.toISOString().split('T')[0];
              }
              setFormDateEnd(targetEnd);

              if (selectionInfo.view.type === 'timeGridWeek') {
                setFormTimeStart(selectionInfo.startStr.split('T')[1]?.slice(0, 5) || '21:30');
                setFormTimeEnd(selectionInfo.endStr.split('T')[1]?.slice(0, 5) || '23:00');
              }
              setEditEventId(null);
              setFormTitle('');
              setFormDesc('');
              setShowAddModal(true);
            }}

            // 🛠 *PROGRAMMATIC DRAG RESCHEDULING INTERCEPTOR*
            eventDrop={async (dropInfo) => {
              const { id, extendedProps, start, end } = dropInfo.event;
              if (!extendedProps.isSpecial) return dropInfo.revert();

              const nextStart = formatGuildDate(start, timezone);
              let nextEnd = end ? formatGuildDate(end, timezone) : nextStart;
              
              if (end && dropInfo.event.allDay) {
                const d = new Date(end);
                d.setDate(d.getDate() - 1);
                nextEnd = formatGuildDate(d, timezone);
              }

              try {
                const res = await apiFetch(`/api/attendance/special-events/${id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    ...extendedProps.details,
                    date: nextStart,
                    dateEnd: nextEnd
                  }),
                });
                const data = await res.json();
                if (!data.success) dropInfo.revert();
                else {
                  await loadSchedulerEcosystem();
                  await ensureCurrentWeek(true);
                }
              } catch (err) {
                dropInfo.revert();
              }
            }}

            // 🛠 *LIVE CORE SIGNUP BADGES COMPILER HOOK*
            eventContent={(eventInfo) => {
              const props = eventInfo.event.extendedProps;
              const dateStr = props.isSpecial && props.dateStr
                ? props.dateStr
                : formatGuildDate(eventInfo.event.start, timezone);
              const compositeKey = buildCompositeKey(dateStr, eventInfo.event.id);
              const signedUsers = commitments[compositeKey] ? Object.values(commitments[compositeKey]) : [];
              
              const presentCount = signedUsers.filter(u => u.status === 'Confirmed').length;
              const leaveCount = signedUsers.filter(u => u.status === 'Leave').length;

              const isSpecial = props.isSpecial;
              const backgroundColor = isSpecial ? 'rgba(109, 40, 217, 0.25)' : 'rgba(30, 41, 59, 0.45)';
              const borderColor = isSpecial ? 'rgba(139, 92, 246, 0.5)' : 'rgb(51, 65, 85)';

              return (
                <div 
                  className="p-1 rounded-md text-[11px] leading-tight truncate w-full h-full border flex flex-col justify-center"
                  style={{ backgroundColor, borderColor }}
                >
                  <div className="font-medium uppercase tracking-wide text-slate-100 truncate">
                    {eventInfo.event.title}
                  </div>
                  <div className="text-slate-400 font-mono text-[10px] mt-0.5 flex items-center gap-1 select-none">
                    <Users size={11} className="text-slate-400 shrink-0" />
                    <span className="text-emerald-400 font-bold">{presentCount}</span>
                    <span>/</span>
                    <span className="text-rose-400 font-bold">{leaveCount}</span>
                  </div>
                </div>
              );
            }}

            eventClick={(info) => {
              info.jsEvent.stopPropagation();
              const props = info.event.extendedProps;
              const dateStr = props.isSpecial && props.dateStr
                ? props.dateStr
                : formatGuildDate(info.event.start, timezone);
              
              setSelectedDayContext((prev) => {
                if (prev?.eventId === info.event.id && prev?.dateStr === dateStr) {
                  return null;
                }
                return {
                  eventId: info.event.id,
                  config: props.config,
                  dateStr,
                  dayNum: info.event.start.getDate(),
                  isSpecial: props.isSpecial,
                  details: props.details || null
                };
              });
            }}
          />
        </div>
      </div>

      {/* RIGHT COMPONENT: SIDEBAR ROSTER DESK */}
      <div className="col-span-12 lg:col-span-3 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="bg-slate-900/40 border border-slate-800 h-[52px] px-5 rounded-2xl flex items-center gap-2 select-none">
          <Zap size={14} className="text-amber-400 shrink-0" />
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Guild Scheduler</h3>
        </div>

        {activeDayFocus ? (
          <div className="border border-slate-800 bg-slate-950/40 rounded-3xl p-5 space-y-5 shadow-xl animate-fadeIn">
            <button
                type="button"
                onClick={() => setSelectedDayContext(null)}
                className="mb-1 text-[10px] font-mono font-bold text-slate-400 hover:text-indigo-400 uppercase tracking-wider flex items-center gap-1 transition-colors cursor-pointer"
              >
                ← Back to Quick View
              </button>
              <div className="space-y-1 select-none">
                <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Event Details</span>
              <h4 className="text-sm font-black text-slate-200 tracking-wide font-sans mt-0.5 flex items-center gap-2">
                {activeDayFocus.isSpecial ? (
                  <Sparkles size={15} className="text-violet-400 shrink-0" />
                ) : (
                  <Sword size={15} className="text-slate-400 shrink-0" />
                )}
                <span>{activeDayFocus.config.title}</span>
              </h4>
              <div className="text-xs font-mono text-indigo-400 font-bold mt-1 bg-indigo-950/20 border border-indigo-900/40 rounded-xl px-3 py-1.5">
                <span>{activeDayFocus.dateStr}</span>
              </div>
            </div>

            <div className="bg-slate-900/20 border border-slate-900 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                <Clock size={14} className="text-slate-500" /> Time
              </div>
              <div className="text-xs font-mono font-bold text-slate-300 pl-5">
                {activeDayFocus.config.phases?.[3]?.timeStart || '21:30'} ~ {activeDayFocus.config.phases?.[3]?.timeEnd || '23:00'}
              </div>
            </div>

            {(() => {
              const roster = commitments[`${activeDayFocus.dateStr}_${activeDayFocus.eventId}`] ? Object.values(commitments[`${activeDayFocus.dateStr}_${activeDayFocus.eventId}`]) : [];
              const present = roster.filter(u => u.status === 'Confirmed');
              const leave = roster.filter(u => u.status === 'Leave');
              return (
                <div className="space-y-2.5 bg-slate-900/20 border border-slate-900 rounded-2xl p-3.5">
                  <div className="flex justify-between items-center font-mono pb-1.5 border-b border-slate-900 select-none">
                    {/* Left: Primary Section Title (Larger font sizing) */}
                    <span className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                      <Users size={12} className="text-slate-500 shrink-0"/>Attendees
                    </span>
                    
                    {/* Right: Micro-Sized Subordinate Column Groups with Centered Counter Digits */}
                    <div className="flex items-center gap-4 pl-6 text-slate-500 font-bold uppercase tracking-wider">
                      <div className="flex flex-col items-center min-w-[45px]">
                        <span className="text-[8px] tracking-wide">Present</span>
                        <span className="text-[11px] font-sans font-bold text-emerald-400 mt-0.5">{present.length}</span>
                      </div>
                      <div className="flex flex-col items-center min-w-[45px]">
                        <span className="text-[8px] tracking-wide">Leave</span>
                        <span className="text-[11px] font-sans font-bold text-rose-400 mt-0.5">{leave.length}</span>
                      </div>
                    </div>
                  </div>
                  {roster.length === 0 ? (
                    <div className="text-slate-600 italic font-mono text-[10px] py-1">No personnel profiles declared.</div>
                  ) : (
                    <div className="max-h-[120px] overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
                      {present.map((u, i) => (
                        <div key={i} className="flex justify-between items-center bg-emerald-950/10 border border-emerald-900/10 rounded-xl px-2.5 py-1 text-emerald-400">
                          <span className="truncate max-w-[130px] font-medium">{u.displayName}</span>
                          <span className="text-[9px] uppercase font-bold text-emerald-500/80">Present</span>
                        </div>
                      ))}
                      {leave.map((u, i) => (
                        <div key={i} className="flex justify-between items-center bg-rose-950/10 border border-rose-900/10 rounded-xl px-2.5 py-1 text-slate-400">
                          <span className="truncate max-w-[130px] line-through text-slate-500">{u.displayName}</span>
                          <span className="text-[9px] uppercase font-bold text-rose-500/80">Leave</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="space-y-2 pt-1">
              <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest block mb-1">Select Availability:</span>
              <button type="button" disabled={isPastDeadline({ dateStr: activeDayFocus.dateStr, timeStart: weekInstances[`${activeDayFocus.dateStr}_${activeDayFocus.eventId}`]?.timeStart || eventsCatalog[activeDayFocus.eventId]?.phases?.[3]?.timeStart })} onClick={() => handleLogCommitment(activeDayFocus.dateStr, activeDayFocus.eventId, userCurrentStatus === 'Confirmed' ? 'None' : 'Confirmed')} className={`w-full p-3 rounded-2xl border text-xs font-bold uppercase tracking-wide flex items-center justify-between transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${userCurrentStatus === 'Confirmed' ? 'border-emerald-500 bg-emerald-950/20 text-emerald-400' : 'border-slate-800 bg-slate-900/40 text-slate-400'}`}>
                <span>Confirm Attendance</span> {userCurrentStatus === 'Confirmed' && <Check size={16} />}
              </button>
              <button type="button" disabled={isPastDeadline({ dateStr: activeDayFocus.dateStr, timeStart: weekInstances[`${activeDayFocus.dateStr}_${activeDayFocus.eventId}`]?.timeStart || eventsCatalog[activeDayFocus.eventId]?.phases?.[3]?.timeStart }) || (Number.isInteger(leaveCreditsRemaining) && leaveCreditsRemaining <= 0 && userCurrentStatus !== 'Leave')} onClick={() => handleLogCommitment(activeDayFocus.dateStr, activeDayFocus.eventId, userCurrentStatus === 'Leave' ? 'None' : 'Leave')} className={`w-full p-3 rounded-2xl border text-xs font-bold uppercase tracking-wide flex items-center justify-between transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${userCurrentStatus === 'Leave' ? 'border-amber-500 bg-amber-950/20 text-amber-400' : 'border-slate-800 bg-slate-900/40 text-slate-400'}`}>
                <span>Request Leave</span> {userCurrentStatus === 'Leave' && <X size={16} />}
              </button>
            </div>

            {activeDayFocus.isSpecial && user?.isOfficer && (
              <div className="pt-3 border-t border-slate-900/60 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const det = activeDayFocus.details || {};
                    setFormTitle(det.title || activeDayFocus.config.title || '');
                    setFormDesc(det.description || '');
                    setFormDateStart(det.date || activeDayFocus.dateStr || '');
                    setFormDateEnd(det.dateEnd || det.date || activeDayFocus.dateStr || '');
                    setFormTimeStart(det.timeStart || '21:30');
                    setFormTimeEnd(det.timeEnd || '23:00');
                    setFormType(det.type || 'Raid');
                    setFormTracked(det.isAttendanceTracked !== undefined ? det.isAttendanceTracked : true);
                    setFormIsRecurring(!!det.daysOfWeek && det.daysOfWeek.length > 0);
                    setFormDaysOfWeek(det.daysOfWeek || []);
                    setFormAllDay(!!det.allDay);
                    setEditEventId(activeDayFocus.eventId);
                    setShowAddModal(true);
                  }}
                  className="w-full p-2 rounded-xl border border-indigo-950 bg-indigo-950/20 hover:bg-indigo-600 text-indigo-400 hover:text-white text-[10px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Edit3 size={13} /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSpecialEvent(activeDayFocus.eventId)}
                  className="w-full p-2 rounded-xl border border-rose-950 bg-rose-950/20 hover:bg-rose-600 text-rose-400 hover:text-white text-[10px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
            ) : (
              <div className="border border-slate-800 bg-slate-950/40 rounded-3xl p-4 space-y-4 shadow-xl animate-fadeIn flex flex-col">
                <div className="select-none border-b border-slate-900 pb-2.5">
                  <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Quick Actions</span>
                  <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mt-0.5">
                    <Calendar size={13} className="text-indigo-400" /> Upcoming Week Sign-Up
                  </h4>
                </div>
                
                <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1 scrollbar-thin pt-1 flex-1">
                  {weeklyUpcomingInstances.length === 0 ? (
                    <div className="text-center py-8 text-[11px] text-slate-600 font-mono italic">No events scheduled for the next 7 days.</div>
                  ) : (
                    weeklyUpcomingInstances.map((item, idx) => {
                      const compositeKey = buildCompositeKey(item.dateStr, item.id);
                      const currentStatus = getCommitmentStatus(compositeKey, user?.id);

                      const isCancelled = item.isCancelled === true;
                      const displayTitle = item.title;
                      const displayNotes = item.notes;
                      
                      const dateObj = new Date(item.dateStr + 'T12:00:00Z');
                      const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
                      const monthDayLabel = dateObj.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', timeZone: 'UTC' });

                      return (
                        <div key={`${compositeKey}_${idx}`} className={`p-2.5 rounded-xl border border-slate-800/60 bg-slate-900/20 flex flex-col space-y-2 hover:border-slate-800 transition-colors ${isCancelled ? 'opacity-60' : ''}`}>
                          <div className="flex justify-between items-start gap-2 min-w-0">
                            <div className="min-w-0 flex-1">
                              <div className={`text-[11px] font-bold truncate uppercase tracking-wide flex items-center gap-1 ${isCancelled ? 'text-rose-500 line-through' : 'text-slate-200'}`}>
                                {item.isSpecial ? <Sparkles size={11} className="text-violet-400 shrink-0" /> : <Sword size={11} className="text-slate-500 shrink-0" />}
                                <span className="truncate">{isCancelled ? `[CANCELLED] ${displayTitle}` : displayTitle}</span>
                              </div>
                              {displayNotes && <div className="text-[10px] text-indigo-400 font-sans italic mt-0.5">📝 {displayNotes}</div>}
                              <div className="text-[9px] font-mono text-slate-500 mt-0.5">
                                {item.timeStart} - {item.timeEnd}
                              </div>
                            </div>
                            <div className="text-right shrink-0 font-mono text-[10px] bg-slate-950 px-2 py-0.5 border border-slate-900 rounded-md text-slate-400 font-bold">
                              {dayLabel} {monthDayLabel}
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-1.5 pt-0.5 font-sans">
                            <button
                              type="button"
                              disabled={isCancelled || isPastDeadline(item)}
                              onClick={() => handleLogCommitment(item.dateStr, item.id, currentStatus === 'Confirmed' ? 'None' : 'Confirmed')}
                              className={`py-1 px-2 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                currentStatus === 'Confirmed'
                                  ? 'border-emerald-500 bg-emerald-950/30 text-emerald-400 font-black'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              Confirm {currentStatus === 'Confirmed' && <Check size={11} strokeWidth={3} />}
                            </button>
                            <button
                              type="button"
                              disabled={isCancelled || isPastDeadline(item) || (Number.isInteger(leaveCreditsRemaining) && leaveCreditsRemaining <= 0 && currentStatus !== 'Leave')}
                              onClick={() => handleLogCommitment(item.dateStr, item.id, currentStatus === 'Leave' ? 'None' : 'Leave')}
                              className={`py-1 px-2 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                currentStatus === 'Leave'
                                  ? 'border-amber-500 bg-amber-950/30 text-amber-400 font-black'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              Leave {currentStatus === 'Leave' && <X size={11} strokeWidth={3} />}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
      </div>

      {/* INPUT FORM MODAL CONTAINER */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="fixed inset-0 z-0" onClick={() => setShowAddModal(false)} />
          <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl relative z-10 space-y-4 font-sans text-xs text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wide">{editEventId ? 'Modify Event Data' : 'Schedule Special Instance'}</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
            </div>
            
            <div className="space-y-3.5">
              {/* ROW 1: PRIMARY TITLING */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Event Title</label>
                <input type="text" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-700" />
              </div>

              {/* ROW 2: CORE DROPDOWN METADATA COMBINATION */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1"><Tag size={12}/> Category</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-300 outline-none cursor-pointer">
                    {specialCategoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1"><AlertCircle size={12}/> Attendance</label>
                  <select value={formTracked ? "yes" : "no"} onChange={(e) => setFormTracked(e.target.value === "yes")} className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-300 outline-none cursor-pointer">
                    <option value="yes">Strict Monitored Attendance</option>
                    <option value="no">Untracked Event</option>
                  </select>
                </div>
              </div>

              {/* ROW 3: DATE SELECTION MATRIX (Morphic Industry Standard Design Logic) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                    <Calendar size={12}/> {formIsRecurring ? 'Schedule Activates On' : 'Start Date'}
                  </label>
                  <input type="date" value={formDateStart} onChange={(e) => setFormDateStart(e.target.value)} className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 font-mono outline-none" />
                </div>
                {!formIsRecurring && (
                  <div className="space-y-1 animate-fadeIn">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1"><Calendar size={12}/> End Date</label>
                    <input type="date" value={formDateEnd} onChange={(e) => setFormDateEnd(e.target.value)} className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 font-mono outline-none" />
                  </div>
                )}
              </div>

              {/* ROW 4: DUAL UNIFIED LAYOUT TOGGLE PLATFORM */}
              <div className="grid grid-cols-2 gap-3 border-t border-slate-900/60 pt-3.5 select-none font-bold text-slate-500 text-[10px] uppercase tracking-wider">
                <div className="flex items-center justify-between bg-slate-950/30 border border-slate-800/40 rounded-xl px-3 h-9">
                  <label className="cursor-pointer">All Day Event</label>
                  <input type="checkbox" checked={formAllDay} onChange={(e) => setFormAllDay(e.target.checked)} className="accent-indigo-500 cursor-pointer w-3.5 h-3.5" />
                </div>
                <div className="flex items-center justify-between bg-slate-950/30 border border-slate-800/40 rounded-xl px-3 h-9">
                  <label className="cursor-pointer">Repeat Weekly</label>
                  <input type="checkbox" checked={formIsRecurring} onChange={(e) => setFormIsRecurring(e.target.checked)} className="accent-indigo-500 cursor-pointer w-3.5 h-3.5" />
                </div>
              </div>
              
              {/* ROW 5: TEAMS-STYLE RECURRENCE DETAILS CONSOLE POOL */}
              {formIsRecurring && (
                <div className="space-y-3 bg-slate-950/20 border border-slate-900/50 rounded-2xl p-3 animate-fadeIn">
                  <span className="text-[8px] font-mono font-bold text-slate-500 uppercase tracking-widest block">Repeat Cycle Pattern Days:</span>
                  <div className="flex justify-between gap-1 select-none">
                    {[
                      { label: 'S', value: 0 }, { label: 'M', value: 1 }, { label: 'T', value: 2 }, 
                      { label: 'W', value: 3 }, { label: 'T', value: 4 }, { label: 'F', value: 5 }, { label: 'S', value: 6 }
                    ].map((d) => {
                      const isSelected = formDaysOfWeek.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => setFormDaysOfWeek(prev => isSelected ? prev.filter(x => x !== d.value) : [...prev, d.value])}
                          className={`w-8 h-8 rounded-xl font-mono text-[11px] font-bold border transition-all flex items-center justify-center ${
                            isSelected 
                              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400 shadow-[0_0_12px_rgba(79,70,229,0.2)]' 
                              : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  
                  <div className="space-y-1 pt-0.5">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1"><Calendar size={12}/> Repeat Cycle Until (Expiration Date)</label>
                    <input type="date" value={formDateEnd} onChange={(e) => setFormDateEnd(e.target.value)} className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 font-mono outline-none" />
                  </div>
                </div>
              )}

              {/* ROW 6: ABSOLUTE TIME RANGE DIALS CELL */}
              {!formAllDay && (
                <div className="grid grid-cols-2 gap-3 animate-fadeIn">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Start Time</label>
                    <input type="text" maxLength="5" value={formTimeStart} onChange={(e) => setFormTimeStart(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-center font-mono text-amber-500 font-bold outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">End Time</label>
                    <input type="text" maxLength="5" value={formTimeEnd} onChange={(e) => setFormTimeEnd(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-center font-mono text-amber-400 font-bold outline-none" />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Notes & Descriptions</label>
                <textarea rows="2" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none resize-none" />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 font-mono">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-slate-800 bg-slate-950 text-slate-400 hover:text-white rounded-xl transition cursor-pointer">Cancel</button>
              <button type="button" onClick={handleAddSpecialEvent} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold uppercase rounded-xl shadow-lg transition cursor-pointer">{editEventId ? 'Save Changes' : 'Push to Cloud'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}