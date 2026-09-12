// frontend/src/pages/LiveRaidTab.jsx
import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Play, 
  ArrowLeft, 
  LogOut, 
  Plus, 
  Copy, 
  Trash2, 
  Settings, 
  MoreVertical, 
  Search, 
  Check, 
  X, 
  UserPlus, 
  Save,
  Grid,
  ChevronLeft,
  ChevronRight,
  Info,
  Volume2,
  AlertTriangle,
  Radio,
  RefreshCw,
  Ban,
  Lock,
  Eraser,
  Users,
  ShieldOff,
  Flag,
  Crown,
  Timer,
  Square,
  Megaphone
} from 'lucide-react';

import RaidMemberCard from '../components/RaidMemberCard';
import RosterSidebar from '../components/RosterSidebar';
import PublishedPartyGrid from '../components/PublishedPartyGrid';
import { buildMemberTrendTimeline } from '../components/MemberTrendSparkline';
import MemberTrendHoverTip from '../components/MemberTrendHoverTip';
import { DEFAULT_TZ, guildWallTimeToUtcMs, formatGuildTimeHhMm } from '../utils/guildTime';
import { apiFetch } from '../services/apiClient';
import { normalizeCompositionsMap, isSlotCoordKey } from '@guildname/shared/compositionTabs';

const backendUrl = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:5001';

export default function LiveRaidTab({ user }) {
  const isOfficer = user?.isOfficer === true;

  // --- Real-time Core Database States ---
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null); // Active Live Session
  const [localStep, setLocalStep] = useState(1); // Local wizard step when session is null
  const [guildTimezone, setGuildTimezone] = useState(DEFAULT_TZ);
  const [historySessions, setHistorySessions] = useState({});

  // --- Master Registries Loaded from Settings ---
  const [eventsCatalog, setEventsCatalog] = useState({});
  const [compositions, setCompositions] = useState({});
  const [publishedCompositions, setPublishedCompositions] = useState({});
  const [publishedAnchor, setPublishedAnchor] = useState(null);
  const [selectedPublishedId, setSelectedPublishedId] = useState('');
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [addConfigId, setAddConfigId] = useState('');
  const [addingConfig, setAddingConfig] = useState(false);
  const [removingConfigId, setRemovingConfigId] = useState('');
  const [announcing, setAnnouncing] = useState({ id: '', kind: '' });
  const [members, setMembers] = useState({});
  const [jobsCatalog, setJobsCatalog] = useState({});
  const [commitments, setCommitments] = useState({});
  const [warRoomsCatalog, setWarRoomsCatalog] = useState({});
  const [maxWarRoomsLimit, setMaxWarRoomsLimit] = useState(2);

  // --- Step 2 Setup Forms States ---
  const [selectedEventKey, setSelectedEventKey] = useState('');
  const [selectedEventDate, setSelectedEventDate] = useState('');
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [selectedWarRooms, setSelectedWarRooms] = useState([]);

  // --- Step 3 Execution mirror states ---
  const [activeTabConfigId, setActiveTabConfigId] = useState('');
  const [localGrids, setLocalGrids] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState('synced'); // 'synced' | 'saving' | 'error'
  const [liveVoiceUids, setLiveVoiceUids] = useState([]); // Array of UIDs in voice rooms currently
  
  // UI Panels states
  const [activePopover, setActivePopover] = useState(null); // { coordKey, type: 'assign' | 'gear' | 'trend' }
  const [selectedPopoverJob, setSelectedPopoverJob] = useState('');
  const [dragHoveredCoord, setDragHoveredCoord] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [openAccordion, setOpenAccordion] = useState({ standby: true, uncommitted: true, leave: false });
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  // Tick once per second so monitoring start/end can light up green when reached
  const [nowMs, setNowMs] = useState(() => Date.now());

  // --- Monitoring Schedule (set during Step 2 config, applied on launch) ---
  const [monitoringStartTime, setMonitoringStartTime] = useState('');
  const [monitoringEndTime, setMonitoringEndTime] = useState('');
  const [monitoringPollInterval, setMonitoringPollInterval] = useState(15);
  const monitoringStartTimeRef = useRef('');
  const monitoringEndTimeRef = useRef('');
  const monitoringPollIntervalRef = useRef(15);
  const monitoringStartInputRef = useRef(null);
  const monitoringEndInputRef = useRef(null);

  const setMonitoringStart = (val) => {
    const next = val || '';
    monitoringStartTimeRef.current = next;
    setMonitoringStartTime(next);
  };
  const setMonitoringEnd = (val) => {
    const next = val || '';
    monitoringEndTimeRef.current = next;
    setMonitoringEndTime(next);
  };
  const setMonitoringPoll = (val) => {
    const next = Math.max(15, Number(val) || 15);
    monitoringPollIntervalRef.current = next;
    setMonitoringPollInterval(next);
  };

  const gridRef = useRef(null);
  const isDirtyRef = useRef(false);
  const persistInFlightRef = useRef(false);
  const localGridsRef = useRef({});
  const sessionRef = useRef(null);
  const partyNamePersistTimer = useRef(null);

  const markDirty = (value) => {
    isDirtyRef.current = value;
    setIsDirty(value);
  };

  // Monitoring times use the selected guild timezone from Settings
  const msToTimeInput = (ms) => formatGuildTimeHhMm(ms, guildTimezone || DEFAULT_TZ);

  /**
   * Auto-format typed digits into HH:MM.
   * 2000 → 20:00, 1924 → 19:24, 930 → 9:30 (pads to 09:30 on blur)
   */
  const formatTimeDigits = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length === 0) return '';
    if (digits.length <= 2) return digits;
    if (digits.length === 3) return `${digits[0]}:${digits.slice(1)}`;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  };

  // Normalize to strict HH:MM — accepts "20:00", "2000", "9:30", "930"
  const normalizeTimeValue = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    const withColon = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::\d{2})?$/);
    if (withColon) {
      const hh = Math.min(23, parseInt(withColon[1], 10));
      const mm = Math.min(59, parseInt(withColon[2], 10));
      if (Number.isNaN(hh) || Number.isNaN(mm)) return '';
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 3) {
      // 930 → 09:30
      const hh = Math.min(23, parseInt(digits.slice(0, 1), 10));
      const mm = Math.min(59, parseInt(digits.slice(1), 10));
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    if (digits.length === 4) {
      const hh = Math.min(23, parseInt(digits.slice(0, 2), 10));
      const mm = Math.min(59, parseInt(digits.slice(2), 10));
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    return '';
  };

  const handleMonitoringTimeChange = (setter) => (e) => {
    setter(formatTimeDigits(e.target.value));
  };

  const handleMonitoringTimeBlur = (setter, current) => () => {
    const normalized = normalizeTimeValue(current);
    if (normalized) setter(normalized);
  };

  // Hydrate Step 2 form from an active live session.
  // Important: if session has no monitoring yet, do NOT wipe draft times the officer typed.
  const hydrateSetupFromSession = (s) => {
    if (!s) return;
    if (s.eventKey) setSelectedEventKey(s.eventKey);
    if (s.eventDate) setSelectedEventDate(s.eventDate);
    if (s.selectedConfigId) setSelectedConfigId(s.selectedConfigId);
    if (s.publishedId) setSelectedPublishedId(s.publishedId);
    else if (s.eventDate && s.eventKey) setSelectedPublishedId(`${s.eventDate}_${s.eventKey}`);
    if (Array.isArray(s.selectedWarRoomIds) && s.selectedWarRoomIds.length > 0) {
      setSelectedWarRooms(s.selectedWarRoomIds);
    }
    if (s.monitoringStartsAt) {
      setMonitoringStart(msToTimeInput(s.monitoringStartsAt));
      setMonitoringEnd(msToTimeInput(s.monitoringEndsAt));
      setMonitoringPoll(Math.max(15, Number(s.pollIntervalMinutes) || 15));
    }
  };

  useEffect(() => {
    localGridsRef.current = localGrids;
  }, [localGrids]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Live clock tick for monitoring status lights (only while deck is open)
  useEffect(() => {
    if (session == null || localStep !== 3) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session, localStep]);

  useEffect(() => () => {
    if (partyNamePersistTimer.current) clearTimeout(partyNamePersistTimer.current);
  }, []);

  // Unified Request Headers
  const getRequestHeaders = () => {
    const savedUserSession = localStorage.getItem('guild_raid_session');
    const headers = { 'Content-Type': 'application/json' };
    if (savedUserSession) {
      headers['x-user-profile'] = encodeURIComponent(savedUserSession);
    }
    return headers;
  };

  /** Optimistic local grids → Firebase. Blocks poll overwrite while in flight. */
  const persistLiveGrids = async (grids, { quiet = true } = {}) => {
    const activeSession = sessionRef.current;
    if (!activeSession || !isOfficer) return false;

    persistInFlightRef.current = true;
    setSyncStatus('saving');
    try {
      const headers = getRequestHeaders();
      const nextVersion = (activeSession.version || 1) + 1;
      const res = await fetch(`${backendUrl}/api/live-raid/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session: {
            grids,
            version: nextVersion,
          },
        }),
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        markDirty(false);
        setSyncStatus('synced');
        setSession((prev) => (prev ? { ...prev, grids, version: nextVersion } : prev));
        if (!quiet) {
          // Force-sync recovery path only
        }
        return true;
      }
      markDirty(true);
      setSyncStatus('error');
      if (!quiet) alert(data.error || 'Failed to sync live grid.');
      return false;
    } catch (err) {
      console.error(err);
      markDirty(true);
      setSyncStatus('error');
      if (!quiet) alert('Network error syncing live grid.');
      return false;
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const applyLocalGridsAndPersist = async (updater, { debounceMs = 0 } = {}) => {
    // Compute snapshot synchronously from ref BEFORE touching React state,
    // so it's available to persistLiveGrids regardless of render scheduling.
    const snapshot = typeof updater === 'function'
      ? updater(localGridsRef.current)
      : updater;
    localGridsRef.current = snapshot;
    setLocalGrids(snapshot);
    markDirty(true);
    setActivePopover(null);

    if (debounceMs > 0) {
      if (partyNamePersistTimer.current) clearTimeout(partyNamePersistTimer.current);
      partyNamePersistTimer.current = setTimeout(() => {
        persistLiveGrids(localGridsRef.current);
      }, debounceMs);
      return;
    }

    await persistLiveGrids(snapshot);
  };

  // Compute Layout spans matching RaidPartyTab
  const centerColSpanClass = useMemo(() => {
    if (rightPanelCollapsed) return 'col-span-12 xl:col-span-11';
    return 'col-span-12 xl:col-span-9';
  }, [rightPanelCollapsed]);

  // Load Setup Master lists
  const loadMasterSetupData = async () => {
    try {
      const headers = getRequestHeaders();
      const initRes = await fetch(`${backendUrl}/api/requests/init`, { method: 'GET', headers, credentials: 'include' });
      const initData = await initRes.json();
      if (initData.success) {
        setMembers(initData.members || {});
        setCommitments(initData.commitments || {});
      }

      const settingsRes = await fetch(`${backendUrl}/api/requests/settings/get`, { method: 'GET', headers, credentials: 'include' });
      const settingsData = await settingsRes.json();
      if (settingsData.success && settingsData.config) {
        setJobsCatalog(settingsData.config.jobs || {});
        setEventsCatalog(settingsData.config.events || {});
        setWarRoomsCatalog(settingsData.config.warRooms || {});
        setMaxWarRoomsLimit(settingsData.config.liveRaidMaxWarRooms || 2);
        if (settingsData.config.timezone) setGuildTimezone(settingsData.config.timezone);
      }

      const compsRes = await fetch(`${backendUrl}/api/attendance/compositions`, { method: 'GET', headers, credentials: 'include' });
      const compsData = await compsRes.json();
      if (compsData.success) {
        setCompositions(normalizeCompositionsMap(compsData.compositions || {}));
      }

      const histRes = await apiFetch('/api/live-raid/history/all', { method: 'GET' });
      const histData = await histRes.json();
      if (histData.success) {
        setHistorySessions(histData.sessions || {});
      }

      await loadPublishedCompositions();
    } catch (err) {
      console.error("Error loading master setup lists:", err);
    }
  };

  const loadPublishedCompositions = async () => {
    try {
      const res = await apiFetch('/api/attendance/published', { method: 'GET' });
      const data = await res.json();
      if (data.success) {
        const incoming = data.published || {};
        setPublishedCompositions((prev) => {
          const next = { ...incoming };
          Object.entries(prev).forEach(([id, rec]) => {
            const incomingTs = Number(incoming[id]?.lastUpdated || incoming[id]?.sentAt || 0);
            const localTs = Number(rec?.lastUpdated || rec?.sentAt || 0);
            if (localTs > incomingTs) next[id] = rec;
          });
          return next;
        });
        setPublishedAnchor(data.anchor || null);
      }
    } catch (err) {
      console.error('Failed to load published compositions:', err);
    }
  };

  const loadCommitments = async () => {
    try {
      const res = await apiFetch('/api/attendance/commitments', { method: 'GET' });
      const data = await res.json();
      if (data.success) setCommitments(data.commitments || {});
    } catch (err) {
      console.error('Failed to load commitments:', err);
    }
  };

  // Poll Active Live Session lifecycle
  const fetchActiveLiveSession = async (isInitial = false) => {
    try {
      const headers = getRequestHeaders();
      const res = await fetch(`${backendUrl}/api/live-raid/session`, { 
        method: 'GET', 
        headers, 
        credentials: 'include' 
      });
      const data = await res.json();
      if (data.success && data.session) {
        setSession(data.session);
        if (isInitial) {
          setLocalStep(3); // only snap to Step 3 on first load, not on every poll
          hydrateSetupFromSession(data.session);
        }
        if (Array.isArray(data.session.lastVoicePoll?.presentUids)) {
          setLiveVoiceUids(data.session.lastVoicePoll.presentUids);
        }
        // Sync local grids from server only when no local edit / write is in flight
        if (isInitial || (!isDirtyRef.current && !persistInFlightRef.current)) {
          setLocalGrids(data.session.grids || {});
          localGridsRef.current = data.session.grids || {};
          if (data.session.selectedConfigIds?.length > 0 && !activeTabConfigId) {
            setActiveTabConfigId(data.session.selectedConfigIds[0]);
          }
        }
      } else {
        setSession(null);
        setLocalGrids({});
      }
    } catch (err) {
      console.error("Failed to sync live session status:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  // Fetch real-time Voice Presence from backend
  const fetchVoicePresenceList = async (activeSession = session) => {
    const warRoomRefs = activeSession?.selectedWarRoomIds?.length
      ? activeSession.selectedWarRoomIds
      : activeSession?.selectedWarRooms;
    if (!activeSession || !warRoomRefs?.length) return;
    try {
      const headers = getRequestHeaders();
      const channelsParam = warRoomRefs.join(',');
      const res = await fetch(`${backendUrl}/api/live-raid/voice-presence?channels=${encodeURIComponent(channelsParam)}`, {
        method: 'GET',
        headers,
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.presentUids) {
        setLiveVoiceUids(data.presentUids);
      }
    } catch (err) {
      console.error("Voice presence fetching error:", err);
    }
  };

  // Lifecycle Initialization
  useEffect(() => {
    loadMasterSetupData();
    fetchActiveLiveSession(true);
  }, [user]);

  // Periodic Polling synchronization (Real-time collaboration)
  useEffect(() => {
    if (!session) return undefined;

    const liveSessionPoller = setInterval(() => {
      fetchActiveLiveSession(false);
    }, 4000);

    const voicePoller = setInterval(() => {
      fetchVoicePresenceList(session);
    }, 10000);

    fetchVoicePresenceList(session);

    return () => {
      clearInterval(liveSessionPoller);
      clearInterval(voicePoller);
    };
  }, [session?.selectedWarRoomIds, session?.selectedWarRooms]);

  useEffect(() => {
    if (session !== null) return undefined;
    loadPublishedCompositions();
    loadCommitments();
    const id = setInterval(() => {
      loadPublishedCompositions();
      loadCommitments();
    }, 5000);
    return () => clearInterval(id);
  }, [session]);

  const publishedList = useMemo(() => {
    return Object.entries(publishedCompositions)
      .map(([id, rec]) => ({ id, ...rec }))
      .sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
  }, [publishedCompositions]);

  const attachedRaidConfigs = useMemo(() => {
    const published = publishedCompositions[selectedPublishedId];
    if (!published) return [];
    const grids = published.grids || {};
    const byId = new Map();
    Object.entries(grids).forEach(([gridKey, grid]) => {
      const sep = String(gridKey).indexOf('__');
      const configId = sep > 0
        ? gridKey.slice(0, sep)
        : (grid?.parentConfigId || published.configId || '');
      if (!configId) return;
      if (!byId.has(configId)) {
        byId.set(configId, {
          id: configId,
          title: grid?.parentConfigTitle || compositions[configId]?.title || published.configTitle || configId,
          tabCount: 0,
        });
      }
      byId.get(configId).tabCount += 1;
    });
    if (byId.size === 0 && published.configId) {
      byId.set(published.configId, {
        id: published.configId,
        title: published.configTitle || compositions[published.configId]?.title || published.configId,
        tabCount: 0,
      });
    }
    return [...byId.values()];
  }, [publishedCompositions, selectedPublishedId, compositions]);

  const attachedRaidConfigIds = useMemo(
    () => new Set(attachedRaidConfigs.map((cfg) => cfg.id)),
    [attachedRaidConfigs]
  );

  const formatSentAt = (ms) => {
    if (!Number.isFinite(Number(ms))) return '';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: guildTimezone || DEFAULT_TZ,
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(ms));
    } catch {
      return '';
    }
  };

  useEffect(() => {
    if (session) return;
    if (selectedPublishedId && publishedCompositions[selectedPublishedId]) return;
    const prefer = publishedAnchor && publishedCompositions[publishedAnchor]
      ? publishedAnchor
      : Object.keys(publishedCompositions)[0];
    if (!prefer) return;
    setSelectedPublishedId(prefer);
    const pub = publishedCompositions[prefer];
    if (pub?.eventKey) setSelectedEventKey(pub.eventKey);
    if (pub?.eventDate) setSelectedEventDate(pub.eventDate);
  }, [publishedCompositions, publishedAnchor, session, selectedPublishedId]);

  // -------------------------------------------------------------
  // Step 3 layout allocation compiler & sidebar unified filter logic
  // -------------------------------------------------------------
  const activeConfigAllocations = useMemo(() => {
    if (!activeTabConfigId || !localGrids[activeTabConfigId]) return {};
    return localGrids[activeTabConfigId].slots_allocation || {};
  }, [activeTabConfigId, localGrids]);

  // Compute conflicts (RED highlight indicators): tracks userIds present in 2+ active grid layouts
  const allocatedConflictsSet = useMemo(() => {
    const counts = {};
    Object.values(localGrids).forEach(grid => {
      if (grid.slots_allocation) {
        Object.entries(grid.slots_allocation).forEach(([coord, slot]) => {
          if (!coord.startsWith("meta_") && !coord.startsWith("party_name_") && slot?.userId) {
            counts[slot.userId] = (counts[slot.userId] || 0) + 1;
          }
        });
      }
    });

    const conflicts = new Set();
    Object.entries(counts).forEach(([uid, count]) => {
      if (count > 1) conflicts.add(uid);
    });
    return conflicts;
  }, [localGrids]);

  // Unified roster lists (hides player cards if placed in ANY selected configuration grids)
  const categorizedRosterPools = useMemo(() => {
    const standby = [];
    const uncommitted = [];
    const leave = [];

    // Map user placements across ALL grids in this session
    const globallyPlacedUids = new Set();
    Object.values(localGrids).forEach(grid => {
      if (grid.slots_allocation) {
        Object.entries(grid.slots_allocation).forEach(([coord, slot]) => {
          if (!coord.startsWith("meta_") && !coord.startsWith("party_name_") && slot?.userId) {
            globallyPlacedUids.add(slot.userId);
          }
        });
      }
    });

    const targetRawDate = session?.eventDate || selectedEventDate;
    const targetEventKey = session?.eventKey || selectedEventKey;

    // Direct template mapping matching the standard database key signature format
    const compositeKey = `${targetRawDate}_${targetEventKey}`;

    const dateSignaturesMap = {};
    if (commitments[compositeKey]) {
      Object.entries(commitments[compositeKey]).forEach(([uid, payload]) => {
        dateSignaturesMap[uid] = payload.status;
      });
    }

    Object.entries(members).forEach(([uid, profile]) => {
      if (profile.isRaidRoster !== true) return;

      const nameMatch = profile.displayName || 'Unknown';
      if (searchQuery.trim() && !nameMatch.toLowerCase().includes(searchQuery.toLowerCase())) {
        return;
      }

      // Hide card if placed globally (except when matching filter query to search grid location highlight)
      if (globallyPlacedUids.has(uid) && !searchQuery.trim()) {
        return;
      }

      const calendarStatus = dateSignaturesMap[uid];
      const enrichedRow = {
        uid,
        displayName: profile.displayName || 'Raid Member',
        jobCode: profile.jobCode || '',
        assignedLocation: globallyPlacedUids.has(uid) ? 'Already Slotted' : '',
        attendanceStatus: calendarStatus || 'None'
      };

      if (calendarStatus === 'Leave') {
        if (!globallyPlacedUids.has(uid)) leave.push(enrichedRow);
      } else if (calendarStatus === 'Confirmed' || calendarStatus === 'Confirm') {
        if (!globallyPlacedUids.has(uid)) standby.push(enrichedRow);
      } else {
        if (!globallyPlacedUids.has(uid)) uncommitted.push(enrichedRow);
      }
    });

    const alphaSort = (a, b) => a.displayName.localeCompare(b.displayName);
    return {
      standby: standby.sort(alphaSort),
      uncommitted: uncommitted.sort(alphaSort),
      leave: leave.sort(alphaSort)
    };
  }, [members, commitments, selectedEventDate, selectedEventKey, session, localGrids, searchQuery]);

  // -------------------------------------------------------------
  // administrative session handlers
  // -------------------------------------------------------------
  const handleSelectPublished = (id) => {
    if (session) return;
    const next = selectedPublishedId === id ? '' : id;
    setSelectedPublishedId(next);
    const pub = next ? publishedCompositions[next] : null;
    setSelectedEventKey(pub?.eventKey || '');
    setSelectedEventDate(pub?.eventDate || '');
  };

  const handleOpenPublishedCard = (id) => {
    if (session) return;
    setSelectedPublishedId(id);
    const pub = publishedCompositions[id];
    if (pub?.eventKey) setSelectedEventKey(pub.eventKey);
    if (pub?.eventDate) setSelectedEventDate(pub.eventDate);
  };

  const handleSetActiveComposition = async (id, active) => {
    if (!isOfficer) return;
    try {
      const res = await apiFetch(`/api/attendance/published/${encodeURIComponent(id)}/set-active`, {
        method: 'POST',
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to update Set Active');
      setPublishedAnchor(data.anchor || null);
    } catch (err) {
      alert(err.message || 'Failed to update Set Active');
    }
  };

  const handleRemovePublished = async (id) => {
    if (!isOfficer) return;
    if (!window.confirm('Remove this composition from Active Compositions?')) return;
    try {
      const res = await apiFetch(`/api/attendance/published/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to remove composition');
      setPublishedCompositions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (publishedAnchor === id) setPublishedAnchor(null);
      if (selectedPublishedId === id) {
        setSelectedPublishedId('');
        setSelectedEventKey('');
        setSelectedEventDate('');
        setShowAddConfig(false);
      }
    } catch (err) {
      alert(err.message || 'Failed to remove composition');
    }
  };

  const handlePublishedChange = (nextPublished) => {
    if (!nextPublished?.id) return;
    setPublishedCompositions((prev) => ({ ...prev, [nextPublished.id]: nextPublished }));
  };

  const handleAddRaidConfig = async () => {
    if (!isOfficer || !selectedPublishedId || !addConfigId) {
      return alert('Select a raid config.');
    }
    setAddingConfig(true);
    try {
      const res = await apiFetch(`/api/attendance/published/${encodeURIComponent(selectedPublishedId)}/add-config`, {
        method: 'POST',
        body: JSON.stringify({ configId: addConfigId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to add raid config');
      handlePublishedChange(data.published);
      setShowAddConfig(false);
      setAddConfigId('');
    } catch (err) {
      alert(err.message || 'Failed to add raid config');
    } finally {
      setAddingConfig(false);
    }
  };

  const handleRemoveRaidConfig = async (configId, configTitle) => {
    if (!isOfficer || !selectedPublishedId || !configId) return;
    const label = configTitle || configId;
    const ok = window.confirm(
      `Remove “${label}” from this composition? Party slots on those tabs will be lost. You can add a different raid config afterward.`
    );
    if (!ok) return;
    setRemovingConfigId(configId);
    try {
      const res = await apiFetch(`/api/attendance/published/${encodeURIComponent(selectedPublishedId)}/remove-config`, {
        method: 'POST',
        body: JSON.stringify({ configId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to remove raid config');
      handlePublishedChange(data.published);
      if (addConfigId === configId) setAddConfigId('');
    } catch (err) {
      alert(err.message || 'Failed to remove raid config');
    } finally {
      setRemovingConfigId('');
    }
  };

  const handleAnnounceAttendance = async (id) => {
    if (!isOfficer || !id) return;
    setAnnouncing({ id, kind: 'attendance' });
    try {
      const res = await apiFetch(`/api/attendance/published/${encodeURIComponent(id)}/announce-attendance`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Announce failed');
      alert('Announced to GEN Room. Members confirm attendance in war-announce.');
    } catch (err) {
      alert(err.message || 'Announce failed');
    } finally {
      setAnnouncing({ id: '', kind: '' });
    }
  };

  const handleAnnounceParty = async (id) => {
    if (!isOfficer || !id) return;
    setAnnouncing({ id, kind: 'party' });
    try {
      const res = await apiFetch(`/api/attendance/published/${encodeURIComponent(id)}/announce-party`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Announce failed');
      alert('Announced to GEN Room. Members can see their party in war-announce.');
    } catch (err) {
      alert(err.message || 'Announce failed');
    } finally {
      setAnnouncing({ id: '', kind: '' });
    }
  };

  const handleToggleWarRoomSelection = (roomId) => {
    setSelectedWarRooms(prev => {
      if (prev.includes(roomId)) {
        return prev.filter(r => r !== roomId);
      }
      if (prev.length >= maxWarRoomsLimit) {
        alert(`Maximum selectable War Rooms reached: ${maxWarRoomsLimit}`);
        return prev;
      }
      return [...prev, roomId];
    });
  };

  // Helper: apply monitoring schedule to the current live session
  const applyMonitoringSchedule = async (headers) => {
    const startTime = normalizeTimeValue(
      monitoringStartInputRef.current?.value
      || monitoringStartTimeRef.current
      || monitoringStartTime
    );
    const endTime = normalizeTimeValue(
      monitoringEndInputRef.current?.value
      || monitoringEndTimeRef.current
      || monitoringEndTime
    );
    const pollMins = Math.max(15, monitoringPollIntervalRef.current || monitoringPollInterval || 15);
    if (!startTime || !endTime) return null;
    const monitoringStartsAt = timeStringToTodayMs(startTime);
    const monitoringEndsAt = timeStringToTodayMs(endTime);
    if (monitoringEndsAt <= monitoringStartsAt) {
      throw new Error('End time must be after start time.');
    }
    const mRes = await fetch(`${backendUrl}/api/live-raid/set-monitoring-time`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ monitoringStartsAt, monitoringEndsAt, pollIntervalMinutes: pollMins }),
      credentials: 'include'
    });
    const mData = await mRes.json();
    if (!mData.success) throw new Error(mData.error || 'Failed to set monitoring schedule.');
    return {
      monitoringStartsAt: mData.monitoringStartsAt ?? monitoringStartsAt,
      monitoringEndsAt: mData.monitoringEndsAt ?? monitoringEndsAt,
      pollIntervalMinutes: mData.pollIntervalMinutes ?? pollMins,
    };
  };

  const buildMonitoringCreatePayload = () => {
    const startTime = normalizeTimeValue(
      monitoringStartInputRef.current?.value
      || monitoringStartTimeRef.current
      || monitoringStartTime
    );
    const endTime = normalizeTimeValue(
      monitoringEndInputRef.current?.value
      || monitoringEndTimeRef.current
      || monitoringEndTime
    );
    const pollMins = Math.max(15, monitoringPollIntervalRef.current || monitoringPollInterval || 15);
    if (!startTime || !endTime) return {};
    const monitoringStartsAt = timeStringToTodayMs(startTime);
    const monitoringEndsAt = timeStringToTodayMs(endTime);
    if (monitoringEndsAt <= monitoringStartsAt) return { error: 'End time must be after start time.' };
    return {
      monitoringStartsAt,
      monitoringEndsAt,
      pollIntervalMinutes: pollMins,
    };
  };

  const handleLaunchLiveSession = async () => {
    if (session === null && (!selectedPublishedId || !publishedCompositions[selectedPublishedId])) {
      return alert('Select an Active Composition.');
    }
    if (selectedWarRooms.length === 0) {
      return alert("Select at least one Discord War Room.");
    }

    const startTime = normalizeTimeValue(
      monitoringStartInputRef.current?.value
      || monitoringStartTimeRef.current
      || monitoringStartTime
    );
    const endTime = normalizeTimeValue(
      monitoringEndInputRef.current?.value
      || monitoringEndTimeRef.current
      || monitoringEndTime
    );

    if (startTime && !endTime) {
      return alert("Please set an End Time for the monitoring schedule.");
    }
    if (!startTime && endTime) {
      return alert("Please set a Start Time for the monitoring schedule.");
    }

    const headers = getRequestHeaders();
    const monitoringPayload = buildMonitoringCreatePayload();
    if (monitoringPayload.error) return alert(monitoringPayload.error);

    // ── EDIT MODE: session already running — monitoring only ──────────────────
    if (session !== null) {
      try {
        if (!startTime || !endTime) {
          return alert('Set both Start Time and End Time before applying monitoring.\n\nUse 24h format, e.g. 20:00 and 22:00.');
        }
        const monUpdate = await applyMonitoringSchedule(headers);
        if (monUpdate) {
          const next = { ...(sessionRef.current || session), ...monUpdate };
          setSession(next);
          hydrateSetupFromSession(next);
          alert(
            `Monitoring saved:\n` +
            `attendance/live_session\n\n` +
            `monitoringStartsAt: ${monUpdate.monitoringStartsAt}\n` +
            `monitoringEndsAt: ${monUpdate.monitoringEndsAt}\n` +
            `pollIntervalMinutes: ${monUpdate.pollIntervalMinutes}`
          );
        }
        setLocalStep(3);
      } catch (err) {
        alert(err.message || 'Failed to update monitoring schedule.');
      }
      return;
    }

    // ── CREATE — grids come from the published Active Composition ────────────
    try {
      const res = await fetch(`${backendUrl}/api/live-raid/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          publishedId: selectedPublishedId,
          selectedWarRooms,
          ...monitoringPayload,
        }),
        credentials: 'include'
      });
      const data = await res.json();
      if (!data.success) return alert(data.error || "Failed to create Live Session.");

      const sessionPayload = data.session;
      setSession(sessionPayload);
      setLocalGrids(sessionPayload.grids || {});
      localGridsRef.current = sessionPayload.grids || {};
      if (sessionPayload.selectedConfigIds?.length > 0) {
        setActiveTabConfigId(sessionPayload.selectedConfigIds[0]);
      }
      hydrateSetupFromSession(sessionPayload);
      markDirty(false);
      setSyncStatus('synced');
      setLocalStep(3);
    } catch (err) {
      console.error(err);
      alert("Network transmission failure launching raid.");
    }
  };

  const handleCommitLiveGridsChanges = async () => {
    if (!session || !isOfficer) return;
    const ok = await persistLiveGrids(localGridsRef.current, { quiet: false });
    if (ok) {
      alert('Live grid force-synced.');
    }
  };

  // Monitoring SSOT: HH:MM is interpreted in the SAME timezone as the server-time clock (DEFAULT_TZ)
  const timeStringToTodayMs = (timeStr) => {
    return guildWallTimeToUtcMs(timeStr, guildTimezone || DEFAULT_TZ);
  };


 const handleCancelLiveRaid = async () => {
    if (!session || !isOfficer) return;
    if (!window.confirm("⚠️ CRITICAL WARNING:\nWiping this live operation will permanently drop all tracking check-ins without saving an archive entry log.\n\nAre you sure you want to completely exit?")) return;
    
    try {
      const headers = getRequestHeaders();
      const res = await fetch(`${backendUrl}/api/live-raid/cancel`, { method: 'POST', headers, credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setSession(null);
        setLocalGrids({});
        localGridsRef.current = {};
        markDirty(false);
        setSyncStatus('synced');
        setLocalStep(1);
      } else {
        alert(data.error || "Failed to terminate operation cache.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBackToSetup = () => {
    hydrateSetupFromSession(sessionRef.current || session);
    setLocalStep(2);
  };

  const handleEndLiveRaid = async () => {
    if (!session || !isOfficer) return;
    if (!window.confirm("ARE YOU ABSOLUTELY CERTAIN YOU WANT TO END THE RAID SESSION?\nThis action will stop background polling, save attendance metrics, and wipe active session datasets.")) {
      return;
    }
    if (!window.confirm("DOUBLE CONFIRMATION:\nSave entries to history logs and clear the execution deck?")) {
      return;
    }

    try {
      const headers = getRequestHeaders();
      const res = await fetch(`${backendUrl}/api/live-raid/end`, {
        method: 'POST',
        headers,
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        alert("Raid finalized and archived to history ledger.");
        setSession(null);
        setLocalGrids({});
        localGridsRef.current = {};
        markDirty(false);
        setSyncStatus('synced');
        setLocalStep(1);
      } else {
        alert(data.error || "Failed to terminate raid session.");
      }
    } catch (err) {
      console.error(err);
      alert("Network error ending raid.");
    }
  };

  // -------------------------------------------------------------
  // Grid manipulation handlers inside execution tab
  // -------------------------------------------------------------
  const handleUpdatePartyName = (colIdx, value) => {
    if (!activeTabConfigId || !localGrids[activeTabConfigId]) return;
    applyLocalGridsAndPersist((prev) => {
      const updated = { ...prev };
      const configObj = { ...updated[activeTabConfigId] };
      const slotAlloc = { ...configObj.slots_allocation };
      slotAlloc[`party_name_${colIdx}`] = value;
      configObj.slots_allocation = slotAlloc;
      updated[activeTabConfigId] = configObj;
      return updated;
    }, { debounceMs: 400 });
  };

  const handleBindMemberToCell = async (coordKey, uid) => {
    if (!activeTabConfigId || !localGrids[activeTabConfigId]) return;
    
    // Cross-tab exclusivity: clear uid from every grid, then place on active tab
    setLocalGrids(prev => {
      const updated = {};
      Object.entries(prev).forEach(([gridId, gridObj]) => {
        const slotAlloc = { ...(gridObj.slots_allocation || {}) };
        if (uid) {
          Object.keys(slotAlloc).forEach((k) => {
            if (isSlotCoordKey(k) && slotAlloc[k]?.userId === uid) {
              slotAlloc[k] = { ...slotAlloc[k], userId: '' };
            }
          });
        }
        if (gridId === activeTabConfigId) {
          slotAlloc[coordKey] = { ...slotAlloc[coordKey], userId: uid || '' };
        }
        updated[gridId] = { ...gridObj, slots_allocation: slotAlloc };
      });
      localGridsRef.current = updated;
      return updated;
    });
    setActivePopover(null);

    try {
      setSyncStatus('saving');
      persistInFlightRef.current = true;
      const res = await fetch(`${backendUrl}/api/live-raid/cell-update`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ configId: activeTabConfigId, coordKey, userId: uid }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        markDirty(false);
        setSyncStatus('synced');
      } else {
        markDirty(true);
        setSyncStatus('error');
      }
    } catch (err) {
      console.error("Granular database write exception caught:", err);
      markDirty(true);
      setSyncStatus('error');
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const mutateActiveGridSlots = async (mapper) => {
    if (!isOfficer || !activeTabConfigId || !localGrids[activeTabConfigId]) return;
    await applyLocalGridsAndPersist((prev) => {
      const gridObj = prev[activeTabConfigId];
      if (!gridObj) return prev;
      const slotAlloc = { ...(gridObj.slots_allocation || {}) };
      Object.keys(slotAlloc).forEach((k) => {
        if (!isSlotCoordKey(k) || !slotAlloc[k]) return;
        slotAlloc[k] = mapper(slotAlloc[k]);
      });
      return {
        ...prev,
        [activeTabConfigId]: { ...gridObj, slots_allocation: slotAlloc },
      };
    });
  };

  const handleClearGridMembers = async () => {
    if (!window.confirm('Clear all member assignments on this Grid Tab? Role locks stay.')) return;
    await mutateActiveGridSlots((slot) => ({ ...slot, userId: '' }));
  };

  const handleClearGridJobLocks = async () => {
    if (!window.confirm('Clear all job class role locks on this Grid Tab? Members stay assigned.')) return;
    await mutateActiveGridSlots((slot) => ({ ...slot, roleLock: '' }));
  };

  const handleClearGridAll = async () => {
    if (!window.confirm('Clear ALL members and job locks on this Grid Tab?')) return;
    await mutateActiveGridSlots(() => ({ userId: '', roleLock: '' }));
  };

  const handleSetCellRoleLock = async (coordKey, roleLock) => {
    if (!activeTabConfigId) return;
    await applyLocalGridsAndPersist((prev) => {
      const configObj = { ...prev[activeTabConfigId] };
      if (!configObj) return prev;
      const slotAlloc = { ...configObj.slots_allocation };
      slotAlloc[coordKey] = { ...slotAlloc[coordKey], roleLock: roleLock || '' };
      configObj.slots_allocation = slotAlloc;
      return { ...prev, [activeTabConfigId]: configObj };
    });
  };

  const handleSetPartyLeader = async (coordKey) => {
    if (!activeTabConfigId) return;
    await applyLocalGridsAndPersist((prev) => {
      const configObj = { ...prev[activeTabConfigId] };
      if (!configObj) return prev;
      const slotAlloc = { ...configObj.slots_allocation };
      const isAlready = slotAlloc[coordKey]?.isPartyLeader === true;
      slotAlloc[coordKey] = { ...slotAlloc[coordKey], isPartyLeader: !isAlready };
      configObj.slots_allocation = slotAlloc;
      return { ...prev, [activeTabConfigId]: configObj };
    });
  };

  const handleSetRaidLeader = async (coordKey) => {
    if (!activeTabConfigId) return;
    await applyLocalGridsAndPersist((prev) => {
      const configObj = { ...prev[activeTabConfigId] };
      if (!configObj) return prev;
      const slotAlloc = { ...configObj.slots_allocation };
      const isAlready = slotAlloc[coordKey]?.isRaidLeader === true;
      Object.keys(slotAlloc).forEach((k) => {
        if (slotAlloc[k]?.isRaidLeader) {
          slotAlloc[k] = { ...slotAlloc[k], isRaidLeader: false };
        }
      });
      if (!isAlready) {
        slotAlloc[coordKey] = { ...slotAlloc[coordKey], isRaidLeader: true };
      }
      configObj.slots_allocation = slotAlloc;
      return { ...prev, [activeTabConfigId]: configObj };
    });
  };

  // HTML5 Drag-Drop hooks
  const handleCellDragStart = (e, coordKey, userId) => {
    if (!isOfficer || !userId) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ source: 'cell', coordKey, userId }));
  };

  const handleCellDropIntercept = async (e, destCoordKey) => {
    e.preventDefault();
    if (!isOfficer || !activeTabConfigId || !localGrids[activeTabConfigId]) return;
    try {
      const rawData = e.dataTransfer.getData("text/plain");
      if (!rawData) return;

      if (rawData.trim().startsWith('{')) {
        const parsed = JSON.parse(rawData);
        if (parsed.source === 'cell') {
          const srcCoord = parsed.coordKey;
          const srcUid = parsed.userId;

          await applyLocalGridsAndPersist((prev) => {
            const updated = { ...prev };
            const configObj = { ...updated[activeTabConfigId] };
            const slotAlloc = { ...configObj.slots_allocation };
            const destUid = slotAlloc[destCoordKey]?.userId || '';
            slotAlloc[srcCoord] = { ...slotAlloc[srcCoord], userId: destUid };
            slotAlloc[destCoordKey] = { ...slotAlloc[destCoordKey], userId: srcUid };
            configObj.slots_allocation = slotAlloc;
            updated[activeTabConfigId] = configObj;
            return updated;
          });
        }
      } else {
        await handleBindMemberToCell(destCoordKey, rawData);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleFeederPoolDropIntercept = (e) => {
    e.preventDefault();
    setDragHoveredCoord(null);
    if (!isOfficer) return;
    try {
      const rawData = e.dataTransfer.getData("text/plain");
      if (rawData && rawData.trim().startsWith('{')) {
        const parsed = JSON.parse(rawData);
        if (parsed.source === 'cell') {
          handleBindMemberToCell(parsed.coordKey, '');
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Render Core Wizards
  return (
    <div className="space-y-4 max-w-[98vw] mx-auto p-1 font-sans text-slate-200 overflow-visible relative">
      
      {/* -------------------- STEP 1: ACTIVE COMPOSITIONS + START -------------------- */}
      {session === null && localStep === 1 && (
        <div className={`mx-auto space-y-6 py-6 px-2 select-none ${selectedPublishedId ? 'max-w-[98vw]' : 'max-w-5xl'}`}>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="text-xl font-black tracking-wide text-slate-100 uppercase">Live Raid Operations</h1>
              <p className="text-xs text-slate-400 font-sans mt-1.5 leading-relaxed max-w-xl">
                Raids sent from Raid Compose land here. Select a card to add a raid config and slot the party, then start monitoring.
              </p>
            </div>
            {isOfficer ? (
              <button
                type="button"
                onClick={() => setLocalStep(2)}
                disabled={publishedList.length === 0}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider py-3 px-6 rounded-2xl transition-all duration-150 shadow-xl shadow-indigo-600/10 cursor-pointer shrink-0"
              >
                Start Live Raid
              </button>
            ) : (
              <div className="text-[10px] text-rose-400 font-mono bg-rose-950/20 border border-rose-900/30 px-3 py-2 rounded-xl">
                Officers start the monitoring deck.
              </div>
            )}
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">Active Compositions</h2>
              <span className="text-[10px] font-mono text-slate-600">{publishedList.length}</span>
            </div>

            {publishedList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 px-6 py-10 text-center">
                <p className="text-xs text-slate-400">No raids have been sent yet.</p>
                <p className="text-[10px] text-slate-600 mt-1">Officers send a raid from Raid Compose to publish it here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {publishedList.map((comp) => {
                  const isAnchor = publishedAnchor === comp.id;
                  const isSelected = selectedPublishedId === comp.id;
                  const tabCount = (comp.selectedGridIds || Object.keys(comp.grids || {})).length;
                  const compositeKey = `${comp.eventDate}_${comp.eventKey}`;
                  const signedUsers = commitments[compositeKey] ? Object.values(commitments[compositeKey]) : [];
                  const presentCount = signedUsers.filter((u) => u.status === 'Confirmed' || u.status === 'Confirm').length;
                  const leaveCount = signedUsers.filter((u) => u.status === 'Leave').length;
                  return (
                    <div
                      key={comp.id}
                      onClick={() => handleOpenPublishedCard(comp.id)}
                      className={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600/10 border-indigo-500/70'
                          : isAnchor
                            ? 'bg-slate-900/40 border-indigo-500/40'
                            : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-100 truncate">
                              {comp.eventTitle || comp.eventKey || 'Raid'}
                            </span>
                            {isAnchor && (
                              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 rounded-md">
                                Active
                              </span>
                            )}
                            {isSelected && (
                              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-300 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded-md">
                                Selected
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono text-slate-400 mt-1">
                            {comp.eventDate || '—'}
                            {comp.timeStart ? ` ${comp.timeStart}` : ''}
                            {' · '}
                            {comp.configTitle || 'No raid config'}
                          </p>
                          <p className="text-[10px] font-mono text-slate-600 mt-1">
                            {tabCount} tab{tabCount === 1 ? '' : 's'}
                            {comp.sentAt ? ` · sent ${formatSentAt(comp.sentAt)}` : ''}
                            {comp.sentBy ? ` · ${comp.sentBy}` : ''}
                          </p>
                        </div>
                        <div
                          className="flex items-center gap-1 shrink-0 font-mono text-[10px] select-none"
                          title="Confirmed / Leave"
                        >
                          <Users size={12} className="text-slate-400" />
                          <span className="text-emerald-400 font-bold">{presentCount}</span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-400 font-bold">{leaveCount}</span>
                        </div>
                      </div>
                      {isOfficer && (
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleAnnounceAttendance(comp.id); }}
                            disabled={announcing.id === comp.id && announcing.kind === 'attendance'}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-700 bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:text-white cursor-pointer disabled:opacity-50"
                          >
                            <Megaphone size={12} />
                            {announcing.id === comp.id && announcing.kind === 'attendance' ? 'Announcing…' : 'Attendance'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleAnnounceParty(comp.id); }}
                            disabled={
                              (announcing.id === comp.id && announcing.kind === 'party')
                              || tabCount === 0
                            }
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-slate-700 bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Megaphone size={12} />
                            {announcing.id === comp.id && announcing.kind === 'party' ? 'Announcing…' : 'Party'}
                          </button>
                        </div>
                      )}
                      {isOfficer && (
                        <div className="flex items-center gap-2 mt-2 pt-3 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSetActiveComposition(comp.id, !isAnchor); }}
                            className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-2 rounded-xl border transition cursor-pointer ${
                              isAnchor
                                ? 'border-indigo-500/50 text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20'
                                : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                            }`}
                          >
                            {isAnchor ? 'Unset Active' : 'Set Active'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRemovePublished(comp.id); }}
                            className="p-2 rounded-xl border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-900/50 transition cursor-pointer"
                            title="Remove from Active Compositions"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {selectedPublishedId && publishedCompositions[selectedPublishedId] && (
            <section className="space-y-4 border-t border-slate-800 pt-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">Party setup</h2>
                  <p className="text-sm font-bold text-slate-100 mt-1">
                    {publishedCompositions[selectedPublishedId].eventTitle || 'Raid'}
                    {publishedCompositions[selectedPublishedId].eventDate ? ` · ${publishedCompositions[selectedPublishedId].eventDate}` : ''}
                    {publishedCompositions[selectedPublishedId].timeStart ? ` ${publishedCompositions[selectedPublishedId].timeStart}` : ''}
                  </p>
                </div>
                {isOfficer && (
                  <div className="flex flex-wrap items-center gap-2">
                    {attachedRaidConfigs.map((cfg) => (
                      <span
                        key={cfg.id}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-xl border border-slate-700 bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-200"
                      >
                        <span className="max-w-[12rem] truncate" title={cfg.title}>{cfg.title}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveRaidConfig(cfg.id, cfg.title)}
                          disabled={Boolean(removingConfigId)}
                          className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Remove raid config"
                          aria-label={`Remove ${cfg.title}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowAddConfig((open) => !open)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:text-white cursor-pointer"
                    >
                      <Plus size={13} /> Add Raid config
                    </button>
                  </div>
                )}
              </div>

              {showAddConfig && isOfficer && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Select raid config</p>
                  {Object.keys(compositions).length === 0 ? (
                    <p className="text-[11px] text-slate-500">No raid configs yet. Create one on Raid Party, then come back here.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      {Object.entries(compositions).map(([id, comp]) => {
                        const optionId = comp.id || id;
                        const alreadyAdded = attachedRaidConfigIds.has(optionId);
                        return (
                          <button
                            key={id}
                            type="button"
                            disabled={alreadyAdded}
                            onClick={() => setAddConfigId(optionId)}
                            className={`p-3 rounded-xl border text-left text-xs ${alreadyAdded ? 'border-slate-900 text-slate-600 cursor-not-allowed' : addConfigId === optionId ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400 cursor-pointer' : 'border-slate-800 text-slate-400 hover:border-slate-700 cursor-pointer'}`}
                          >
                            <div className="font-bold uppercase tracking-wider">{comp.title || id}</div>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {alreadyAdded
                                ? 'Already on this composition'
                                : `${(comp.tabOrder || Object.keys(comp.tabs || {})).length} grid tab(s)`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setShowAddConfig(false); setAddConfigId(''); }} className="px-4 py-2 rounded-xl border border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 cursor-pointer">
                      Cancel
                    </button>
                    <button type="button" disabled={addingConfig || !addConfigId} onClick={handleAddRaidConfig} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50">
                      {addingConfig ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              <PublishedPartyGrid
                published={{ id: selectedPublishedId, ...publishedCompositions[selectedPublishedId] }}
                members={members}
                jobsCatalog={jobsCatalog}
                commitments={commitments}
                isOfficer={isOfficer}
                onPublishedChange={handlePublishedChange}
              />
            </section>
          )}
        </div>
      )}

      {/* -------------------- STEP 2: SELECT SETTINGS FORM -------------------- */}
      {localStep === 2 && (
        <div className="mx-auto max-w-3xl bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 select-none">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setLocalStep(session ? 3 : 1)}
                className="p-2 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                <ArrowLeft size={14} />
              </button>
              <div>
                <h2 className="text-sm font-black uppercase text-slate-100 tracking-wider">
                  {session ? 'Monitoring Setup' : 'Start Live Raid'}
                </h2>
                <p className="text-[10px] text-slate-500 font-sans">
                  {session ? 'Adjust war rooms and the monitoring window.' : 'Pick an Active Composition, then war rooms and monitoring.'}
                </p>
              </div>
            </div>
            <button 
              onClick={() => setLocalStep(session ? 3 : 1)} 
              className="text-slate-500 hover:text-slate-350 p-1 transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-5">
            {session ? (
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Composition</p>
                <p className="text-xs font-bold text-slate-200 mt-1">
                  {session.eventTitle || session.eventKey || 'Raid'}
                  {session.eventDate ? ` · ${session.eventDate}` : ''}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono block">
                  1. Choose Active Composition
                </label>
                {publishedList.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Send a composition from Raid Compose first.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto scrollbar-thin pr-1">
                    {publishedList.map((comp) => {
                      const isChecked = selectedPublishedId === comp.id;
                      const tabCount = (comp.selectedGridIds || Object.keys(comp.grids || {})).length;
                      return (
                        <div
                          key={comp.id}
                          onClick={() => handleSelectPublished(comp.id)}
                          className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer select-none transition-all ${
                            isChecked
                              ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400 shadow-md'
                              : 'bg-slate-950/40 border-slate-800 hover:border-slate-750 text-slate-300'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-500' : 'border-slate-700 bg-slate-950'}`}>
                            {isChecked && <Check size={11} className="text-white" />}
                          </div>
                          <div className="min-w-0">
                            <span className="text-[11px] font-bold font-sans truncate block">
                              {comp.eventTitle || comp.eventKey || 'Raid'}
                            </span>
                            <span className="text-[8px] font-mono text-slate-500">
                              {comp.eventDate || '—'} · {comp.configTitle || 'config'} · {tabCount} tab{tabCount === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Select War Rooms */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono block">
                {session ? '1' : '2'}. Select Discord War Rooms (Select up to {maxWarRoomsLimit})
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(warRoomsCatalog).map(([roomId, roomObj]) => {
                  const isChecked = selectedWarRooms.includes(roomId);
                  return (
                    <div 
                      key={roomId}
                      onClick={() => handleToggleWarRoomSelection(roomId)}
                      className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer select-none transition-all ${
                        isChecked 
                          ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400 shadow-md' 
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-750 text-slate-300'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'bg-indigo-600 border-indigo-500' : 'border-slate-700 bg-slate-950'}`}>
                        {isChecked && <Check size={11} className="text-white" />}
                      </div>
                      <div className="truncate">
                        <span className="text-[11px] font-bold font-sans block truncate">{roomObj.name || 'Unnamed Channel'}</span>
                        <span className="text-[8px] font-mono text-slate-500 mt-0.5 block truncate">{roomId}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5. Monitoring Schedule */}
            <div className="space-y-2 border-t border-slate-800/60 pt-5">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono block">
                  {session ? '2' : '3'}. Monitoring Schedule <span className="text-slate-600 font-medium normal-case tracking-normal">(optional)</span>
                </label>
                <p className="text-[9px] text-slate-600 font-sans mt-0.5">Voice channel presence will be polled between these times. Leave blank to set later.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Start Time */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">Start Time</span>
                  <input
                    ref={monitoringStartInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="2000 → 20:00"
                    maxLength={5}
                    value={monitoringStartTime}
                    onChange={handleMonitoringTimeChange(setMonitoringStart)}
                    onBlur={handleMonitoringTimeBlur(setMonitoringStart, monitoringStartTime)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold text-center outline-none focus:border-amber-500/50 transition"
                  />
                </div>
                {/* End Time */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">End Time</span>
                  <input
                    ref={monitoringEndInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="2200 → 22:00"
                    maxLength={5}
                    value={monitoringEndTime}
                    onChange={handleMonitoringTimeChange(setMonitoringEnd)}
                    onBlur={handleMonitoringTimeBlur(setMonitoringEnd, monitoringEndTime)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-amber-300 font-mono font-bold text-center outline-none focus:border-amber-500/50 transition"
                  />
                </div>
                {/* Poll Interval stepper */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-mono">Poll Interval</span>
                  <div className="flex items-center gap-0 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden h-[38px]">
                    <button
                      type="button"
                      onClick={() => setMonitoringPoll(Math.max(15, monitoringPollInterval - 1))}
                      className="px-3 h-full text-slate-400 hover:text-white hover:bg-slate-800 font-bold text-sm transition cursor-pointer select-none border-r border-slate-800"
                    >−</button>
                    <span className="flex-1 text-center text-xs font-mono font-bold text-amber-300 tabular-nums">
                      {monitoringPollInterval} min
                    </span>
                    <button
                      type="button"
                      onClick={() => setMonitoringPoll(Math.min(30, monitoringPollInterval + 1))}
                      className="px-3 h-full text-slate-400 hover:text-white hover:bg-slate-800 font-bold text-sm transition cursor-pointer select-none border-l border-slate-800"
                    >+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800/80 pt-4 flex justify-end gap-3 select-none">
            <button
              type="button"
              onClick={() => setLocalStep(session ? 3 : 1)}
              className="border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLaunchLiveSession}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 text-[10px] font-bold uppercase tracking-wider rounded-xl transition shadow-lg cursor-pointer"
            >
              {session !== null ? 'Apply Changes' : 'Start Live Raid Deck'}
            </button>
          </div>
        </div>
      )}

      {/* -------------------- STEP 3: STARTED DECK INTERFACE -------------------- */}
      {session !== null && localStep === 3 && (
        <div className="space-y-4 animate-fadeIn">
          {/* HEADER DECK */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-md flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 select-none">
            <div className="flex items-center gap-3.5">
              {isOfficer && (
                <button 
                  onClick={handleBackToSetup}
                  className="p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-850 text-slate-400 hover:text-slate-200 transition cursor-pointer flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider font-bold"
                  title="Return to monitoring setup"
                >
                  <ArrowLeft size={13} /> Back
                </button>
              )}
              <div>
                <div className="flex items-stretch gap-2 flex-wrap">
                  {/* Live — same chip height as Monitoring */}
                  <div className="flex items-center gap-1.5 h-[42px] px-3 rounded-xl border border-slate-700/80 bg-slate-950/80 text-slate-200">
                    <Radio size={12} className="text-emerald-400 animate-pulse shrink-0" />
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Live</span>
                  </div>

                  {/* Monitoring — neutral white/slate; start & end go green when triggered */}
                  {(() => {
                    const { monitoringStartsAt, monitoringEndsAt } = session;
                    const isScheduled = !!monitoringStartsAt && !!monitoringEndsAt;
                    const startTriggered = isScheduled && nowMs >= monitoringStartsAt;
                    const endTriggered = isScheduled && nowMs >= monitoringEndsAt;
                    // SSOT: render monitoring times in the SAME timezone as the server-time clock (DEFAULT_TZ)
                    const fmt = (ms) => formatGuildTimeHhMm(ms, guildTimezone || DEFAULT_TZ);

                    // Pulse progress: current pulses taken vs. total expected across the window
                    const pollMs = (Number(session.pollIntervalMinutes) || 0) * 60000;
                    const expectedPulses = isScheduled && pollMs > 0
                      ? Math.max(1, Math.round((monitoringEndsAt - monitoringStartsAt) / pollMs))
                      : 0;
                    const currentPulses = session.totalPulses || 0;

                    return (
                      <div className="flex items-center gap-3 h-[42px] px-3 rounded-xl border border-slate-700/80 bg-slate-950/80">
                        <div className="flex items-center gap-1.5 text-slate-200 shrink-0">
                          <Timer size={12} className="shrink-0 text-slate-300" />
                          <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Monitoring</span>
                        </div>
                        <div className="w-px h-5 bg-slate-700 shrink-0" />
                        <div className="flex items-center gap-2.5 text-[11px] font-mono font-bold tabular-nums">
                          <span
                            className={`flex items-center gap-1 transition-colors duration-500 ${
                              startTriggered ? 'text-emerald-400' : 'text-slate-200'
                            }`}
                            title={startTriggered ? 'Start reached — monitoring running' : 'Waiting for start'}
                          >
                            <Play size={10} className={`shrink-0 ${startTriggered ? 'fill-emerald-400' : ''}`} />
                            {isScheduled ? fmt(monitoringStartsAt) : '--:--'}
                          </span>
                          <span className="text-slate-600">|</span>
                          <span
                            className={`flex items-center gap-1 transition-colors duration-500 ${
                              endTriggered ? 'text-emerald-400' : 'text-slate-200'
                            }`}
                            title={endTriggered ? 'End reached — monitoring stopped' : 'Waiting for end'}
                          >
                            <Square size={10} className={`shrink-0 ${endTriggered ? 'fill-emerald-400' : ''}`} />
                            {isScheduled ? fmt(monitoringEndsAt) : '--:--'}
                          </span>
                        </div>
                        <div className="w-px h-5 bg-slate-700 shrink-0" />
                        <span
                          className={`flex items-center gap-1.5 text-[11px] font-mono font-bold tabular-nums ${
                            currentPulses > 0 ? 'text-emerald-400' : 'text-slate-400'
                          }`}
                          title={[
                            `Pulses ${currentPulses}/${expectedPulses}`,
                            `present in VC=${(session.lastVoicePoll?.presentUids || []).length}`,
                            `ticker=${session.monitoringTickerStatus || 'n/a'}`,
                            session.monitoringTickerNote || '',
                          ].filter(Boolean).join(' · ')}
                        >
                          <Radio size={11} className="shrink-0" />
                          {currentPulses}/{expectedPulses || '--'}
                          <span className="text-slate-500 font-medium uppercase text-[9px] tracking-widest">pulses</span>
                        </span>
                        <div className="w-px h-5 bg-slate-700 shrink-0" />
                        <span
                          className="flex items-center gap-1.5 text-[11px] font-mono font-bold tabular-nums text-slate-300"
                          title={`${(session.lastVoicePoll?.presentUids || []).length} member(s) present in voice channel (last poll)`}
                        >
                          <Users size={11} className="shrink-0" />
                          {(session.lastVoicePoll?.presentUids || []).length}
                          <span className="text-slate-500 font-medium uppercase text-[9px] tracking-widest">vc</span>
                        </span>
                      </div>
                    );
                  })()}

                  <div className="flex items-center gap-1.5 h-[42px] px-3 rounded-xl border border-slate-800 bg-transparent text-slate-500">
                    <RefreshCw size={12} className="shrink-0" />
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                      {session.eventTitle} ({session.eventDate})
                    </span>
                  </div>
                </div>
                <h2 className="text-md font-black text-slate-200 uppercase mt-1.5">
                  Collab Console (Officer: {session.launchedBy})
                </h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isOfficer && (
                <>
                  <button
                    type="button"
                    onClick={handleCancelLiveRaid}
                    className="flex items-center gap-1.5 border border-slate-850 bg-slate-950 text-slate-400 hover:text-rose-400 font-mono font-bold text-[10px] uppercase tracking-wider p-2 px-3 rounded-xl transition cursor-pointer"
                  >
                    <X size={12} /> Cancel & Exit
                  </button>
                  <button
                    type="button"
                    onClick={handleEndLiveRaid}
                    className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white font-mono font-bold text-[10px] uppercase tracking-wider p-2 px-3 rounded-xl transition shadow-lg cursor-pointer"
                  >
                    <LogOut size={12} /> End Raid
                  </button>
                </>
              )}
            </div>
          </div>

          {/* MAIN THREE-COLUMN SPLITTER */}
          <div className="grid grid-cols-12 gap-4 items-stretch relative overflow-visible">
            
            {/* COLUMN 2: CENTER GRID CANVAS (COLUMN 1 REMOVED FOR COMFORTABLE HORIZONTAL GRID SPACE) */}
            <div className={`${centerColSpanClass} border border-slate-800 bg-slate-950 rounded-b-2xl rounded-tr-2xl p-4 shadow-xl flex flex-col justify-between min-h-[42rem] pb-8 overflow-visible relative mt-9 transition-all duration-300`}>
              
              {/* OneNote Notebook Folder Tabs Left-Aligned Row */}
              <div className="absolute -top-[33px] left-0 flex items-end pl-2 z-10">
                {session.selectedConfigIds?.map(gridId => {
                  const isActive = activeTabConfigId === gridId;
                  const gridObj = localGrids[gridId] || session.grids?.[gridId];
                  const cTitle = gridObj?.name || gridObj?.title || compositions[gridId]?.title || gridId;
                  return (
                    <button
                      key={gridId}
                      type="button"
                      onClick={() => {
                        setActiveTabConfigId(gridId);
                        setActivePopover(null);
                      }}
                      className={`px-4 py-1.5 text-xs font-mono font-black uppercase tracking-wider rounded-t-xl transition-all border-t border-x ${
                        isActive 
                          ? 'bg-slate-950 text-indigo-400 border-slate-800 border-b-slate-950 z-20 font-bold translate-y-[1px]' 
                          : 'bg-slate-950/30 text-slate-500 border-slate-900/60 hover:text-slate-300 hover:bg-slate-950/50 z-0'
                      }`}
                    >
                      {cTitle}
                    </button>
                  );
                })}
              </div>
              <div className="overflow-x-auto overflow-visible scrollbar-thin pr-1 flex-1">
                {activeTabConfigId && localGrids[activeTabConfigId] ? (() => {
                  const activeConfig = localGrids[activeTabConfigId];
                  const slots = activeConfigAllocations;
                  
                  const columnsCount = parseInt(slots["meta_columnsCount"], 10) || 8;
                  const rowsCount = parseInt(slots["meta_rowsCount"], 10) || 5;

                  // Clean, direct reference to the native hyphenated calendar storage key signature
                  const liveRaidCompositeKey = `${session?.eventDate}_${session?.eventKey}`;

                  return (
                    <div 
                      ref={gridRef}
                      className="grid gap-2 pb-12 overflow-visible p-2"
                      style={{ gridTemplateColumns: `repeat(${columnsCount}, minmax(130px, 1fr))` }}
                    >
                      {/* Grid Title Card — Grid Tab name (matches /myparty) */}
                      <div 
                        className="col-span-full bg-slate-950/80 border border-slate-900 rounded-xl p-3 mb-2 flex items-center justify-center select-none shadow-sm"
                        style={{ gridColumn: '1 / -1' }}
                      >
                        <div className="text-center">
                          <span className="text-[9px] font-mono font-bold tracking-widest text-slate-500 uppercase block">
                            {activeConfig.parentConfigTitle || session?.eventTitle || 'Live Raid'}
                          </span>
                          <h2 className="text-sm font-black tracking-wide text-indigo-400 font-sans mt-0.5 uppercase">
                            {activeConfig.name || activeConfig.title || 'Untitled Tab'}
                          </h2>
                        </div>
                      </div>

                      {/* Party Header Title row */}
                      {Array.from({ length: columnsCount }).map((_, cIdx) => {
                        const colNum = cIdx + 1;
                        const currentCustomName = slots[`party_name_${colNum}`] || `Party ${colNum}`;
                        return (
                          <div key={cIdx} className="px-1 py-1 border-b border-slate-900 pb-2 flex items-center justify-center">
                            <input
                              type="text"
                              value={currentCustomName}
                              disabled={!isOfficer}
                              onChange={(e) => handleUpdatePartyName(colNum, e.target.value)}
                              className="w-full text-center bg-transparent text-[10px] font-mono font-black uppercase text-slate-400 tracking-wider outline-none border-b border-transparent focus:border-slate-800 focus:text-indigo-400 py-0.5"
                            />
                          </div>
                        );
                      })}

                      {/* Custom grid blocks */}
                      {Array.from({ length: rowsCount }).map((_, rIdx) => {
                        return Array.from({ length: columnsCount }).map((_, cIdx) => {
                          const coordKey = `${cIdx + 1}-${rIdx + 1}`;
                          const slotData = slots[coordKey] || { userId: '', roleLock: '' };

                          const popoverAlignClass = cIdx === 0 
                            ? "left-0 text-left" 
                            : cIdx === columnsCount - 1 
                              ? "right-0 text-right" 
                              : "left-1/2 -translate-x-1/2 text-left";
                          
                          const popoverVAlignClass = rIdx >= Math.max(1, rowsCount - 2) ? "bottom-full mb-2" : "top-full mt-2";

                          const allocatedUserObj = slotData.userId ? members[slotData.userId] : null;
                          const lockedJobObj = slotData.roleLock ? jobsCatalog[slotData.roleLock] : null;
                          const isCellRoleLocked = !!slotData.roleLock;
                          const isPartyLeader = !!slotData.isPartyLeader;
                          const isRaidLeader = !!slotData.isRaidLeader;
                          const cellColorTheme = lockedJobObj?.colorTheme || '#1e293b';

                          const isAssignPopoverOpen = activePopover?.coordKey === coordKey && activePopover?.type === 'assign';
                          const isGearPopoverOpen = activePopover?.coordKey === coordKey && activePopover?.type === 'gear';
                          const trendTimeline = slotData.userId
                            ? buildMemberTrendTimeline(historySessions, slotData.userId, 8)
                            : [];
                          const isDragHovered = dragHoveredCoord === coordKey;

                          const isSearchHighlighted = !!(searchQuery.trim() && allocatedUserObj && 
                            allocatedUserObj.displayName.toLowerCase().includes(searchQuery.toLowerCase()));

                          // Voice channel status indicators
                          const isVoiceConnected = slotData.userId
                            ? liveVoiceUids.includes(slotData.userId)
                            : false;
                          const hasPlacementsConflict = slotData.userId
                            ? allocatedConflictsSet.has(slotData.userId)
                            : false;

                          // Calendar excused absent mapping check
                          const calendarSignKey = `${session.eventDate}_${session.eventKey}`;
                          const isUserOnLeave = !!(slotData.userId && commitments[calendarSignKey]?.[slotData.userId]?.status === 'Leave');

                          return (
                            <div
                              key={coordKey}
                              draggable={isOfficer && !!slotData.userId}
                              onDragStart={(e) => handleCellDragStart(e, coordKey, slotData.userId)}
                              onDragOver={(e) => e.preventDefault()}
                              onDragEnter={(e) => { e.preventDefault(); if (isOfficer) setDragHoveredCoord(coordKey); }}
                              onDragLeave={() => { if (dragHoveredCoord === coordKey) setDragHoveredCoord(null); }}
                              onDrop={(e) => {
                                setDragHoveredCoord(null);
                                handleCellDropIntercept(e, coordKey);
                              }}
                              className={`rounded-xl border p-2 min-h-[90px] flex flex-col justify-between transition-all font-mono text-xs shadow-inner relative group select-none bg-slate-950/50 overflow-visible duration-150 ${
                                isDragHovered
                                  ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-slate-900/40 z-30'
                                  : (isAssignPopoverOpen || isGearPopoverOpen 
                                      ? 'z-40 ring-2 ring-indigo-500/50 shadow-lg border-slate-800' 
                                      : (isSearchHighlighted 
                                          ? 'border-amber-500 ring-2 ring-amber-500/40 bg-slate-900/60 z-10 scale-[1.01]' 
                                          : (isUserOnLeave 
                                              ? 'z-10 border-2' 
                                              : (hasPlacementsConflict
                                                  ? 'border-red-500 ring-2 ring-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.4)] z-20'
                                                  : 'border-slate-900 hover:border-slate-800 z-0'))))
                              } ${isOfficer && !!slotData.userId ? 'cursor-grab active:cursor-grabbing' : ''} ${
                                isRaidLeader ? 'ring-1 ring-red-800/80' : isPartyLeader ? 'ring-1 ring-blue-600/70' : ''
                              }`}
                              style={{
                                backgroundColor: undefined, // Let the background breathe freely behind the gradient mask
                                borderColor: (isSearchHighlighted || isUserOnLeave || hasPlacementsConflict) ? 'transparent' : (isCellRoleLocked ? `${cellColorTheme}30` : undefined),
                                boxShadow: (isSearchHighlighted || isUserOnLeave || hasPlacementsConflict) ? undefined : (isCellRoleLocked ? `inset 0 -6px 12px ${cellColorTheme}10` : undefined),
                                backgroundImage: isUserOnLeave && !isSearchHighlighted
                                  ? 'linear-gradient(#020617, #020617), repeating-linear-gradient(45deg, #b91c1c, #b91c1c 5px, #3f0c10 5px, #3f0c10 10px)'
                                  : (isCellRoleLocked 
                                      ? `linear-gradient(to bottom, transparent 80%, ${cellColorTheme}26 100%)`
                                      : undefined),
                                backgroundOrigin: isUserOnLeave && !isSearchHighlighted ? 'border-box' : undefined,
                                backgroundClip: isUserOnLeave && !isSearchHighlighted ? 'padding-box, border-box' : undefined
                              }}
                            >
                              {/* Position tags */}
                              <div className="absolute bottom-1 left-1.5 text-[5px] font-mono font-light tracking-tight text-slate-500/50 select-none pointer-events-none z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                P{cIdx + 1}-S{rIdx + 1}
                              </div>

                              {/* Conflict indicator container */}
                              {slotData.userId && hasPlacementsConflict && (
                                <div className="absolute top-2 right-2 flex items-center gap-1 z-10 pointer-events-none">
                                  <div className="w-2 h-2 rounded-full bg-red-500 shadow-sm shadow-red-500/50 animate-bounce" title="Roster Placements Conflict" />
                                </div>
                              )}

                              {/* Cell Controls Tool Deck */}
                              {isOfficer && (
                                <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20 bg-slate-950/60 backdrop-blur-sm rounded-lg p-0.5 border border-slate-900/60">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActivePopover(isGearPopoverOpen ? null : { coordKey, type: 'gear' });
                                    }}
                                    className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                                      isGearPopoverOpen ? 'text-amber-400 bg-slate-800' : 'text-slate-500 hover:text-slate-350'
                                    }`}
                                    title="Set Class Lock"
                                  >
                                    <Settings size={13} />
                                  </button>

                                  <MemberTrendHoverTip
                                    enabled={!!slotData.userId}
                                    displayName={allocatedUserObj?.displayName || 'Raider'}
                                    timeline={trendTimeline}
                                  >
                                    <button
                                      type="button"
                                      disabled={!slotData.userId}
                                      onClick={(e) => e.stopPropagation()}
                                      className="p-1 rounded hover:bg-slate-800 transition-colors disabled:opacity-20 disabled:cursor-not-allowed text-slate-500 hover:text-indigo-400"
                                      title={slotData.userId ? 'Hover for attendance trend' : 'Assign a member first'}
                                    >
                                      <Info size={13} />
                                    </button>
                                  </MemberTrendHoverTip>

                                  <span className="text-slate-800 font-mono text-[10px] mx-0.5 pointer-events-none select-none">|</span>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (slotData.userId) handleBindMemberToCell(coordKey, '');
                                    }}
                                    disabled={!slotData.userId}
                                    className="p-1 rounded hover:bg-slate-800 text-slate-650 hover:text-rose-450 transition-colors disabled:opacity-20 disabled:hover:text-slate-600 disabled:cursor-not-allowed"
                                    title="Unassign Position"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )}

                              {/* Interactive Cell overlay click zones */}
                              <div 
                                className="flex-1 flex flex-col justify-between cursor-pointer pt-4.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isOfficer) return;
                                  setActivePopover(isAssignPopoverOpen ? null : { coordKey, type: 'assign' });
                                  setSelectedPopoverJob(slotData.roleLock || '');
                                }}
                              >
                                {allocatedUserObj ? (
                                  <RaidMemberCard 
                                    allocatedUserObj={allocatedUserObj}
                                    jobObj={jobsCatalog[allocatedUserObj.jobCode]}
                                    currentStatus={commitments[calendarSignKey]?.[slotData.userId]?.status}
                                    isVoiceActive={liveVoiceUids.includes(slotData.userId)}
                                    isPartyLeader={isPartyLeader}
                                    isRaidLeader={isRaidLeader}
                                  />
                                ) : (
                                  <div className="h-full flex flex-col items-center justify-center space-y-1 text-slate-700 group-hover:text-slate-500 transition-colors py-2">
                                    {isCellRoleLocked ? (
                                      <>
                                        <img
                                          src={`/assets/icons/classes/${lockedJobObj?.iconFile || 'default.svg'}`}
                                          alt=""
                                          className="w-5 h-5 object-contain opacity-90"
                                          onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                        <span className="text-[8px] font-bold uppercase tracking-wider text-center max-w-full truncate px-0.5 text-slate-400">
                                          {lockedJobObj?.name}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <UserPlus size={20} strokeWidth={2.2} />
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Inline Popovers */}
                              {isGearPopoverOpen && (
                                <>
                                  <div className="fixed inset-0 z-[90]" onClick={() => setActivePopover(null)} />
                                  <div className={`absolute ${popoverAlignClass} ${popoverVAlignClass} bg-slate-900 border border-slate-800 p-2 rounded-xl shadow-2xl z-[100] w-56 font-sans space-y-1.5 animate-fadeIn text-left`}>
                                    {/* Raid Leader / Sub Leader */}
                                    <button
                                      type="button"
                                      disabled={!slotData.userId}
                                      onClick={() => handleSetRaidLeader(coordKey)}
                                      className={`w-full px-2 py-1.5 rounded-lg text-left text-[10px] font-semibold flex items-center gap-1.5 border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                        isRaidLeader
                                          ? 'text-red-400 bg-red-950/50 border-red-800 hover:bg-red-900/40'
                                          : 'text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800'
                                      }`}
                                    >
                                      <Crown size={11} className={`shrink-0 ${isRaidLeader ? 'text-red-500 fill-red-500' : 'text-slate-500'}`} />
                                      {isRaidLeader ? 'Remove Raid Leader' : 'Set as Raid Leader'}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!slotData.userId}
                                      onClick={() => handleSetPartyLeader(coordKey)}
                                      className={`w-full px-2 py-1.5 rounded-lg text-left text-[10px] font-semibold flex items-center gap-1.5 border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                        isPartyLeader
                                          ? 'text-blue-400 bg-blue-950/50 border-blue-800 hover:bg-blue-900/40'
                                          : 'text-slate-300 border-slate-800 hover:text-white hover:bg-slate-800'
                                      }`}
                                    >
                                      <Flag size={11} className={`shrink-0 ${isPartyLeader ? 'text-blue-500 fill-blue-500' : 'text-slate-500'}`} />
                                      {isPartyLeader ? 'Remove Sub Leader' : 'Set as Sub Leader'}
                                    </button>
                                    <div className="text-[9px] font-mono font-bold uppercase text-slate-500 tracking-wider select-none px-1 border-b border-slate-800 pb-1 pt-0.5">Pre-Assign Job Role</div>
                                    <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5 scrollbar-thin text-left">
                                      <button
                                        type="button"
                                        onClick={() => handleSetCellRoleLock(coordKey, '')}
                                        className="w-full px-2 py-1 rounded-lg text-left text-[10px] font-medium text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5"
                                      >
                                        <Ban size={12} className="shrink-0 text-rose-400" /> Clear Role Lock
                                      </button>
                                      {Object.entries(jobsCatalog).map(([code, j]) => (
                                        <button
                                          key={code}
                                          type="button"
                                          onClick={() => handleSetCellRoleLock(coordKey, code)}
                                          className="w-full px-2 py-1 rounded-lg text-left text-[10px] font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer flex items-center justify-between gap-2"
                                        >
                                          <span className="flex items-center gap-1.5 min-w-0">
                                            <img
                                              src={`/assets/icons/classes/${j.iconFile || 'default.svg'}`}
                                              alt=""
                                              className="w-3.5 h-3.5 object-contain shrink-0"
                                              onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                            <span className="truncate">{j.name}</span>
                                          </span>
                                          {slotData.roleLock === code && <Check size={10} className="shrink-0 text-indigo-400" />}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </>
                              )}

                              {isAssignPopoverOpen && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setActivePopover(null)} />
                                  <div className={`absolute ${popoverAlignClass} ${popoverVAlignClass} bg-slate-900 border border-slate-800 p-2 rounded-xl shadow-2xl z-50 w-64 font-sans space-y-2 animate-fadeIn text-left`}>
                                    {!slotData.roleLock ? (
                                      <div className="space-y-1 border-b border-slate-800 pb-1.5 text-left">
                                        <div className="text-[9px] font-mono font-bold uppercase text-slate-500 tracking-wider select-none px-1">Filter Class Profile:</div>
                                        <select
                                          value={selectedPopoverJob}
                                          onChange={(e) => setSelectedPopoverJob(e.target.value)}
                                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300 font-semibold outline-none cursor-pointer"
                                        >
                                          <option value="">-- Display All Classes --</option>
                                          {Object.entries(jobsCatalog).map(([code, j]) => (
                                            <option key={code} value={code} className="bg-slate-950">{j.name}</option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : (
                                      <div className="text-[9px] font-mono font-bold uppercase tracking-wider select-none px-1 border-b border-slate-800 pb-1 flex items-center justify-between text-slate-300">
                                        <span className="flex items-center gap-1.5 text-slate-300">
                                          <Lock size={11} className="shrink-0 text-amber-400" />
                                          Role Lock: {lockedJobObj?.name}
                                        </span>
                                      </div>
                                    )}

                                    <div className="space-y-1 text-left">
                                      <div className="text-[9px] font-mono font-bold uppercase text-slate-500 tracking-wider select-none px-1">Select Candidate:</div>
                                      <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5 scrollbar-thin text-left">
                                        {slotData.userId && (
                                          <button
                                            type="button"
                                            onClick={() => handleBindMemberToCell(coordKey, '')}
                                            className="w-full px-2 py-1.5 rounded-lg text-left text-[10px] uppercase font-bold text-rose-450 hover:text-white hover:bg-rose-600 cursor-pointer transition-colors"
                                          >
                                            ✖ Unassign Position
                                          </button>
                                        )}
                                        
                                        {(() => {
                                          const poolGroup = [...categorizedRosterPools.standby, ...categorizedRosterPools.uncommitted];
                                          const targetJobFilter = slotData.roleLock || selectedPopoverJob;
                                          
                                          const matchingCandidates = poolGroup.filter(player => {
                                            if (targetJobFilter && player.jobCode !== targetJobFilter) return false;
                                            return true;
                                          });

                                          if (matchingCandidates.length === 0) {
                                            return <div className="text-[10px] text-slate-600 italic px-2 py-1">No standing candidates match.</div>;
                                          }

                                          return matchingCandidates.map(player => {
                                            const isCurrentlySlottedInCell = slotData.userId === player.uid;
                                            return (
                                              <button
                                                key={player.uid}
                                                type="button"
                                                onClick={() => handleBindMemberToCell(coordKey, player.uid)}
                                                className={`w-full px-2 py-1 rounded-lg text-left text-[11px] font-medium transition flex items-center justify-between cursor-pointer ${
                                                  isCurrentlySlottedInCell ? 'bg-indigo-600 text-white font-bold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                                                }`}
                                              >
                                                <span className="truncate max-w-[180px]">{player.displayName}</span>
                                                {player.assignedLocation && (
                                                  <span className="text-[8px] bg-slate-950 border border-slate-800 px-1 py-0.5 rounded text-[9px] font-bold text-slate-400 font-mono shrink-0 ml-1">
                                                    {player.assignedLocation}
                                                  </span>
                                                )}
                                              </button>
                                            );
                                          });
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        });
                      })}
                    </div>
                  );
                })() : (
                  <div className="text-center py-24 bg-slate-900/10 border border-dashed border-slate-800 rounded-3xl text-xs text-slate-500 font-mono italic select-none">
                    Session configs loaded. Select active composition tab cards to view grids.
                  </div>
                )}
              </div>

              {/* Commit changes footer layout */}
              {isOfficer && (
                <div className="border-t border-slate-900 pt-3 flex flex-wrap items-center justify-between gap-2 select-none shrink-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleClearGridMembers}
                      className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 hover:border-amber-700/60 p-2 px-2.5 rounded-xl text-[10px] font-mono font-bold text-slate-400 hover:text-amber-300 transition cursor-pointer"
                      title="Clear member assignments only"
                    >
                      <Users size={12} /> Clear Members
                    </button>
                    <button
                      type="button"
                      onClick={handleClearGridJobLocks}
                      className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 hover:border-sky-700/60 p-2 px-2.5 rounded-xl text-[10px] font-mono font-bold text-slate-400 hover:text-sky-300 transition cursor-pointer"
                      title="Clear job class role locks only"
                    >
                      <ShieldOff size={12} /> Clear Job Class
                    </button>
                    <button
                      type="button"
                      onClick={handleClearGridAll}
                      className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 hover:border-rose-700/60 p-2 px-2.5 rounded-xl text-[10px] font-mono font-bold text-slate-400 hover:text-rose-300 transition cursor-pointer"
                      title="Clear members and job locks"
                    >
                      <Eraser size={12} /> Clear All
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCommitLiveGridsChanges}
                    disabled={syncStatus === 'saving'}
                    className={`flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-xs font-bold uppercase tracking-wider text-white transition-all shadow-xl select-none cursor-pointer ${
                      syncStatus === 'error' || isDirty
                        ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                        : syncStatus === 'saving'
                          ? 'bg-slate-800 border border-slate-700 text-slate-300 cursor-wait shadow-none'
                          : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 shadow-none'
                    }`}
                    title="Edits auto-save. Use Force Sync only if sync failed."
                  >
                    <Save size={14} />
                    {syncStatus === 'saving'
                      ? 'Saving…'
                      : syncStatus === 'error' || isDirty
                        ? 'Force Sync'
                        : 'Auto-Synced'}
                  </button>
                </div>
              )}
            </div>

            {/* COLUMN 3: RIGHT ROSTER PANEL */}
            {rightPanelCollapsed ? (
              <div className="col-span-12 xl:col-span-1 border border-slate-900 bg-slate-950/60 rounded-2xl p-2 flex flex-col items-center shadow-md min-h-[42rem] justify-start py-4">
                <button
                  type="button"
                  onClick={() => setRightPanelCollapsed(false)}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-indigo-400 hover:text-white transition cursor-pointer font-bold text-xs"
                >
                  <ChevronLeft size={14} />
                </button>
                <div className="text-[9px] uppercase font-mono font-bold tracking-widest text-slate-600 mt-8 [writing-mode:vertical-lr]">ROSTERS</div>
              </div>
            ) : (
              <div 
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFeederPoolDropIntercept}
                className="col-span-12 xl:col-span-3 border border-slate-800 bg-slate-950/40 rounded-2xl p-3.5 flex flex-col space-y-4 shadow-md min-h-[42rem] pb-8"
              >
                <RosterSidebar 
                  standbyList={categorizedRosterPools.standby}
                  uncommittedList={categorizedRosterPools.uncommitted}
                  leaveList={categorizedRosterPools.leave}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  isOfficer={isOfficer}
                  liveVoiceUids={liveVoiceUids}
                  jobsCatalog={jobsCatalog}
                  setRightPanelCollapsed={setRightPanelCollapsed}
                />
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
