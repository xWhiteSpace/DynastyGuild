// frontend/src/pages/SettingsTab.jsx
import { useState, useEffect } from 'react';
import { apiFetch } from '../services/apiClient';

const COMMON_TIMEZONES = [
  { value: 'Asia/Manila', label: 'Manila (GMT+8)' },
  { value: 'Asia/Singapore', label: 'Singapore (GMT+8)' },
  { value: 'Asia/Taipei', label: 'Taipei (GMT+8)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (GMT+9)' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'UTC', label: 'Coordinated Universal Time (UTC)' }
];

const DAYS_OF_WEEK_MAP = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' }
];

const THEME_PRESETS = [
  { key: 'purple', label: 'Purple Rarity', dot: 'bg-violet-500 ring-violet-500/20' },
  { key: 'yellow', label: 'Yellow Legend', dot: 'bg-amber-400 ring-amber-400/20' },
  { key: 'slate', label: 'Slate Common', dot: 'bg-slate-400 ring-slate-400/20' },
  { key: 'red', label: 'Red Artifact', dot: 'bg-rose-500 ring-rose-500/20' },
  { key: 'orange', label: 'Orange Epic', dot: 'bg-orange-500 ring-orange-500/20' },
  { key: 'emerald', label: 'Emerald Set', dot: 'bg-emerald-500 ring-emerald-500/20' },
  { key: 'blue', label: 'Blue Rare', dot: 'bg-sky-500 ring-sky-500/20' }
];

// --- 🎨 PURE VECTOR MICRO-ICONS CONSOLE ---
const IconLock = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
const IconGlobe = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 000 20M2 12h20"/></svg>;
const IconCalendar = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
const IconHelp = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" strokeLinecap="round"/></svg>;
const IconBell = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>;
const IconSliders = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" strokeLinecap="round"/></svg>;
const IconShield = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconPackage = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>;
const IconTrash = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const IconPlus = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>;
const IconX = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const IconTag = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01"/></svg>;
const IconMegaphone = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 11-5.8-1.6"/></svg>;
const IconMoneyBag = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5c-.5-1 0-2 1-3h4c1 1 1.5 2 1 3M7 5h10l2.5 5.5A7 7 0 0112 21a7 7 0 01-7.5-10.5L7 5z"/><path d="M12 10v6M10 13.5c0 1 .8 1.5 2 1.5s2-.5 2-1.5-.8-1.5-2-1.5-2-.5-2-1.5.8-1.5 2-1.5 2 .5 2 1.5"/></svg>;

const EMPTY_DISCORD_CHANNELS = {
  auctionChannelId: '',
  aucreqChannelId: '',
  genroomId: '',
  attendanceId: '',
  warAnnounceChannelId: '',
  warRooms: {
    DISCORD_WARROOM_ID_1: '',
    DISCORD_WARROOM_ID_2: '',
    DISCORD_WARROOM_ID_3: '',
    DISCORD_WARROOM_ID_4: '',
    DISCORD_WARROOM_ID_5: '',
  },
};

const EMPTY_WAR_ROOMS = {
  room_001: { name: 'War room 1', envKey: 'DISCORD_WARROOM_ID_1' },
  room_002: { name: 'War room 2', envKey: 'DISCORD_WARROOM_ID_2' },
  room_003: { name: 'War room 3', envKey: 'DISCORD_WARROOM_ID_3' },
  room_004: { name: 'War room 4', envKey: 'DISCORD_WARROOM_ID_4' },
  room_005: { name: 'War room 5', envKey: 'DISCORD_WARROOM_ID_5' },
};

export default function SettingsTab() {
  const [isLocked, setIsLocked] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [deployingCard, setDeployingCard] = useState(false);
  const [deployCardMsg, setDeployCardMsg] = useState(null);
  const [deployingAttendanceCard, setDeployingAttendanceCard] = useState(false);
  const [deployAttendanceMsg, setDeployAttendanceMsg] = useState(null);
  const [deployingPartyCard, setDeployingPartyCard] = useState(false);
  const [deployPartyMsg, setDeployPartyMsg] = useState(null);
  const [discordChannels, setDiscordChannels] = useState(EMPTY_DISCORD_CHANNELS);
  
  const [config, setConfig] = useState({
    guildDisplayName: '',
    timezone: 'Asia/Manila',
    isForceLocked: false,
    helpEmbedUrl: '',
    raidHelpEmbedUrl: '',
    priorityLookbackDays: 30,
    adminRoles: [],
    items: [],
    events: {},
    jobs: {},
    roles: {},
    specialEventCategories: ["Raid", "Meeting", "PVP", "Casual"],
    announcements: {
      phase1: ["07:00", "12:00", "19:00"],
      phase2: "22:15",
      phase3: "20:55"
    },
    liveRaidMaxConfigs: 5,
    liveRaidMaxWarRooms: 2,
    defaultLeaveCredits: 3,
    warRooms: { ...EMPTY_WAR_ROOMS }
  });

  // State handles for inputting new items, roles, and events
  const [newRoleStr, setNewRoleStr] = useState('');
  const [discordRoles, setDiscordRoles] = useState([]);
  const [newEventName, setNewEventName] = useState('');
  
  // 🗺️ NAVIGATION STRIP STATE
  const [activeNavTab, setActiveNavTab] = useState('system');
  // 🎯 MASTER-DETAIL PANELS FOCUS STATE KEY
  const [editingEventKey, setEditingEventKey] = useState(null);
  // Floating absolute alarm popover target per phase timeline row
  const [activeAlarmPopoverId, setActiveAlarmPopoverId] = useState(null);

  const loadGlobalConfigurationTree = async (retried = false) => {
    try {
      const res = await apiFetch('/api/requests/settings/get', { method: 'GET' });
      const data = await res.json();
      if (data.success) {
        if (data.publicOnly) {
          if (retried) {
            setIsLocked(true);
            return;
          }
          const unlockRes = await apiFetch('/api/requests/settings/unlock', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          const unlockData = await unlockRes.json().catch(() => ({}));
          if (unlockData.success) {
            if (unlockData.user) {
              localStorage.setItem('guild_raid_session', JSON.stringify(unlockData.user));
            }
            return loadGlobalConfigurationTree(true);
          }
          setIsLocked(true);
          if (unlockData.error) setErrorMsg(unlockData.error);
          return;
        }
        setConfig({
          ...data.config,
          guildDisplayName: data.config.guildDisplayName || '',
          helpEmbedUrl: data.config.helpEmbedUrl || '',
          raidHelpEmbedUrl: data.config.raidHelpEmbedUrl || '',
          adminRoles: Array.isArray(data.config.adminRoles) ? data.config.adminRoles : [],
          roles: data.config.roles || {},
          liveRaidMaxConfigs: data.config.liveRaidMaxConfigs ?? 5,
          liveRaidMaxWarRooms: data.config.liveRaidMaxWarRooms ?? 2,
          defaultLeaveCredits: data.config.defaultLeaveCredits ?? 3,
          warRooms: data.config.warRooms && Object.keys(data.config.warRooms).length
            ? data.config.warRooms
            : { ...EMPTY_WAR_ROOMS },
        });
        if (data.discordChannels) {
          setDiscordChannels({
            ...EMPTY_DISCORD_CHANNELS,
            ...data.discordChannels,
            warRooms: {
              ...EMPTY_DISCORD_CHANNELS.warRooms,
              ...(data.discordChannels.warRooms || {}),
            },
          });
        }
        setIsLocked(false);
        const unlockRes = await apiFetch('/api/requests/settings/unlock', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const unlockData = await unlockRes.json().catch(() => ({}));
        if (unlockData.user) {
          localStorage.setItem('guild_raid_session', JSON.stringify(unlockData.user));
        }
      }
    } catch (err) {
      console.error("Error loading settings from server routing layer:", err);
    }
  };

  useEffect(() => {
    loadGlobalConfigurationTree();
  }, []);

  useEffect(() => {
    if (isLocked) return undefined;
    let guildId = '';
    try {
      guildId = JSON.parse(localStorage.getItem('guild_raid_session') || '{}').currentTenantId || '';
    } catch {
      guildId = '';
    }
    if (!guildId) return undefined;
    apiFetch(`/api/tenants/discord-roles?guildId=${encodeURIComponent(guildId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setDiscordRoles(data.roles || []);
      })
      .catch(() => {});
    return undefined;
  }, [isLocked]);

  const handleVerifyPassphrase = async () => {
    try {
      setErrorMsg('');
      const res = await apiFetch('/api/requests/settings/unlock', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        if (data.user) {
          localStorage.setItem('guild_raid_session', JSON.stringify(data.user));
        }
        setIsLocked(false);
        setErrorMsg('');
        loadGlobalConfigurationTree();
      } else {
        setErrorMsg(data.error || 'Officers of this Discord server can unlock Settings.');
      }
    } catch (err) {
      setErrorMsg('Could not reach the server to unlock Settings.');
    }
  };

  const handleDetectBrowserTimezone = () => {
    try {
      setSuccessMsg('');
      setErrorMsg('');
      const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (systemZone) {
        setConfig(prev => ({ ...prev, timezone: systemZone }));
        setSuccessMsg(`Auto-detected browser environment location: ${systemZone}`);
      }
    } catch (e) {
      setErrorMsg('Could not securely auto-detect browser timezone variables.');
    }
  };

  const postDeployRoute = async (path) => {
    const res = await apiFetch(path, { method: 'GET' });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `Failed (${res.status})`);
    }
    return text;
  };

  // Posts the interactive public auction card into DISCORD_AUCREQ_CHANNEL_ID via the backend deploy route.
  const handleDeployAuctionCard = async () => {
    if (deployingCard) return;
    setDeployingCard(true);
    setDeployCardMsg(null);
    try {
      const text = await postDeployRoute('/api/deploy-auction-card');
      setDeployCardMsg({ ok: true, text: text || 'Auction card deployed to Discord.' });
    } catch (err) {
      setDeployCardMsg({ ok: false, text: err.message || 'Request failed' });
    } finally {
      setDeployingCard(false);
      setTimeout(() => setDeployCardMsg(null), 8000);
    }
  };

  const handleDeployAttendanceCard = async () => {
    if (deployingAttendanceCard) return;
    setDeployingAttendanceCard(true);
    setDeployAttendanceMsg(null);
    try {
      const text = await postDeployRoute('/api/deploy-attendance-card');
      setDeployAttendanceMsg({ ok: true, text: text || 'Attendance card deployed to Discord.' });
    } catch (err) {
      setDeployAttendanceMsg({ ok: false, text: err.message || 'Request failed' });
    } finally {
      setDeployingAttendanceCard(false);
      setTimeout(() => setDeployAttendanceMsg(null), 12000);
    }
  };

  const handleDeployPartyCard = async () => {
    if (deployingPartyCard) return;
    setDeployingPartyCard(true);
    setDeployPartyMsg(null);
    try {
      const text = await postDeployRoute('/api/deploy-party-card');
      setDeployPartyMsg({ ok: true, text: text || 'Party card deployed to Discord.' });
    } catch (err) {
      setDeployPartyMsg({ ok: false, text: err.message || 'Request failed' });
    } finally {
      setDeployingPartyCard(false);
      setTimeout(() => setDeployPartyMsg(null), 12000);
    }
  };

  const handleUpdateEventLootLimit = (evKey, itemId, direction) => {
    const updatedEvents = { ...config.events };
    if (!updatedEvents[evKey].loots) updatedEvents[evKey].loots = {};
    const currentQty = updatedEvents[evKey].loots[itemId] || 0;
    const nextQty = direction === 'up' ? currentQty + 1 : Math.max(0, currentQty - 1);
    
    if (nextQty <= 0) {
      delete updatedEvents[evKey].loots[itemId];
    } else {
      updatedEvents[evKey].loots[itemId] = nextQty;
    }
    setConfig(prev => ({ ...prev, events: updatedEvents }));
  };

  const handleAddItemNode = () => {
    const nextIndex = config.items.length + 1;
    const paddingStr = String(nextIndex).padStart(3, '0');
    const newItemObj = {
      id: `item_${paddingStr}`,
      name: `Custom Loot Classification ${nextIndex}`,
      colorTheme: 'slate',
      isHighValue: false
    };
    setConfig(prev => ({ ...prev, items: [...prev.items, newItemObj] }));
  };

  const handleAddRoleNode = (roleName) => {
    const name = String(roleName || newRoleStr || '').trim();
    if (!name) return;
    const current = Array.isArray(config.adminRoles) ? config.adminRoles : [];
    if (current.some((role) => role.toLowerCase() === name.toLowerCase())) return;
    setConfig((prev) => ({ ...prev, adminRoles: [...(prev.adminRoles || []), name] }));
    setNewRoleStr('');
  };

  const handleRemoveRoleNode = (roleName) => {
    setConfig((prev) => ({
      ...prev,
      adminRoles: (prev.adminRoles || []).filter((role) => role.toLowerCase() !== String(roleName).toLowerCase()),
    }));
  };

  const toggleOfficerRole = (name) => {
    const current = Array.isArray(config.adminRoles) ? config.adminRoles : [];
    if (current.some((role) => role.toLowerCase() === name.toLowerCase())) {
      handleRemoveRoleNode(name);
      return;
    }
    handleAddRoleNode(name);
  };

  const handleAddEventNode = () => {
    const currentEventKeys = Object.keys(config.events || {});
    let nextEventIndex = 1;

    if (currentEventKeys.length > 0) {
      const numericIndices = currentEventKeys.map(key => {
        const matchResult = key.match(/^ev_(\d+)$/);
        return matchResult ? parseInt(matchResult[1], 10) : 0;
      });
      nextEventIndex = Math.max(...numericIndices) + 1;
    }

    const finalEventTitle = newEventName.trim() || `New Raid Session ${nextEventIndex}`;
    const paddingStr = String(nextEventIndex).padStart(3, '0');
    const newEventKey = `ev_${paddingStr}`;
    
    const defaultEventStructure = {
      title: finalEventTitle,
      phases: {
        1: { dayStart: 0, timeStart: "22:15", dayEnd: 1, timeEnd: "22:15" },
        2: { dayStart: 1, timeStart: "22:15", dayEnd: 2, timeEnd: "20:55" },
        3: { dayStart: 2, timeStart: "20:55", dayEnd: 2, timeEnd: "22:15" }
      },
      loots: {},
      announcements: {
        phase1: ["07:00", "12:00", "19:00"],
        phase2: "22:15",
        phase3: "20:55"
      }
    };

    setConfig(prev => ({
      ...prev,
      events: { ...prev.events, [newEventKey]: defaultEventStructure }
    }));
    setNewEventName('');
    setEditingEventKey(newEventKey);
  };

  const handleRemoveEventNode = (evKey) => {
    const updatedEvents = { ...config.events };
    delete updatedEvents[evKey];
    setConfig(prev => ({ ...prev, events: updatedEvents }));
    if (editingEventKey === evKey) {
      setEditingEventKey(Object.keys(updatedEvents)[0] || null);
    }
  };

  const handlePhaseChange = (evKey, phaseNum, field, value) => {
    const updatedEvents = { ...config.events };
    if (updatedEvents[evKey] && updatedEvents[evKey].phases?.[phaseNum]) {
      updatedEvents[evKey].phases[phaseNum][field] = field.includes('dayStart') || field.includes('dayEnd') ? Number(value) : value;
      setConfig(prev => ({ ...prev, events: updatedEvents }));
    }
  };

  const handleSaveWorkspaceChanges = async () => {
    try {
      setSuccessMsg('');
      setErrorMsg('');
      const res = await apiFetch('/api/requests/settings/save', {
        method: 'POST',
        body: JSON.stringify({ config, discordChannels })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('Guild settings saved.');
        const name = (config.guildDisplayName || '').trim();
        document.title = `${name || 'Guild'} Guild App`;
        loadGlobalConfigurationTree();
      } else {
        setErrorMsg(data.error || 'Failed to update dynamic configuration matrix.');
      }
    } catch (err) {
      setErrorMsg('Failed to process secure data save configuration transaction payload.');
    }
  };

  if (isLocked) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-white border border-slate-800 bg-slate-900 rounded-3xl mt-16 shadow-2xl animate-fadeIn">
        <div className="text-slate-500 mb-4 flex justify-center"><IconLock /></div>
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-200">System Settings Locked</h2>
        <p className="text-xs text-slate-400 mt-1 mb-6 font-sans">Only officers of this Discord server can open Settings. The person who set up the guild can add your Discord role name here after they unlock.</p>
        {errorMsg && <div className="text-[11px] font-sans font-medium text-rose-400 mb-3">{errorMsg}</div>}
        
        <button 
          onClick={handleVerifyPassphrase}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold uppercase tracking-wider transition shadow-lg cursor-pointer"
        >
          Unlock
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6 text-white pb-32 font-sans space-y-6 animate-fadeIn">
      
      {/* HEADER CONTROLS VIEW STRIP */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">System Settings</h1>
          <div className="text-xs text-slate-400 mt-1 font-normal">Adjust auction properties, Send announcements, and edit Item parameters.</div>
        </div>
        <button 
          onClick={() => setIsLocked(true)} 
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-[10px] uppercase font-bold tracking-wider rounded-xl text-slate-400 hover:text-white transition cursor-pointer shadow-sm"
        >
          Close Panel <IconX />
        </button>
      </div>

      {/* FEEDBACK STATUS CHIPS */}
      {successMsg && <div className="bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 text-xs p-3.5 rounded-xl font-semibold shadow-md animate-slideIn">{successMsg}</div>}
      {errorMsg && <div className="bg-rose-950/30 border border-rose-500/30 text-rose-400 text-xs p-3.5 rounded-xl font-semibold shadow-md animate-slideIn">{errorMsg}</div>}

      {/* CORE NAVIGATION STRIP */}
      <div className="flex flex-wrap bg-slate-950 border border-slate-800 p-1 rounded-xl gap-1 shadow-inner shrink-0">
        <button 
          type="button"
          onClick={() => setActiveNavTab('system')} 
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${activeNavTab === 'system' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <IconSliders /> System Properties
        </button>
        <button 
          type="button"
          onClick={() => setActiveNavTab('events')} 
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${activeNavTab === 'events' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <IconCalendar /> Events ({Object.keys(config.events || {}).length})
        </button>
        <button 
          type="button"
          onClick={() => setActiveNavTab('roles')} 
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${activeNavTab === 'roles' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <IconShield /> Access Governance ({config.adminRoles?.length || 0})
        </button>
        <button 
          type="button"
          onClick={() => setActiveNavTab('items')} 
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${activeNavTab === 'items' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <IconPackage /> Item Catalog ({config.items?.length || 0})
        </button>
        <button 
          type="button"
          onClick={() => setActiveNavTab('jobs')} 
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${activeNavTab === 'jobs' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <IconShield /> Job Registry ({Object.keys(config.jobs || {}).length})
        </button>
        <button 
          type="button"
          onClick={() => setActiveNavTab('members')} 
          className={`flex items-center justify-center gap-2 flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-lg transition-all duration-200 ${activeNavTab === 'members' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <IconShield /> Members
        </button>
      </div>

      {/* PANEL 1: SYSTEM PROPERTIES */}
      {activeNavTab === 'system' && (
        <div className="space-y-6 animate-fadeIn">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* CARD 1: OVERRIDE LOCK */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><IconLock /> Bidding gate mode</div>
                <p className="text-[11px] text-slate-500 mt-1 font-normal">Toggle automated scheduling via Phases or enforce absolute locks.</p>
              </div>
              <div className="flex items-center justify-between bg-slate-950 border border-slate-800/80 rounded-xl p-3 h-11">
                <span className={`text-[10px] font-semibold tracking-wide font-mono ${!config.isForceLocked ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {!config.isForceLocked ? 'Auto-Phase Lock' : 'Forced Bid Lock'}
                </span>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev, isForceLocked: !prev.isForceLocked }))}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none shadow-inner ${
                    !config.isForceLocked ? 'bg-emerald-950/60 border border-emerald-500/20' : 'bg-rose-950/60 border-rose-900/20'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full shadow transition duration-200 ease-in-out mt-0.5 ${!config.isForceLocked ? 'translate-x-4 bg-emerald-400' : 'translate-x-0.5 bg-slate-500'}`} />
                </button>
              </div>
            </div>

            {/* CARD 2: TIMEZONE SELECTOR WITH STACKED DETECTION BUTTON */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><IconGlobe /> Time Zone</div>
                <p className="text-[11px] text-slate-500 mt-1 font-normal">Synchronize Setting clock to Server cloud clock.</p>
              </div>
              <div className="flex flex-col gap-2 bg-slate-950 border border-slate-800/80 rounded-xl p-2">
                <select
                  value={config.timezone || 'Asia/Manila'}
                  onChange={(e) => setConfig(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full bg-transparent text-xs text-slate-300 outline-none font-medium cursor-pointer font-mono py-1 px-1"
                >
                  {COMMON_TIMEZONES.map(z => <option key={z.value} value={z.value} className="bg-slate-950 text-slate-300">{z.label}</option>)}
                  {!COMMON_TIMEZONES.find(z => z.value === config.timezone) && (
                    <option value={config.timezone} className="bg-slate-950 text-slate-300">{config.timezone} (Custom)</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={handleDetectBrowserTimezone}
                  className="w-full h-7 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white text-[10px] font-semibold tracking-tight transition cursor-pointer shadow-sm"
                >
                  Detect Time Zone
                </button>
              </div>
            </div>

            {/* CARD: GUILD DISPLAY NAME */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300">Guild Name</div>
                <p className="text-[11px] text-slate-500 mt-1 font-normal">Shown in the browser tab after login as &quot;YourName Guild App&quot;. Leave blank to use &quot;Guild&quot;.</p>
              </div>
              <input
                type="text"
                value={config.guildDisplayName || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, guildDisplayName: e.target.value }))}
                placeholder="e.g. My Guild"
                maxLength={64}
                className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none font-sans placeholder:text-slate-600"
              />
            </div>

            {/* CARD 3: LOOKBACK EXPIRATION */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><IconCalendar /> Priority Lookback Period</div>
                <p className="text-[11px] text-slate-500 mt-1 font-normal">Sets how far back the system checks your past losses to give you priority.</p>
              </div>
              <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-xl px-3 h-11">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={config.priorityLookbackDays ?? 30}
                  onChange={(e) => {
                    const parsedVal = e.target.value === '' ? 30 : parseInt(e.target.value, 10);
                    setConfig(prev => ({ ...prev, priorityLookbackDays: parsedVal }));
                  }}
                  className="w-16 bg-slate-900 border border-slate-800/80 rounded-lg py-1 text-xs text-amber-500 font-mono font-bold text-center outline-none focus:border-slate-700"
                  placeholder="30"
                />
                <span className="text-[11px] text-slate-400 font-medium">Calendar Days</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><IconMegaphone /> Discord cards</div>
              <p className="text-[11px] text-slate-500 mt-1 font-normal">
                Posts into this guild’s mapped channels using this app’s Discord bot.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-400">
                  Auction claim card → auction request channel
                </span>
                <button
                  type="button"
                  onClick={handleDeployAuctionCard}
                  disabled={deployingCard}
                  className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold uppercase tracking-wider text-white transition cursor-pointer shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deployingCard ? 'Sending…' : 'Send auction'}
                </button>
              </div>
              {deployCardMsg && (
                <p className={`text-[10px] font-mono font-semibold ${deployCardMsg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{deployCardMsg.text}</p>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-400">
                  Attendance card → war-announce channel
                </span>
                <button
                  type="button"
                  onClick={handleDeployAttendanceCard}
                  disabled={deployingAttendanceCard}
                  className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold uppercase tracking-wider text-white transition cursor-pointer shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deployingAttendanceCard ? 'Sending…' : 'Send attendance'}
                </button>
              </div>
              {deployAttendanceMsg && (
                <p className={`text-[10px] font-mono font-semibold ${deployAttendanceMsg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{deployAttendanceMsg.text}</p>
              )}
              <p className="text-[10px] text-slate-500">
                Members click Open Attendance for Confirm/Leave and job/role.
              </p>
            </div>

            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-400">
                  Party card → war-announce channel
                </span>
                <button
                  type="button"
                  onClick={handleDeployPartyCard}
                  disabled={deployingPartyCard}
                  className="shrink-0 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold uppercase tracking-wider text-white transition cursor-pointer shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deployingPartyCard ? 'Sending…' : 'Send party'}
                </button>
              </div>
              {deployPartyMsg && (
                <p className={`text-[10px] font-mono font-semibold ${deployPartyMsg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{deployPartyMsg.text}</p>
              )}
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><IconGlobe /> Discord channel IDs</div>
            <p className="text-[11px] text-slate-500">Stored for this guild only. Discord Developer Mode → right-click channel → Copy Channel ID.</p>
            {[
              ['auctionChannelId', 'Auction announce'],
              ['aucreqChannelId', 'Auction request / claim card'],
              ['genroomId', 'General room'],
              ['attendanceId', 'Attendance parent'],
              ['warAnnounceChannelId', 'War announce'],
            ].map(([key, label]) => (
              <label key={key} className="block text-[10px] font-mono uppercase tracking-wider text-slate-500">
                {label}
                <input
                  value={discordChannels[key] || ''}
                  onChange={(e) => setDiscordChannels((prev) => ({ ...prev, [key]: e.target.value.trim() }))}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-slate-700"
                  placeholder="Channel ID"
                />
              </label>
            ))}
          </div>

          {/* HELP CANVASES EMBED LINK AREA */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-300"><IconHelp /> Help Guide URLs</div>
              <span className="text-[10px] text-slate-600 font-mono">Google Slides Embed URL</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Auction Dashboard Help Guide URL</label>
              <input
                type="text"
                value={config.helpEmbedUrl || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, helpEmbedUrl: e.target.value }))}
                placeholder="https://docs.google.com/presentation/d/.../embed"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:border-slate-700 font-mono transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold text-indigo-400/80 uppercase tracking-wider">Raid Governance Help Guide URL</label>
              <input
                type="text"
                value={config.raidHelpEmbedUrl || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, raidHelpEmbedUrl: e.target.value }))}
                placeholder="https://docs.google.com/presentation/d/.../embed (separate from Auction)"
                className="w-full bg-slate-950 border border-indigo-900/40 rounded-xl px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-700 font-mono transition"
              />
            </div>
          </div>
        </div>
      )}

      {/* PANEL 2: MASTER-DETAIL EVENTS OPERATION SUITE */}
      {activeNavTab === 'events' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start animate-fadeIn">
            
            {/* LEFT MASTER BLOCK STACK (35% WIDTH) */}
            <div className="md:col-span-4 space-y-4">
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Event Setup</div>
                <div className="flex flex-col gap-2">
                  <input 
                    type="text"
                    placeholder="Event Name (e.g. GL) ..."
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none font-sans focus:border-slate-700"
                  />
                  <button 
                    type="button"
                    onClick={handleAddEventNode}
                    className="flex items-center justify-center gap-1.5 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold uppercase tracking-wider rounded-xl transition cursor-pointer"
                  >
                    <IconPlus /> Create New Event
                  </button>
                </div>
              </div>

              {/* COMPACT EVENT INTERATION LIST MATRICES */}
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
                {config.events && Object.keys(config.events).length > 0 ? (
                  Object.keys(config.events).map((evKey) => {
                    const ev = config.events[evKey];
                    const activeDropsCount = Object.keys(ev.loots || {}).length;
                    const isActiveSelection = editingEventKey === evKey;
                    return (
                      <div 
                        key={evKey} 
                        onClick={() => setEditingEventKey(evKey)}
                        className={`border p-3.5 rounded-xl shadow-sm flex flex-col justify-between space-y-2 cursor-pointer transition transform hover:-translate-y-0.5 group relative overflow-hidden ${isActiveSelection ? 'bg-slate-900 border-indigo-500/80 shadow-md' : 'bg-slate-900/30 border-slate-800/80 hover:border-slate-700'}`}
                      >
                        {isActiveSelection && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />}
                        <div className="flex justify-between items-start">
                          <div className="truncate pr-2">
                            <h4 className={`text-xs font-semibold truncate transition ${isActiveSelection ? 'text-indigo-400' : 'text-slate-200 group-hover:text-indigo-400'}`}>{ev.title || 'Untitled Session'}</h4>
                            <span className="font-mono text-[9px] text-slate-500 block mt-0.5">{evKey}</span>
                          </div>
                          <span className="bg-slate-950 border border-slate-800/60 px-2 py-0.5 rounded-lg text-[9px] font-mono text-slate-400 shrink-0">
                            {activeDropsCount} Items
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl text-[11px] text-slate-500 font-mono italic">No scheduling events active.</div>
                )}
              </div>
            </div>

            {/* RIGHT DETAILED SUITE WORKSPACE CANVAS (65% WIDTH) */}
            <div className="md:col-span-8">
              {editingEventKey && config.events?.[editingEventKey] ? (() => {
                const ev = config.events[editingEventKey];
                return (
                  <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-xl animate-fadeIn">
                    
                    {/* CONFIG DESK CANVAS HEADER ELEMENT */}
                    <div className="flex justify-between items-center border-b border-slate-800/80 pb-3">
                      <div className="flex items-center gap-3 truncate pr-4">
                        <span className="bg-slate-950 px-2.5 py-1 rounded-lg text-slate-500 font-mono text-[10px] border border-slate-800 select-none">{editingEventKey}</span>
                        <input 
                          type="text"
                          value={ev.title || ''}
                          onChange={(e) => {
                            const updated = { ...config.events };
                            updated[editingEventKey].title = e.target.value;
                            setConfig(prev => ({ ...prev, events: updated }));
                          }}
                          className="bg-transparent text-sm font-semibold text-slate-100 outline-none border-b border-dashed border-slate-700 focus:border-indigo-500 font-sans transition py-0.5"
                        />
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          if (confirm("Permanently erase this Event Setting?")) {
                            handleRemoveEventNode(editingEventKey);
                          }
                        }}
                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-rose-400 uppercase font-bold tracking-wider transition cursor-pointer"
                      >
                        <IconTrash /> Delete Event
                      </button>
                    </div>

                    {/* ⏱️ UNIFIED LIFECYCLE TIMELINE: EXTRA COMPACT AND STACKED FOR 1-GLANCE VISIBILITY */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wide"><IconSliders /> Event Cycle Setting</div>
                      <div className="bg-slate-950/40 border border-slate-800/60 rounded-3xl p-5 relative space-y-4 select-none z-10">
                        <div className="absolute left-11 top-10 bottom-10 w-0.5 bg-indigo-500/80 shadow-[0_0_12px_rgba(99,102,241,0.8)] z-0" />
                        
                        {['1', '2', '3'].map((phaseNum) => {
                          const phase = ev.phases?.[phaseNum] || { dayStart: 0, timeStart: "00:00", dayEnd: 0, timeEnd: "00:00" };
                          const phaseLabels = { 1: 'Bid Request Open', 2: 'Bid Request Closed', 3: 'Event + Live Auction' };
                          const isPopoverOpen = activeAlarmPopoverId === phaseNum;

                          return (
                            <div key={phaseNum} className={`relative font-mono text-[11px] ${isPopoverOpen ? 'z-30' : 'z-10'}`}>
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/30 p-3 rounded-2xl border border-slate-800/40 hover:border-slate-800/80 transition-colors">
                                <div className="flex items-center gap-4">
                                  <div className="w-6 h-6 rounded-full bg-indigo-950 border-2 border-indigo-500 text-indigo-400 flex items-center justify-center font-sans font-bold shrink-0 shadow-[0_0_10px_rgba(99,102,241,0.6)]">
                                    {phaseNum}
                                  </div>
                                  <span className="font-sans font-medium text-slate-200">{phaseLabels[phaseNum]}</span>
                                </div>

                                <div className="flex items-center gap-3 relative">
                                  <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-800/60 rounded-xl px-3 py-1.5">
                                      <span className="font-sans text-[10px] text-slate-500 uppercase font-bold w-12 shrink-0">Start:</span>
                                      <select value={phase.dayStart} onChange={(e) => handlePhaseChange(editingEventKey, phaseNum, 'dayStart', e.target.value)} className="bg-transparent text-slate-300 outline-none cursor-pointer font-sans text-xs w-28 shrink-0" >
                                        {DAYS_OF_WEEK_MAP.map(d => <option key={d.value} value={d.value} className="bg-slate-950 text-slate-300">{d.label}</option>)}
                                      </select>
                                      <input type="text" maxLength="5" value={phase.timeStart} onChange={(e) => handlePhaseChange(editingEventKey, phaseNum, 'timeStart', e.target.value)} className="bg-slate-900 border border-slate-800 text-amber-500 rounded-lg px-2 py-0.5 text-center w-16 font-mono text-xs font-bold outline-none focus:border-indigo-500/40 shrink-0" />
                                    </div>

                                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-800/60 rounded-xl px-3 py-1.5">
                                      <span className="font-sans text-[10px] text-slate-500 uppercase font-bold w-12 shrink-0">End:</span>
                                      <select value={phase.dayEnd} onChange={(e) => handlePhaseChange(editingEventKey, phaseNum, 'dayEnd', e.target.value)} className="bg-transparent text-slate-300 outline-none cursor-pointer font-sans text-xs w-28 shrink-0" >
                                        {DAYS_OF_WEEK_MAP.map(d => <option key={d.value} value={d.value} className="bg-slate-950 text-slate-300">{d.label}</option>)}
                                      </select>
                                      <input type="text" maxLength="5" value={phase.timeEnd} onChange={(e) => handlePhaseChange(editingEventKey, phaseNum, 'timeEnd', e.target.value)} className="bg-slate-900 border border-slate-800 text-amber-400 rounded-lg px-2 py-0.5 text-center w-16 font-mono text-xs font-bold outline-none focus:border-indigo-500/40 shrink-0" />
                                    </div>
                                  </div>

                                  <button type="button" onClick={() => setActiveAlarmPopoverId(isPopoverOpen ? null : phaseNum)} className={`flex items-center justify-center w-10 h-10 rounded-xl border transition shadow-sm cursor-pointer shrink-0 ${isPopoverOpen ? 'bg-indigo-600 border-transparent text-white shadow-[0_0_10px_rgba(99,102,241,0.4)]' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-indigo-400 hover:border-indigo-500/40'}`} title="Configure Announcements">
                                    <IconBell />
                                  </button>

                                  {isPopoverOpen && (
                                    <>
                                      <div className="fixed inset-0 z-40" onClick={() => setActiveAlarmPopoverId(null)} />
                                      <div className="absolute right-0 top-full mt-2 bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-2xl z-50 w-72 space-y-2.5 font-sans animate-fadeIn">
                                        {phaseNum === '1' ? (
                                          <div className="space-y-2">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Current Bidders List Notifications (3)</span>
                                            <div className="flex flex-wrap gap-1.5 items-center">
                                              {(ev.announcements?.phase1 || ["07:00", "12:00", "19:00"]).map((time, idx) => (
                                                <div key={idx} className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 shadow-inner font-mono text-xs">
                                                  <input type="time" value={time} onChange={(e) => {
                                                      const updated = { ...config.events };
                                                      const currentAnnouncements = updated[editingEventKey].announcements || { phase1: ["07:00", "12:00", "19:00"], phase2: "22:15", phase3: "20:55" };
                                                      const updatedPhase1 = [...(currentAnnouncements.phase1 || [])];
                                                      updatedPhase1[idx] = e.target.value;
                                                      updated[editingEventKey].announcements = { ...currentAnnouncements, phase1: updatedPhase1 };
                                                      setConfig(prev => ({ ...prev, events: updated }));
                                                    }} className="bg-transparent text-slate-200 outline-none cursor-pointer" />
                                                  <button type="button" onClick={() => {
                                                      const updated = { ...config.events };
                                                      const currentAnnouncements = updated[editingEventKey].announcements || { phase1: ["07:00", "12:00", "19:00"], phase2: "22:15", phase3: "20:55" };
                                                      const updatedPhase1 = (currentAnnouncements.phase1 || []).filter((_, i) => i !== idx);
                                                      updated[editingEventKey].announcements = { ...currentAnnouncements, phase1: updatedPhase1 };
                                                      setConfig(prev => ({ ...prev, events: updated }));
                                                    }} className="text-slate-500 hover:text-rose-400 transition cursor-pointer" ><IconX /></button>
                                                </div>
                                              ))}
                                              {(ev.announcements?.phase1 || ["07:00", "12:00", "19:00"]).length < 3 && (
                                                <button type="button" onClick={() => {
                                                    const updated = { ...config.events };
                                                    const currentAnnouncements = updated[editingEventKey].announcements || { phase1: ["07:00", "12:00", "19:00"], phase2: "22:15", phase3: "20:55" };
                                                    const updatedPhase1 = [...(currentAnnouncements.phase1 || []), "12:00"];
                                                    updated[editingEventKey].announcements = { ...currentAnnouncements, phase1: updatedPhase1 };
                                                    setConfig(prev => ({ ...prev, events: updated }));
                                                  }} className="px-2.5 py-1 rounded-xl border border-dashed border-slate-700 bg-slate-950 text-slate-500 text-[10px] font-semibold cursor-pointer" >+ Add</button>
                                              )}
                                            </div>
                                          </div>
                                        ) : phaseNum === '2' ? (
                                          <div className="space-y-1.5">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Bid Close Notification</span>
                                            <div className="w-max bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 shadow-inner font-mono text-xs">
                                              <input type="time" value={ev.announcements?.phase2 || "22:15"} onChange={(e) => {
                                                  const updated = { ...config.events };
                                                  const currentAnnouncements = updated[editingEventKey].announcements || { phase1: ["07:00", "12:00", "19:00"], phase2: "22:15", phase3: "20:55" };
                                                  updated[editingEventKey].announcements = { ...currentAnnouncements, phase2: e.target.value };
                                                  setConfig(prev => ({ ...prev, events: updated }));
                                                }} className="bg-transparent text-slate-200 outline-none cursor-pointer" />
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="space-y-1.5">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Event Starts Notification</span>
                                            <div className="w-max bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 shadow-inner font-mono text-xs">
                                              <input type="time" value={ev.announcements?.phase3 || "20:55"} onChange={(e) => {
                                                  const updated = { ...config.events };
                                                  const currentAnnouncements = updated[editingEventKey].announcements || { phase1: ["07:00", "12:00", "19:00"], phase2: "22:15", phase3: "20:55" };
                                                  updated[editingEventKey].announcements = { ...currentAnnouncements, phase3: e.target.value };
                                                  setConfig(prev => ({ ...prev, events: updated }));
                                                }} className="bg-transparent text-slate-200 outline-none cursor-pointer" />
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* TAC-TILE LOOT CEILINGS LIST COMPONENT */}
                    <div className="bg-slate-950/40 border border-slate-800/80 p-4 rounded-xl space-y-3 shadow-inner flex flex-col justify-between">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-900 pb-2">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wider"><IconPackage /> Item & Quantity Limits</div>
                          <p className="text-[10px] text-slate-500 font-normal">Enforces maximum Bid caps across individual items.</p>
                        </div>
                        <select
                          onChange={(e) => {
                            if (!e.target.value) return;
                            handleUpdateEventLootLimit(editingEventKey, e.target.value, 'up');
                            e.target.value = '';
                          }}
                          className="bg-slate-900 border border-slate-800 text-[10px] font-medium rounded-lg px-2.5 py-1.5 outline-none text-slate-400 hover:text-white cursor-pointer font-sans"
                          defaultValue=""
                        >
                          <option value="" disabled>+ Add Item</option>
                          {config.items.map(mi => (
                            <option key={mi.id} value={mi.id} disabled={ev.loots?.[mi.id] !== undefined}>
                              {mi.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[140px] overflow-y-auto pr-0.5 scrollbar-thin pt-1">
                        {ev.loots && Object.keys(ev.loots).length > 0 ? (
                          Object.keys(ev.loots).map(lootItemId => {
                            const matchedItem = config.items.find(i => i.id === lootItemId) || { name: 'Unknown Item' };
                            const currentLimit = ev.loots[lootItemId] || 0;
                            return (
                              <div key={lootItemId} className="flex items-center justify-between bg-slate-900 border border-slate-800/50 p-2.5 rounded-xl text-xs shadow-sm font-mono">
                                <span className="text-slate-300 font-sans font-medium truncate pr-2 flex items-center gap-2"><IconPackage /> {matchedItem.name}</span>
                                <div className="flex items-center gap-2.5 select-none shrink-0">
                                  <button type="button" onClick={() => handleUpdateEventLootLimit(editingEventKey, lootItemId, 'down')} className="w-6 h-6 rounded bg-slate-950 border border-slate-800 text-slate-400 text-xs font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">-</button>
                                  <span className="text-xs font-bold text-amber-500 w-4 text-center">{currentLimit}</span>
                                  <button type="button" onClick={() => handleUpdateEventLootLimit(editingEventKey, lootItemId, 'up')} className="w-6 h-6 rounded bg-slate-950 border border-slate-800 text-slate-400 text-xs font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">+</button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="col-span-2 text-center py-6 text-[10px] text-slate-600 italic font-mono">No bound limit parameters mapped.</div>
                        )}
                      </div>
                    </div>

                  </div>
                );
              })() : (
                <div className="text-center py-16 bg-slate-900/10 border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500 font-mono italic">Select or initialize an event from the Left panel to view configurations.</div>
              )}
            </div>

          </div>

          {/* 🏷️ DYNAMIC SPECIAL EVENT CATEGORIES WORKSPACE */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 mt-6 space-y-4 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3.5">
              <div>
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <IconTag />
                  Special Event Classifications
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">Manage taxonomy tags available inside the calendar creation panel.</p>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text"
                  placeholder="New Category (e.g. Scrim)..."
                  id="newSpecialCatInput"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none min-w-[220px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target.value.trim()) {
                      const val = e.target.value.trim();
                      if (config.specialEventCategories?.includes(val)) return alert("Category already exists.");
                      const updatedCats = [...(config.specialEventCategories || ["Raid", "Meeting", "PVP", "Casual"]), val];
                      setConfig(prev => ({ ...prev, specialEventCategories: updatedCats }));
                      e.target.value = '';
                    }
                  }}
                />
                <button 
                  type="button"
                  onClick={() => {
                    const input = document.getElementById('newSpecialCatInput');
                    if (input && input.value.trim()) {
                      const val = input.value.trim();
                      if (config.specialEventCategories?.includes(val)) return alert("Category already exists.");
                      const updatedCats = [...(config.specialEventCategories || ["Raid", "Meeting", "PVP", "Casual"]), val];
                      setConfig(prev => ({ ...prev, specialEventCategories: updatedCats }));
                      input.value = '';
                    }
                  }}
                  className="flex items-center gap-1 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition text-white cursor-pointer"
                >
                  + Add Tag
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
              {(config.specialEventCategories || ["Raid", "Meeting", "PVP", "Casual"]).map((catName) => (
                <div key={catName} className="flex items-center justify-between bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl font-mono text-xs shadow-sm group hover:border-slate-700 transition">
                  <span className="text-amber-500 font-sans font-semibold flex items-center gap-1.5"><IconTag /> {catName}</span>
                  <button 
                    type="button"
                    onClick={() => {
                      const updatedCats = (config.specialEventCategories || ["Raid", "Meeting", "PVP", "Casual"]).filter(c => c !== catName);
                      setConfig(prev => ({ ...prev, specialEventCategories: updatedCats }));
                    }}
                    className="text-slate-600 hover:text-rose-400 font-bold transition cursor-pointer"
                  >
                    ✖
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      

      {/* PANEL 3: ACCESS GOVERNANCE */}
      {activeNavTab === 'roles' && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-md animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider"><IconShield /> Discord Role List</div>
              <p className="text-[10px] text-slate-500 mt-0.5">Pick Discord roles that should unlock Settings. Names are matched case-insensitively.</p>
            </div>
            <div className="flex gap-2">
              <input 
                type="text"
                placeholder="Or type a role name…"
                value={newRoleStr}
                onChange={(e) => setNewRoleStr(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none font-sans min-w-[270px]"
                onKeyDown={(e) => e.key === 'Enter' && handleAddRoleNode()}
              />
              <button 
                type="button"
                onClick={() => handleAddRoleNode()}
                className="flex items-center gap-1 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition cursor-pointer text-white"
              >
                <IconPlus /> Authorize
              </button>
            </div>
          </div>

          {discordRoles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {discordRoles.map((role) => {
                const selected = (config.adminRoles || []).some((name) => name.toLowerCase() === role.name.toLowerCase());
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleOfficerRole(role.name)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border ${
                      selected
                        ? 'border-indigo-500 bg-indigo-600 text-white'
                        : 'border-slate-800 bg-slate-950 text-slate-300'
                    }`}
                  >
                    {role.name}
                  </button>
                );
              })}
            </div>
          )}

          {config.adminRoles && config.adminRoles.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
              {config.adminRoles.map((role) => (
                <div key={role} className="flex items-center justify-between bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl font-mono text-xs shadow-sm group hover:border-slate-700 transition">
                  <span className="text-indigo-400 font-sans font-semibold flex items-center gap-2"><IconShield /> {role}</span>
                  <button 
                    type="button"
                    onClick={() => handleRemoveRoleNode(role)}
                    className="text-slate-600 hover:text-rose-400 text-[10px] font-bold transition cursor-pointer"
                  >
                    Remove ✖
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 font-mono py-6 text-center border border-dashed border-slate-800 rounded-xl">No officer Discord roles yet. Pick from this server’s roles above so those people can unlock Settings.</div>
          )}

          <div className="border-t border-slate-800/60 my-6" />

          {/* Live Raid War Settings */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider"><IconSliders /> Live Raid War Settings</div>
              <p className="text-[10px] text-slate-500 mt-0.5">Configure live raid restrictions for selected configurations and war rooms.</p>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Live Raid Max Configs Selectable</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={config.liveRaidMaxConfigs || 5}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 5;
                      setConfig(prev => ({ ...prev, liveRaidMaxConfigs: val }));
                    }}
                    className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-amber-500 font-mono font-bold text-center outline-none focus:border-indigo-500/40"
                  />
                  <span className="text-[10px] text-slate-500 font-medium">Configurations (Max 10)</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Live Raid War Room Select Limit</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={config.liveRaidMaxWarRooms || 2}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 2;
                      setConfig(prev => ({ ...prev, liveRaidMaxWarRooms: val }));
                    }}
                    className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-amber-500 font-mono font-bold text-center outline-none focus:border-indigo-500/40"
                  />
                  <span className="text-[10px] text-slate-500 font-medium">Rooms (Max 5)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800/60 my-6" />

          {/* Voice War Rooms Registry */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider"><IconGlobe /> Voice War Rooms Registry</div>
              <p className="text-[10px] text-slate-500 mt-0.5">Display names and Discord voice channel IDs for this guild (not Render env vars).</p>
            </div>

            <div className="space-y-2.5 max-w-4xl font-mono text-xs">
              {['room_001', 'room_002', 'room_003', 'room_004', 'room_005'].map((roomId, idx) => {
                const envKey = `DISCORD_WARROOM_ID_${idx + 1}`;
                const roomObj = config.warRooms?.[roomId] || { name: `War room ${idx + 1}`, envKey };
                const channelId = discordChannels.warRooms?.[roomObj.envKey || envKey] || '';
                return (
                  <div 
                    key={roomId}
                    className="grid grid-cols-12 items-center gap-3 border bg-slate-950/30 border-slate-900 p-2.5 rounded-xl shadow-sm group hover:border-slate-700 hover:bg-slate-900/10 transition-all duration-150"
                  >
                    <span className="col-span-2 text-[10px] text-slate-500 font-semibold tracking-tight select-none">
                      Room {idx + 1}
                    </span>
                    <input 
                      type="text"
                      value={roomObj.name || ''}
                      onChange={(e) => {
                        const updatedWarRooms = {
                          ...config.warRooms,
                          [roomId]: {
                            ...roomObj,
                            envKey: roomObj.envKey || envKey,
                            name: e.target.value
                          }
                        };
                        setConfig(prev => ({ ...prev, warRooms: updatedWarRooms }));
                      }}
                      className="col-span-5 bg-transparent border border-transparent focus:bg-slate-950 focus:border-slate-850 hover:border-slate-800 rounded-xl px-3 py-1 text-xs text-slate-200 outline-none font-sans font-medium transition shadow-none focus:shadow-inner"
                      placeholder="Display name"
                    />
                    <input
                      type="text"
                      value={channelId}
                      onChange={(e) => {
                        const key = roomObj.envKey || envKey;
                        setDiscordChannels((prev) => ({
                          ...prev,
                          warRooms: { ...prev.warRooms, [key]: e.target.value.trim() },
                        }));
                      }}
                      className="col-span-5 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1 text-xs text-slate-300 font-mono outline-none focus:border-slate-700"
                      placeholder="Voice channel ID"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* PANEL 4: MASTER INVENTORY CATALOG REGISTRY (READ-ONLY TILL INTERACTION) */}
      {activeNavTab === 'items' && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-md animate-fadeIn">
          <div className="flex justify-between items-center border-b border-slate-800/60 pb-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider"><IconPackage /> Master Inventory Registry</div>
              <p className="text-[10px] text-slate-500 mt-0.5">The primary catalog that sets fixed item for all events.</p>
            </div>
            <button 
              type="button"
              onClick={handleAddItemNode}
              className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-md text-white"
            >
              <IconPlus /> Register New Entry
            </button>
          </div>

          <div className="space-y-2 max-w-4xl">
            {config.items && config.items.length > 0 ? (
              config.items.map((item, index) => (
                <div 
                  key={item.id} 
                  className="grid grid-cols-12 items-center gap-3 border bg-slate-950/30 border-slate-900 p-1.5 rounded-xl font-mono shadow-sm group hover:border-slate-800 hover:bg-slate-950/80 transition-all duration-150"
                >
                  <span className="col-span-1 text-slate-600 font-bold text-center text-xs select-none">#{String(index + 1).padStart(2, '0')}</span>
                  <span className="col-span-2 text-[10px] text-slate-500 font-semibold tracking-tight select-none">{item.id}</span>
                  
                  {/* UNIFIED INTERACTIVE INTERACTION LAYER */}
                  <input 
                    type="text"
                    value={item.name || ''}
                    onChange={(e) => {
                      const updated = config.items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i);
                      setConfig(prev => ({ ...prev, items: updated }));
                    }}
                    className="col-span-3 bg-transparent border border-transparent focus:bg-slate-950 focus:border-slate-700/80 hover:border-slate-800/40 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none font-sans font-medium transition shadow-none focus:shadow-inner"
                    placeholder="Loot Tracker Label..."
                  />

                  {/* DYNAMIC CHROMATIC SYSTEM COLOR PICKER */}
                  <div className="col-span-3 flex items-center gap-3 bg-slate-900/40 border border-slate-800/60 rounded-xl px-3 h-9 max-w-[240px] shrink-0">
                    <div 
                      className="relative w-5 h-5 rounded-md border border-slate-700/80 shadow-md transition transform hover:scale-115 active:scale-95 cursor-pointer overflow-hidden shrink-0" 
                      style={{ 
                        backgroundColor: item.colorTheme?.startsWith('#') ? item.colorTheme : '#64748b',
                        boxShadow: item.colorTheme?.startsWith('#') ? `0 0 12px ${item.colorTheme}50` : 'none'
                      }}
                    >
                      <input 
                        type="color" 
                        value={item.colorTheme?.startsWith('#') ? item.colorTheme : '#64748b'} 
                        onChange={(e) => {
                          const updated = config.items.map(i => i.id === item.id ? { ...i, colorTheme: e.target.value } : i);
                          setConfig(prev => ({ ...prev, items: updated }));
                        }}
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer scale-150"
                        title="Open System Color Wheel"
                      />
                    </div>
                    <span className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-widest select-all">
                      {item.colorTheme?.startsWith('#') ? item.colorTheme : '#DEFAULT'}
                    </span>
                  </div>

                  {/* 💰 HIGH VALUE PRECIOUS ITEM TOGGLE: Absent outcomes retain priority instead of resetting it */}
                  <div className="col-span-2 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = config.items.map(i => i.id === item.id ? { ...i, isHighValue: !i.isHighValue } : i);
                        setConfig(prev => ({ ...prev, items: updated }));
                      }}
                      className={`flex items-center justify-center w-9 h-9 rounded-xl border transition cursor-pointer shrink-0 ${
                        item.isHighValue
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                          : 'bg-slate-900/40 border-slate-800 text-slate-600 hover:text-slate-400 hover:border-slate-700'
                      }`}
                      title={item.isHighValue ? 'High Value: Absent outcomes retain priority (click to unset)' : 'Mark as High Value item'}
                    >
                      <IconMoneyBag />
                    </button>
                  </div>

                  {/* PURGE ELEMENT RECORD */}
                  <div className="col-span-1 flex items-center justify-end pr-2">
                    <button 
                      type="button"
                      onClick={() => setConfig(prev => ({ ...prev, items: prev.items.filter(i => i.id !== item.id) }))}
                      className="text-slate-700 hover:text-rose-400 p-1 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                      title="Purge inventory item node from database parameters"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500 font-mono italic">No inventory nodes active.</div>
            )}
          </div>
        </div>
      )}

      {/* PERSISTENT RUNTIME ACTION DECK PILL FOOTER SECTION TRACK */}

      {/* PANEL 5: DYNAMIC CHROMATIC JOB REGISTRY DESK */}
      {activeNavTab === 'jobs' && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-md animate-fadeIn">
          <div className="flex justify-between items-center border-b border-slate-800/60 pb-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider"><IconShield /> Character Job Registry</div>
              <p className="text-[10px] text-slate-500 mt-0.5">The absolute master list defining player classes available across roster updates.</p>
            </div>
            <button 
              type="button"
              onClick={() => {
                const updatedJobs = { ...config.jobs };
                const nextIndex = Object.keys(updatedJobs).length + 1;
                const jobCode = `job_${String(nextIndex).padStart(3, '0')}`;
                updatedJobs[jobCode] = { name: `Custom Specialization ${nextIndex}`, colorTheme: '#3b82f6' };
                setConfig(prev => ({ ...prev, jobs: updatedJobs }));
              }}
              className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-md text-white"
            >
              <IconPlus /> Add Job Assignment
            </button>
          </div>

          <div className="space-y-2 max-w-4xl">
            {config.jobs && Object.keys(config.jobs).length > 0 ? (
              Object.entries(config.jobs).map(([code, jobObj], index) => (
                <div 
                  key={code} 
                  className="grid grid-cols-12 items-center gap-3 border bg-slate-950/30 border-slate-900 p-1.5 rounded-xl font-mono shadow-sm group hover:border-slate-800 hover:bg-slate-950/80 transition-all duration-150"
                >
                  <span className="col-span-1 text-slate-600 font-bold text-center text-xs select-none">#{String(index + 1).padStart(2, '0')}</span>
                  <span className="col-span-2 text-[10px] text-slate-500 font-semibold tracking-tight select-none">{code}</span>
                  
                  <input 
                    type="text"
                    value={jobObj.name || ''}
                    onChange={(e) => {
                      const updatedJobs = { ...config.jobs };
                      updatedJobs[code].name = e.target.value;
                      setConfig(prev => ({ ...prev, jobs: updatedJobs }));
                    }}
                    className="col-span-3 bg-transparent border border-transparent focus:bg-slate-950 focus:border-slate-700/80 hover:border-slate-800/40 rounded-xl px-2 py-1.5 text-xs text-slate-200 outline-none font-sans font-medium transition shadow-none focus:shadow-inner"
                    placeholder="Job Title (e.g. Bard)..."
                  />

                  <div className="col-span-3 flex items-center gap-3 bg-slate-900/40 border border-slate-800/60 rounded-xl px-3 h-9 shrink-0">
                    <div 
                      className="relative w-5 h-5 rounded-md border border-slate-700/80 shadow-md transition transform hover:scale-105 cursor-pointer overflow-hidden shrink-0" 
                      style={{ backgroundColor: jobObj.colorTheme || '#64748b' }}
                    >
                      <input 
                        type="color" 
                        value={jobObj.colorTheme || '#3b82f6'} 
                        onChange={(e) => {
                          const updatedJobs = { ...config.jobs };
                          updatedJobs[code].colorTheme = e.target.value;
                          setConfig(prev => ({ ...prev, jobs: updatedJobs }));
                        }}
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer scale-150"
                        title="Choose Custom Job Color Mapping"
                      />
                    </div>
                    <span className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-widest select-all">
                      {jobObj.colorTheme || '#DEFAULT'}
                    </span>
                  </div>

                  <select
                    value={jobObj.iconFile || ''}
                    onChange={(e) => {
                      const updatedJobs = { ...config.jobs };
                      updatedJobs[code].iconFile = e.target.value;
                      setConfig(prev => ({ ...prev, jobs: updatedJobs }));
                    }}
                    className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-[11px] text-slate-300 font-semibold outline-none cursor-pointer focus:border-slate-700 transition-colors"
                  >
                    <option value="">-- No Icon --</option>
                    <option value="acolyte.svg">Acolyte</option>
                    <option value="archer.svg">Archer</option>
                    <option value="doram.svg">Doram</option>
                    <option value="mage.svg">Mage</option>
                    <option value="merchant.svg">Merchant</option>
                    <option value="rebellion.svg">Rebellion</option>
                    <option value="swordsman.svg">Swordsman</option>
                    <option value="thief.svg">Thief</option>
                  </select>

                  <div className="col-span-1 flex items-center justify-end pr-2">
                    <button 
                      type="button"
                      onClick={() => {
                        const updatedJobs = { ...config.jobs };
                        delete updatedJobs[code];
                        setConfig(prev => ({ ...prev, jobs: updatedJobs }));
                      }}
                      className="text-slate-700 hover:text-rose-400 p-1 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                      title="Purge job assignment profile"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500 font-mono italic">No custom classes active.</div>
            )}
          </div>
        {/* DYNAMIC GAME ROLE TAXONOMY REGISTRY SECTION */}
          <div className="border-t border-slate-800/60 pt-6 mt-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800/60 pb-3.5">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider"><IconTag /> Game Role Registry</div>
                <p className="text-[10px] text-slate-500 mt-0.5">Define tactical archetypes (e.g. DPS, Tank, Support) manageable under relational IDs.</p>
              </div>
              <button 
                type="button"
                onClick={() => {
                  const updatedRoles = { ...config.roles };
                  const nextIndex = Object.keys(updatedRoles).length + 1;
                  const roleCode = `role_${String(nextIndex).padStart(3, '0')}`;
                  updatedRoles[roleCode] = { name: `Custom Archetype ${nextIndex}` };
                  setConfig(prev => ({ ...prev, roles: updatedRoles }));
                }}
                className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-md text-white"
              >
                <IconPlus /> Add Game Role
              </button>
            </div>

            <div className="space-y-2 max-w-4xl">
              {config.roles && Object.keys(config.roles).length > 0 ? (
                Object.entries(config.roles).map(([code, roleObj], index) => (
                  <div 
                    key={code} 
                    className="grid grid-cols-12 items-center gap-3 border bg-slate-950/30 border-slate-900 p-1.5 rounded-xl font-mono shadow-sm group hover:border-slate-800 hover:bg-slate-950/80 transition-all duration-150"
                  >
                    <span className="col-span-1 text-slate-600 font-bold text-center text-xs select-none">#{String(index + 1).padStart(2, '0')}</span>
                    <span className="col-span-2 text-[10px] text-slate-500 font-semibold tracking-tight select-none">{code}</span>
                    
                    <input 
                      type="text"
                      value={roleObj.name || ''}
                      onChange={(e) => {
                        const updatedRoles = { ...config.roles };
                        updatedRoles[code].name = e.target.value;
                        setConfig(prev => ({ ...prev, roles: updatedRoles }));
                      }}
                      className="col-span-8 bg-transparent border border-transparent focus:bg-slate-950 focus:border-slate-700/80 hover:border-slate-800/40 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none font-sans font-medium transition shadow-none focus:shadow-inner"
                      placeholder="Role Title (e.g. Main Tank)..."
                    />

                    <div className="col-span-1 flex items-center justify-end pr-2">
                      <button 
                        type="button"
                        onClick={() => {
                          const updatedRoles = { ...config.roles };
                          delete updatedRoles[code];
                          setConfig(prev => ({ ...prev, roles: updatedRoles }));
                        }}
                        className="text-slate-700 hover:text-rose-400 p-1 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                        title="Purge game role profile"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500 font-mono italic">No custom game roles active.</div>
              )}
            </div>
          </div>

        </div>
      )}

      {activeNavTab === 'members' && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-md animate-fadeIn">
          <div className="border-b border-slate-800/60 pb-3.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">Members</div>
            <p className="text-[10px] text-slate-500 mt-0.5">Monthly leave-credit allotment for raid-roster members. Remaining credits live on each member profile and reset to this number on the 1st of every month (guild timezone).</p>
          </div>
          <div className="flex items-center gap-3 bg-slate-950/40 border border-slate-800 rounded-xl px-4 py-3 max-w-md">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider shrink-0">Default Leave Credits</label>
            <input
              type="number"
              min="0"
              max="99"
              value={config.defaultLeaveCredits ?? 3}
              onChange={(e) => {
                const parsed = e.target.value === '' ? 3 : parseInt(e.target.value, 10);
                setConfig((prev) => ({ ...prev, defaultLeaveCredits: Number.isNaN(parsed) ? 3 : Math.max(0, parsed) }));
              }}
              className="w-20 bg-slate-900 border border-slate-800 rounded-lg py-1.5 text-xs text-amber-500 font-mono font-bold text-center outline-none focus:border-slate-700"
            />
            <span className="text-[11px] text-slate-400">per member / month</span>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-900 bg-slate-950/90 backdrop-blur-md p-4 z-50 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
        <div className="mx-auto max-w-5xl flex items-center justify-end gap-4">
          <button 
            type="button"
            onClick={handleSaveWorkspaceChanges} 
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition shadow-xl cursor-pointer"
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}