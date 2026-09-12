// frontend/src/pages/MimicBookTab.jsx
import { useState, useEffect, useRef, useContext } from 'react';
import { MimicBookContext } from '../App';

// 🌐 Absolute target network routing parameters for cross-domain Vercel/Render deployments
const backendUrl = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:5001';

// --- 🎨 PURE VECTOR MICRO-ICONS CONSOLE ---
const IconSync = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/></svg>;
const IconHistory = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const IconShield = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const IconTarget = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>;
const IconPlus = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>;
const IconTrash = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>;
const IconX = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>;
const IconBook = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>;
const IconEye = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
const IconUser = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconChevron = ({ direction = "right" }) => {
  const rotations = { left: "rotate-180", right: "", up: "-rotate-90", down: "rotate-90" };
  return <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${rotations[direction] || ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7"/></svg>;
};

export default function MimicBookTab({ user }) {
  const IconUndo = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>;
  const IconBullseye = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>;
  const IconTerminal = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;

  // 🏛️ CENTRALIZED USER INTENT PERMISSION RESOLVER
  const isOfficer = user?.isOfficer === true;

  const {
    isAdminMode, setIsAdminMode, activeStep, setActiveStep, loadingPool, setLoadingPool,
    isLootHistoryOpen, setIsLootHistoryOpen, loadingLootHistory, setLoadingLootHistory,
    lootHistoryData, setLootHistoryData, expandedGroups, setExpandedGroups,
    commitEvent, setCommitEvent, availableEvents, setAvailableEvents, commitDate, setCommitDate,
    committing, setCommittingSetting, syncingRoster, setSyncingRoster, items, setItems,
    rankingsByItem, setRankingsByItem, requestsByItemDetails, setRequestsByItemDetails,
    masterGuildRoster, setMasterGuildRoster, qtyPerPage, setQtyPerPage, lootRows, setLootRows,
    lootSummary, setLootSummary, validationError, setValidationError, liveGapsWarning, setLiveGapsWarning,
    activeMatrixFilter, setActiveMatrixFilter, categoryAllocations, setCategoryAllocations,
    initialWinnersByItem, setInitialWinnersByItem, isDiscordGateOpen, setIsDiscordGateOpen,
    sidebarTab, setSidebarTab, sidebarSearch, setSidebarSearch, viewLens, setViewLens,
    searchQuery, setSearchQuery, bookCurrentPage, setBookCurrentPage, generatedSlots, setGeneratedSlots,
    autoCommitArmed, setAutoCommitArmed,
    lastLocalWriteTimeRef, clientVersionRef
  } = useContext(MimicBookContext);

  const popoverAnchorRef = useRef(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState(null);
  const isUserDraggingRef = useRef(false);

  useEffect(() => {
    setIsAdminMode(isOfficer);
  }, [user, isOfficer]);

const [rawMembers, setRawMembers] = useState({});

  // Builds an internal lowercase lookup map for dragging text name assignments safely
  const nameToUidMap = {};
  Object.entries(rawMembers).forEach(([uid, m]) => {
    if (m?.displayName) {
      nameToUidMap[m.displayName.trim().toLowerCase()] = uid;
    }
  });

  const resolveDisplayName = (value) => {
    if (!value) return '';
    // If the database value is a pure numeric UID string, pull its live display name from the map
    if (/^\d+$/.test(value)) {
      return rawMembers[value]?.displayName || value;
    }
    return value;
  };

// 🔄 REAL-TIME GEOMETRIC CALCULATION ENGINE: Derives book layout positions from the Single Source of Truth
  useEffect(() => {
    if (!items || items.length === 0) return;

    let currentVirtualPage = 1, currentVirtualSlot = 1;
    const matrixSlots = [];

    items.forEach(item => {
    // 🛡️ Type Guard: Ensures object maps generated by Firebase under high-concurrency are normalized back to arrays
    const rawSelectedNode = categoryAllocations[item.id]?.selected;
    const flatBoxArray = Array.isArray(rawSelectedNode)
      ? rawSelectedNode
      : Object.values(rawSelectedNode || {});

    flatBoxArray.forEach((playerName, index) => {
        matrixSlots.push({
          name: playerName === "" ? "" : playerName,
          itemType: item.id,
          itemName: item.name,
          index: index, // Stores the exact sequential row index
          page: currentVirtualPage,
          slot: currentVirtualSlot,
          status: playerName === "" ? 'NotSelected' : 'Selected'
        });

        currentVirtualSlot++;
        if (currentVirtualSlot > qtyPerPage) {
          currentVirtualSlot = 1;
          currentVirtualPage++;
        }
      });
    });

    setGeneratedSlots(matrixSlots);
  }, [categoryAllocations, items, qtyPerPage]);
  // --- COORDINATE SEQUENCE GAP ENGINE ---
  useEffect(() => {
    if (lootRows.length <= 1) {
      setLiveGapsWarning('');
      return;
    }
    const linearRows = lootRows.map(r => ({
      ...r,
      startLin: (Math.max(1, r.startPage) - 1) * qtyPerPage + (Math.max(1, r.startPos) - 1),
      endLin: (Math.max(1, r.endPage) - 1) * qtyPerPage + (Math.max(1, r.endPos) - 1)
    })).sort((a, b) => a.startLin - b.startLin);

    const missingBlocks = [];
    for (let i = 0; i < linearRows.length - 1; i++) {
      const currentEnd = linearRows[i].endLin;
      const nextStart = linearRows[i + 1].startLin;
      if (nextStart > currentEnd + 1) {
        const gapStartLin = currentEnd + 1;
        const gapPage = Math.floor(gapStartLin / qtyPerPage) + 1;
        const gapPos = (gapStartLin % qtyPerPage) + 1;
        missingBlocks.push(`Page ${gapPage} Slot ${gapPos}`);
      }
    }
    setLiveGapsWarning(missingBlocks.length > 0 ? `⚠️ GAP WARNING: Unallocated grid sequence boxes skipped at: ${missingBlocks.join(', ')}` : '');
  }, [lootRows, qtyPerPage]);

  const loadTrueRequestPool = async () => {
    try {
      setLoadingPool(true);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }
      const res = await fetch(`${backendUrl}/api/requests/init`, { method: 'GET', headers: customHeaders, credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setRankingsByItem(data.rankingsByItem || {});
        setRequestsByItemDetails(data.requestsByItemDetails || {});
        setMasterGuildRoster(data.fullRoster || []);
        setRawMembers(data.members || {});
        // 🛡️ Payload Alignment Pass: Cache dynamic custom event titles natively to unlock modular dropdown loops
      if (data.events) {
        setAvailableEvents(data.events);
        setCommitEvent(data.eventName || "No Active Target Event Scheduled");
      }
      }
    } catch (err) {
      console.error("Failed to fetch current request pool:", err);
    } finally {
      setSyncingRoster(false);
    }
  };

  // Safe fallback initializing default rows only if server confirms database cache is clean
  useEffect(() => {
    if (items.length > 0 && !activeMatrixFilter && lootRows.length === 0) {
      const fallbackItem = items[0];
      setActiveMatrixFilter(fallbackItem.id);
      setLootRows([{ id: 1, itemType: fallbackItem.id, startPage: 1, startPos: 1, endPage: 1, endPos: 4, limit: fallbackItem.limitQty || 1 }]);
    }
  }, [items, activeMatrixFilter, lootRows]);
  const handleSyncRosterFromDiscord = async () => {
    try {
      setSyncingRoster(true);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }
      const res = await fetch(`${backendUrl}/api/requests/sync-roster`, { method: 'POST', headers: customHeaders, credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        alert(`SUCCESS: Realtime Roster sync complete!`);
        loadTrueRequestPool(); 
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSyncingRoster(false);
    }
  };

  const fetchLootHistoryLog = async () => {
    try {
      setLoadingLootHistory(true);
      setExpandedGroups({}); 
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }
      const res = await fetch(`${backendUrl}/api/requests/loot-history`, { method: 'GET', headers: customHeaders, credentials: 'include' });
      const data = await res.json();
      if (data.success) setLootHistoryData(data.history || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLootHistory(false);
    }
  };

  const fetchActiveSessionFromBackend = async (isInitialMount = false) => {
    if (isUserDraggingRef.current) return; 
    try {
    // 🛡️ CIRCUIT BREAKER: Mute background poll snapshots if user performed a local write within 4 seconds
      if (!isInitialMount && (Date.now() - lastLocalWriteTimeRef.current < 4000)) return;

      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }

      const res = await fetch(`${backendUrl}/api/requests/active-session`, { 
        method: 'GET', 
        headers: {
          ...customHeaders,
          ...(backendUrl.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {})
        }, 
        credentials: 'include' 
      });
    const data = await res.json();
    if (data.success && data.session) {
      const s = data.session;

      // 🔒 OPTIMISTIC FENCE: Stale background frames are dropped, but initial mounts bypass checking to restore database variables authoritatively
        if (!isInitialMount && s.version !== undefined && s.version <= clientVersionRef.current) return;
        clientVersionRef.current = s.version || 0;

      if (s.activeStep !== undefined) {
        setActiveStep(s.activeStep);
      }
      if (s.lootRows) setLootRows(s.lootRows);
      if (s.lootSummary) setLootSummary(s.lootSummary);
      if (s.categoryAllocations) setCategoryAllocations(s.categoryAllocations);
      if (s.initialWinnersByItem) setInitialWinnersByItem(s.initialWinnersByItem);
      if (s.generatedSlots) setGeneratedSlots(s.generatedSlots);
      if (s.activeMatrixFilter) setActiveMatrixFilter(s.activeMatrixFilter);
      if (s.sidebarTab) setSidebarTab(s.sidebarTab);
      if (s.isDiscordGateOpen !== undefined) setIsDiscordGateOpen(s.isDiscordGateOpen);
      if (s.autoCommitArmed !== undefined) setAutoCommitArmed(s.autoCommitArmed);
    } else if (isInitialMount) {
        // Defensive Initialization Guard: Network dropouts or temporary auth latency must never destructively wipe progress fields back to zero
        console.warn("⚠️ [INITIAL SYNC PENDING]: Handshake latency detected; waiting for subsequent background poller stream to clear the gate.");
      }
    } catch (err) {
      if (isInitialMount) console.error(err);
    }
  };

  const pushActiveSessionToBackend = async (updatedWorkspaceSnapshot) => {
    if (!isOfficer) return;
    try {
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }
      await fetch(`${backendUrl}/api/requests/update-session`, {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({ session: updatedWorkspaceSnapshot }),
        credentials: 'include'
      });
    } catch (err) {
      console.error(err);
    }
  };

  const saveWorkspaceState = (updatedStateFields) => {
    if (!isOfficer) return;
      // Increment sequencing boundaries and pin mutation timestamp to trigger circuit breaker
    clientVersionRef.current += 1;
    lastLocalWriteTimeRef.current = Date.now();

    // 1. Instantly resolve local state hook handlers to ensure seamless browser rendering response
    if (updatedStateFields.activeStep !== undefined) setActiveStep(updatedStateFields.activeStep);
    if (updatedStateFields.lootRows) setLootRows(updatedStateFields.lootRows);
    if (updatedStateFields.lootSummary) setLootSummary(updatedStateFields.lootSummary);
    if (updatedStateFields.categoryAllocations) setCategoryAllocations(updatedStateFields.categoryAllocations);
    if (updatedStateFields.initialWinnersByItem) setInitialWinnersByItem(updatedStateFields.initialWinnersByItem);
    if (updatedStateFields.generatedSlots) setGeneratedSlots(updatedStateFields.generatedSlots);
    if (updatedStateFields.activeMatrixFilter) setActiveMatrixFilter(updatedStateFields.activeMatrixFilter);
    if (updatedStateFields.sidebarTab) setSidebarTab(updatedStateFields.sidebarTab);
    if (updatedStateFields.isDiscordGateOpen !== undefined) setIsDiscordGateOpen(updatedStateFields.isDiscordGateOpen);
    if (updatedStateFields.autoCommitArmed !== undefined) setAutoCommitArmed(updatedStateFields.autoCommitArmed);

    // 2. Build a sanitized transactional data map to send to Firebase, leaving visual states local
    // NOTE: /update-session REPLACES the whole node, so every field must be present on
    // each save or it gets wiped — always re-send autoCommitArmed from the latest value.
    const transactionalSnapshot = {
      activeStep: updatedStateFields.activeStep !== undefined ? updatedStateFields.activeStep : activeStep,
      lootRows: updatedStateFields.lootRows || lootRows,
      lootSummary: updatedStateFields.lootSummary || lootSummary,
      categoryAllocations: updatedStateFields.categoryAllocations || categoryAllocations,
      initialWinnersByItem: updatedStateFields.initialWinnersByItem || initialWinnersByItem,
      isDiscordGateOpen: updatedStateFields.isDiscordGateOpen !== undefined ? updatedStateFields.isDiscordGateOpen : isDiscordGateOpen,
      autoCommitArmed: updatedStateFields.autoCommitArmed !== undefined ? updatedStateFields.autoCommitArmed : autoCommitArmed,
      version: clientVersionRef.current
    };

    pushActiveSessionToBackend(transactionalSnapshot);
  };

  useEffect(() => {
    loadTrueRequestPool();
    fetchActiveSessionFromBackend(true);
    const pollerInterval = setInterval(() => { fetchActiveSessionFromBackend(false); }, 3500);
    return () => clearInterval(pollerInterval);
  }, [user]);

  const handleAddLootRow = () => {
    if (!isAdminMode || !isOfficer || items.length === 0) return;
    const nextId = lootRows.length > 0 ? Math.max(...lootRows.map(r => r.id)) + 1 : 1;
    let derivedStartPage = 1, derivedStartPos = 1;

    if (lootRows.length > 0) {
      const lastRow = lootRows[lootRows.length - 1];
      let calcPos = lastRow.endPos + 1;
      let calcPage = lastRow.endPage;
      if (calcPos > qtyPerPage) {
        calcPos = 1;
        calcPage += 1;
      }
      derivedStartPage = calcPage;
      derivedStartPos = calcPos;
    }

    const historicalEventKeys = Object.keys(availableEvents || {});
    const selectedEventObj = Object.values(availableEvents || {}).find(ev => ev.title === commitEvent) || (historicalEventKeys.length > 0 ? availableEvents[historicalEventKeys[0]] : null);
    const allowedLootIds = selectedEventObj?.loots ? Object.keys(selectedEventObj.loots) : [];
    const defaultTypeId = allowedLootIds[0] || (items[0]?.id || '');
    const defaultLimit = selectedEventObj?.loots?.[defaultTypeId] || 1;

    const updatedRows = [
      ...lootRows, 
      { id: nextId, itemType: defaultTypeId, startPage: derivedStartPage, startPos: derivedStartPos, endPage: derivedStartPage, endPos: derivedStartPos, limit: defaultLimit }
    ];
    saveWorkspaceState({ lootRows: updatedRows });
  };

  const handleRemoveLootRow = (id) => {
    if (!isAdminMode || !isOfficer) return;
    const updatedRows = lootRows.filter(r => r.id !== id);
    saveWorkspaceState({ lootRows: updatedRows });
  };

  // 🗑️ SANDBOX PURGE CONTROLLER: Overwrites active cache values with a clear blueprint tree to wipe memory mistakes
  const handleWipeStagingSandbox = async () => {
    if (!isAdminMode || !isOfficer || items.length === 0) return;
    if (!window.confirm("⚠️ DANGER: This will completely erase your active staging session and clear out all uncommitted changes. Are you sure you want to reset?")) return;

    const defaultFirstItem = items[0]?.id || '';
    const clearSessionBlueprint = {
      activeStep: 1,
      qtyPerPage: 4,
      lootRows: [{ id: 1, itemType: defaultFirstItem, startPage: 1, startPos: 1, endPage: 1, endPos: 4, limit: items[0]?.limitQty || 1 }],
      lootSummary: {},
      categoryAllocations: {},
      initialWinnersByItem: {},
      activeMatrixFilter: defaultFirstItem,
      sidebarTab: 'standby',
      isDiscordGateOpen: false,
      version: 0
    };

    // Reset fencing parameters and activate circuit breaker for the manual session purge
    clientVersionRef.current = 0;
    lastLocalWriteTimeRef.current = Date.now();

    // Force an instantaneous update pass across the network to secure sync state positioning
    await pushActiveSessionToBackend(clearSessionBlueprint);
    
    // Locally reset your execution handles back to defaults
    setLootRows(clearSessionBlueprint.lootRows);
    setLootSummary(clearSessionBlueprint.lootSummary);
    setCategoryAllocations(clearSessionBlueprint.categoryAllocations);
    setInitialWinnersByItem(clearSessionBlueprint.initialWinnersByItem);
    setGeneratedSlots([]);
    setActiveMatrixFilter(clearSessionBlueprint.activeMatrixFilter);
    setSidebarTab(clearSessionBlueprint.sidebarTab);
    setActiveStep(1);
  };

  const handleUpdateLootRow = (id, key, val) => {
    if (!isAdminMode || !isOfficer) return;
    const updatedRows = lootRows.map(r => {
      if (r.id !== id) return r;
      let updatedFields = { [key]: val };

      if (key === 'startPos' || key === 'endPos') {
        const parsedVal = parseInt(val, 10) || 1;
        updatedFields[key] = Math.min(Math.max(1, parsedVal), qtyPerPage);
      }
      if (key === 'startPage' || key === 'endPage') {
        const parsedPage = parseInt(val, 10) || 1;
        updatedFields[key] = Math.max(1, parsedPage);
      }
      if (key === 'itemType') {
        // Prefer an existing Actual Bid Limit already set for this item type; else seed from Settings
        const sibling = lootRows.find(row => row.id !== id && row.itemType === val);
        if (sibling?.limit >= 1) {
          updatedFields.limit = sibling.limit;
        } else {
          const selectedEventObj = Object.values(availableEvents).find(ev => ev.title === commitEvent) || Object.values(availableEvents)[0];
          updatedFields.limit = selectedEventObj?.loots?.[val] || 1;
        }
      }
      return { ...r, ...updatedFields };
    });
    saveWorkspaceState({ lootRows: updatedRows });
  };

  // Phase 3 Actual Bid Limit: session-only override (per itemType). Never mutates Settings.
  const handleUpdateActualBidLimit = (rowId, nextLimitRaw) => {
    if (!isAdminMode || !isOfficer) return;
    const targetRow = lootRows.find(r => r.id === rowId);
    if (!targetRow) return;

    const nextLimit = Math.max(1, parseInt(nextLimitRaw, 10) || 1);
    const itemType = targetRow.itemType;

    const updatedRows = lootRows.map(r =>
      r.itemType === itemType ? { ...r, limit: nextLimit } : r
    );

    // Always upsert lootSummary.limit so Discord claim caps stay aligned (pre- and post-allocate)
    const current = lootSummary[itemType] || { qty: 0, seats: 0 };
    const qty = current.qty || 0;
    saveWorkspaceState({
      lootRows: updatedRows,
      lootSummary: {
        ...lootSummary,
        [itemType]: {
          ...current,
          limit: nextLimit,
          seats: Math.floor(qty / nextLimit)
        }
      }
    });
  };

  // Safety checks shield database engine loop from crashing if async records haven't loaded
  const handleCheckAndRegisterLoot = () => {
    if (!isAdminMode || !isOfficer || items.length === 0) return;
    setValidationError('');
    
    const calculatedSummary = {};
    const initialAllocations = {};
    const initialWinnersTrack = {};

    const selectedEventObj = Object.values(availableEvents).find(ev => ev.title === commitEvent) || Object.values(availableEvents)[0];
    const activeLoots = selectedEventObj?.loots || {};

    items.forEach(item => {
      calculatedSummary[item.id] = { qty: 0, limit: activeLoots[item.id] || 1, seats: 0 };
      initialWinnersTrack[item.id] = [];
    });

    const sortedRows = [...lootRows].sort((a, b) => a.startPage - b.startPage || a.startPos - b.startPos);

    for (let i = 0; i < sortedRows.length; i++) {
      const row = sortedRows[i];
      const startLinear = (row.startPage * qtyPerPage) + row.startPos;
      const endLinear = (row.endPage * qtyPerPage) + row.endPos;

      if (endLinear < startLinear) {
        setValidationError(`Row ${i + 1} Error: End position cannot precede start position.`);
        return;
      }
      if (row.limit < 1) {
        setValidationError(`Row ${i + 1} Error: Limit must be at least 1.`);
        return;
      }
      if (i > 0) {
        const prevRow = sortedRows[i - 1];
        const prevEndLinear = (prevRow.endPage * qtyPerPage) + prevRow.endPos;
        if (startLinear <= prevEndLinear) {
          setValidationError(`Collision! Overlapping coordinate assignments encountered.`);
          return;
        }
      }

      const qty = ((row.endPage - row.startPage) * qtyPerPage) + (row.endPos - row.startPos) + 1;
      if (calculatedSummary[row.itemType]) {
        calculatedSummary[row.itemType].qty += qty;
        // Actual Bid Limit from Loot Registry rows (Settings only as fallback seed)
        calculatedSummary[row.itemType].limit = row.limit >= 1
          ? row.limit
          : (activeLoots[row.itemType] || 1);
      }
    }

    Object.keys(calculatedSummary).forEach(key => {
      const item = calculatedSummary[key];
      if (!item) return;
      item.seats = Math.floor(item.qty / item.limit); 
      
      const priorityApplicants = (rankingsByItem && rankingsByItem[key]) ? rankingsByItem[key] : [];
      const detailsMap = (requestsByItemDetails && requestsByItemDetails[key]) ? requestsByItemDetails[key] : {};
      const flatStaticBoxArray = Array(item.qty).fill("");
      let globalBoxCursor = 0;

      for (let p = 0; p < priorityApplicants.length; p++) {
        if (globalBoxCursor >= item.qty) break;
        const pName = priorityApplicants[p];
        if (!pName) continue;
        const requestedQuantity = detailsMap[pName]?.quantity || 1;
        const allowedBoxSpan = Math.min(requestedQuantity, item.limit);

        let allocatedSome = false;
        for (let b = 0; b < allowedBoxSpan; b++) {
          if (globalBoxCursor < item.qty) {
            flatStaticBoxArray[globalBoxCursor] = pName;
            globalBoxCursor++;
            allocatedSome = true;
          }
        }
        if (allocatedSome) {
          initialWinnersTrack[key].push(pName);
        }
      }
      initialAllocations[key] = { selected: flatStaticBoxArray };
    });

    const firstActiveCategory = items.find(i => calculatedSummary[i.id]?.qty > 0)?.id || items[0].id;

    saveWorkspaceState({
      activeStep: 2,
      lootSummary: calculatedSummary,
      categoryAllocations: initialAllocations,
      initialWinnersByItem: initialWinnersTrack,
      activeMatrixFilter: firstActiveCategory,
      sidebarTab: 'standby'
    });
    setSidebarSearch('');
  };

  const handleDropBidderBoxSlot = (slotIndex) => {
    if (!isAdminMode || !isOfficer) return;
    const currentData = categoryAllocations[activeMatrixFilter] || { selected: [] };
    const updatedSelected = [...currentData.selected];
    updatedSelected[slotIndex] = ""; 
    saveWorkspaceState({ categoryAllocations: { ...categoryAllocations, [activeMatrixFilter]: { selected: updatedSelected } } });
  };

  const handlePromoteBidderToTargetSlotIndex = (playerName, slotIndex) => {
    if (!isAdminMode || !isOfficer) return;
    const currentData = categoryAllocations[activeMatrixFilter] || { selected: [] };
    const updatedSelected = [...currentData.selected];
    
    // Since Standby lists now pass pure UIDs directly, map to UID only if coming from Full Roster tab
  const targetUid = sidebarTab === 'standby' ? playerName : (nameToUidMap[playerName.trim().toLowerCase()] || playerName);
  updatedSelected[slotIndex] = targetUid;
    
    saveWorkspaceState({ categoryAllocations: { ...categoryAllocations, [activeMatrixFilter]: { selected: updatedSelected } } });
  };

  const handleRowDragStart = (e, index) => {
    if (!isOfficer) return e.preventDefault();
    setDraggedItemIndex(index);
    isUserDraggingRef.current = true; 
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleRowDrop = (e, targetIndex) => {
    isUserDraggingRef.current = false;
    if (!isAdminMode || !isOfficer || draggedItemIndex === null || draggedItemIndex === targetIndex) return;
    const currentData = categoryAllocations[activeMatrixFilter] || { selected: [] };
    const updatedSelected = [...currentData.selected];
    
    const temp = updatedSelected[targetIndex];
    updatedSelected[targetIndex] = updatedSelected[draggedItemIndex];
    updatedSelected[draggedItemIndex] = temp;

    saveWorkspaceState({ categoryAllocations: { ...categoryAllocations, [activeMatrixFilter]: { selected: updatedSelected } } });
    setDraggedItemIndex(null);
  };

  const handleOriginalMatrixAssembly = () => {
  if (!isAdminMode || !isOfficer) return;

    // 🎯 Transition smoothly without pushing rigid, destructive static overwrites to Firebase
    setBookCurrentPage(1);
    saveWorkspaceState({ activeStep: 3 });
  };

  const handleCommitSessionAndFlash = async () => {
    if (!commitDate.trim() || !isOfficer) return alert("Operation locked or criteria missing.");
    try {
      setCommittingSetting(true);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);

      const processedAllocations = {};
      Object.keys(categoryAllocations).forEach(cat => {
        const boxEntries = (categoryAllocations[cat].selected || []).filter(val => val !== "");
        
        const initialWinnersList = initialWinnersByItem[cat] || [];
        const absentList = initialWinnersList.filter(uid => !boxEntries.includes(uid));

        const masterList = rankingsByItem[cat] || [];
        const nonWinners = masterList.filter(uid => !boxEntries.includes(uid) && !absentList.includes(uid));
        
        const uniqueWinners = [...new Set(boxEntries)];
        const selectedPayload = uniqueWinners.map(uid => ({
          userId: uid,
          name: resolveDisplayName(uid),
          slots: boxEntries.filter(n => n === uid).length
        }));

        processedAllocations[cat] = {
          selected: selectedPayload,
          absent: absentList,
          notSelected: nonWinners
        };
      });

      const res = await fetch(`${backendUrl}/api/requests/commit-session`, {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({ event: commitEvent, date: commitDate, allocations: processedAllocations, summary: lootSummary }),
        credentials: 'include'
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Server validation lockout executed.");
      }

      const data = await res.json();
      if (data.success) {
        alert("💥 SUCCESS: Raid records written to ledger repository! Server staging sandbox cleared.");
        setActiveStep(1);
        setBookCurrentPage(1);
        const currentActiveEvent = Object.values(availableEvents).find(ev => ev.title === commitEvent) || Object.values(availableEvents)[0];
        const scheduledLootIds = currentActiveEvent?.loots ? Object.keys(currentActiveEvent.loots) : [];
        const dynamicFirstItemType = scheduledLootIds[0] || (items[0]?.id || '');
        const dynamicFirstItemLimit = currentActiveEvent?.loots?.[dynamicFirstItemType] || 1;

        setLootRows([{ id: 1, itemType: dynamicFirstItemType, startPage: 1, startPos: 1, endPage: 1, endPos: 4, limit: dynamicFirstItemLimit }]);
        setLootSummary({});
        setCategoryAllocations({});
        setGeneratedSlots([]);
        loadTrueRequestPool(); 
      }
    } catch (err) {
      alert(`❌ Commit execution blocked: ${err.message}`);
    } finally {
      setCommittingSetting(false);
    }
  };

  const handleDownloadLootHistoryCSV = () => {
    if (lootHistoryData.length === 0) return;
    const csvHeaders = ["Date", "Event", "Item", "Qty", "Max", "Seats"];
    const csvRows = lootHistoryData.map(row => [`"${row.date}"`, `"${row.event}"`, `"${row.item}"`, row.quantity, row.max, row.mem]);
    const csvContent = [csvHeaders.join(","), ...csvRows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `LootHistory_Spreadsheet_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleAccordionGroup = (groupKey) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const getGroupedHistoryTimeline = () => {
    const timeflowMap = {};
    lootHistoryData.forEach((record) => {
      const key = `${record.date}_${record.event}`;
      if (!timeflowMap[key]) {
        timeflowMap[key] = {
          date: record.date,
          event: record.event,
          records: []
        };
      }
      timeflowMap[key].records.push(record);
    });
    return Object.values(timeflowMap);
  };

  const getItemStyleProfile = (id) => {
    const THEME_MAP = {
      purple: 'text-violet-400 border-violet-500/30 bg-violet-950/20 shadow-[0_0_15px_rgba(139,92,246,0.1)]',
      yellow: 'text-yellow-400 border-yellow-500/30 bg-yellow-950/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]',
      slate:  'text-slate-100 border-slate-700 bg-slate-900/40 shadow-[0_0_15px_rgba(255,255,255,0.05)]',
      red:    'text-red-500 border-red-950 bg-black/60 border-l-4 border-l-red-600'
    };

    const matchedItem = items.find(i => i.id === id);

    // If it's a dynamic Hex Color from the system color wheel
    if (matchedItem?.colorTheme?.startsWith('#')) {
      return {
        className: '',
        style: {
          color: matchedItem.colorTheme,
          borderColor: `${matchedItem.colorTheme}40`,
          backgroundColor: `${matchedItem.colorTheme}15`,
          boxShadow: `0 0 15px ${matchedItem.colorTheme}20`
        }
      };
    }

    // Fallback to presets or standard slate base
    const baseClass = matchedItem && matchedItem.colorTheme ? (THEME_MAP[matchedItem.colorTheme] || THEME_MAP.slate) : THEME_MAP.slate;

    return {
      className: baseClass,
      style: {}
    };
  };

  const currentUserName = user?.displayName || user?.username || '';
  const pageSlotsToRender = Array.from({ length: qtyPerPage }, (_, i) => {
    return generatedSlots.find(s => s.page === bookCurrentPage && s.slot === (i + 1)) || null;
  });
  const totalPagesCount = generatedSlots.length > 0 ? Math.ceil(generatedSlots.length / qtyPerPage) : 1;

  const currentActiveSelections = categoryAllocations[activeMatrixFilter] || { selected: [] };
  // 🛡️ Local Scope Type Guard: Extracts a valid sequential array profile from the current selected track
  const activeSelectedList = Array.isArray(currentActiveSelections.selected)
    ? currentActiveSelections.selected
    : Object.values(currentActiveSelections.selected || {});
  const activeStandbyPoolList = (rankingsByItem[activeMatrixFilter] || []).filter(uid => {
    const totalUserRequestedVolume = requestsByItemDetails[activeMatrixFilter]?.[uid]?.quantity || 1;
    const currentAllocatedVolumeAcrossGrid = (currentActiveSelections.selected || []).filter(n => n === uid).length;
    return currentAllocatedVolumeAcrossGrid < totalUserRequestedVolume; 
  });

  const sidebarFilteredRosterList = masterGuildRoster.filter(name => {
    const currentItemObj = items.find(i => i.id === activeMatrixFilter);
    const maxRowLimit = lootSummary[activeMatrixFilter]?.limit
      || (currentItemObj ? (currentItemObj.limitQty || 1) : 1);
    const currentAllocatedVolumeAcrossGrid = (currentActiveSelections.selected || []).filter(n => resolveDisplayName(n) === name).length;
    return name.toLowerCase().includes(sidebarSearch.toLowerCase()) && currentAllocatedVolumeAcrossGrid < maxRowLimit;
  });

  const totalCategoryDropQuantity = lootSummary[activeMatrixFilter]?.qty || 0;
  const currentCategoryAllocatedQuantity = (currentActiveSelections.selected || []).filter(n => n !== "").length;

  return (
    <div className="space-y-4 text-slate-100 bg-slate-950 min-h-screen p-4 sm:p-6 select-none font-sans relative">
      
      {/* BRAND MONITOR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white uppercase">Game Auction Preview</h1>
          <p className="text-xs text-slate-400 mt-1">Mirrored Item Mapping & Input Console</p>
          {(!items || items.length === 0) && (
            <p className="text-[11px] text-amber-400 mt-2">Set up loot items and events in Settings.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {isOfficer && (
            <button
              type="button"
              onClick={handleSyncRosterFromDiscord}
              disabled={syncingRoster}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all shadow cursor-pointer select-none ${
                syncingRoster 
                  ? 'bg-slate-900 border-slate-800 text-slate-500' 
                  : 'border-indigo-500/30 bg-indigo-950/20 text-indigo-400 hover:bg-indigo-600 hover:text-white'
              }`}
            >
              <IconSync /> {syncingRoster ? "Syncing Roster Pool..." : "Sync Discord Roster"}
            </button>
          )}

          <button
            type="button"
            onClick={() => { fetchLootHistoryLog(); setIsLootHistoryOpen(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider border border-slate-800 bg-slate-900 text-slate-400 hover:text-white transition-all shadow cursor-pointer select-none"
          >
            <IconHistory /> View Loot History
          </button>
          
          {isOfficer && (
            <button 
              type="button"
              onClick={() => setIsAdminMode(!isAdminMode)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] uppercase font-bold tracking-wider transition border cursor-pointer select-none ${
                isAdminMode ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-slate-900 border-slate-800 text-slate-500'
              }`}
            >
              <IconTerminal /> Officer Override: {isAdminMode ? 'ENABLED' : 'DISABLED'}
            </button>
          )}
        </div>
      </div>

      {/* --- ADMINISTRATIVE OFFICER PANEL OVERRIDES --- */}
      {isAdminMode && isOfficer && (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-4" ref={popoverAnchorRef}>
          
          <div className="flex items-center justify-between bg-slate-950 border border-slate-800/60 p-1 rounded-xl gap-1 max-w-4xl mx-auto shadow-inner select-none">
            <div className={`flex-1 text-center py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all duration-200 ${activeStep === 1 ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-500'}`}>
              01. Loot Registry
            </div>
            <div className="text-slate-800 shrink-0 px-0.5"><IconChevron direction="right" /></div>
            <div className={`flex-1 text-center py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all duration-200 ${activeStep === 2 ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-500'}`}>
              02. Allocate Members
            </div>
            <div className="text-slate-800 shrink-0 px-0.5"><IconChevron direction="right" /></div>
            <div className={`flex-1 text-center py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all duration-200 ${activeStep === 3 ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-500'}`}>
              03. Book Preview
            </div>
            <div className="text-slate-800 shrink-0 px-0.5"><IconChevron direction="right" /></div>
            <div className={`flex-1 text-center py-2 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-all duration-200 ${activeStep === 4 ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-500'}`}>
              04. Commit Ledger
            </div>
          </div>

          {/* STEP 1 WORKSPACE */}
          {activeStep === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-start gap-x-6 gap-y-2 border-b border-slate-800/40 pb-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <IconTarget /> Active Event:
                </div>
                <div className="bg-slate-950 border border-slate-800/80 rounded-xl px-4 py-1.5 text-xs font-mono text-amber-500 font-bold tracking-wide select-none shadow-inner">
                  {commitEvent || 'Syncing Active Schedule Tree...'}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-medium text-slate-300">
                <span>Configure Item Loot from the game's auction pages:</span>
                <div className="flex items-center gap-3">
                  {loadingPool && <span className="text-[10px] text-amber-500 font-mono animate-pulse mr-1">Syncing true request vectors...</span>}
                  <label className="text-slate-500 font-sans font-semibold">Slots Per Page:</label>
                  <input 
                    type="number" 
                    value={qtyPerPage} 
                    onChange={(e) => setQtyPerPage(Math.max(1, parseInt(e.target.value) || 4))}
                    className="w-14 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 font-mono text-center text-xs text-amber-500 font-bold outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:border-slate-700 transition shadow-inner"
                  />
                </div>
              </div>

              {validationError && (
                <div className="bg-rose-950/30 border border-rose-500/30 text-rose-400 text-xs px-3.5 py-2 rounded-xl font-semibold shadow-md animate-shake flex items-center gap-2">
                  <IconX /> {validationError}
                </div>
              )}

              {liveGapsWarning && (
                <div className="bg-amber-950/20 border border-amber-500/20 text-amber-400 text-xs px-3.5 py-2 rounded-xl font-mono tracking-tight shadow-inner">
                  {liveGapsWarning}
                </div>
              )}

              <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-950/40">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900/40 border-b border-slate-800 text-slate-400 uppercase font-bold tracking-wider text-[10px] select-none">
                      <th className="p-3">Item Category</th>
                      <th className="p-3 text-center">Start Page</th>
                      <th className="p-3 text-center">Start Pos</th>
                      <th className="p-3 text-center">End Page</th>
                      <th className="p-3 text-center">End Pos</th>
                      <th className="p-3 text-center">Actual Bid Limit</th>
                      <th className="p-3 text-center">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/60 font-mono text-[11px]">
                    {lootRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-900/20 transition-all">
                        <td className="p-2">
                          <select 
                            value={row.itemType} 
                            onChange={(e) => handleUpdateLootRow(row.id, 'itemType', e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1 text-xs font-sans text-slate-200 outline-none w-44 focus:border-slate-700 font-semibold cursor-pointer"
                          >
                            {(() => {
                              const selEv = Object.values(availableEvents).find(ev => ev.title === commitEvent) || Object.values(availableEvents)[0];
                              const allowedIds = selEv?.loots ? Object.keys(selEv.loots) : [];
                              return items.filter(i => allowedIds.includes(i.id)).map(i => (
                                <option key={i.id} value={i.id} className="bg-slate-950 text-slate-300">
                                  {i.name}
                                </option>
                              ));
                            })()}
                          </select>
                        </td>
                        
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-1.5 bg-slate-950/30 border border-slate-800/40 rounded-xl px-1.5 max-w-[95px] mx-auto py-0.5">
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'startPage', Math.max(1, row.startPage - 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">-</button>
                            <input type="number" value={row.startPage} onChange={(e) => handleUpdateLootRow(row.id, 'startPage', e.target.value)} className="w-6 bg-transparent text-center text-slate-300 text-xs font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'startPage', row.startPage + 1)} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">+</button>
                          </div>
                        </td>
                        
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-1.5 bg-slate-950/30 border border-slate-800/40 rounded-xl px-1.5 max-w-[95px] mx-auto py-0.5">
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'startPos', Math.max(1, row.startPos - 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">-</button>
                            <input type="number" value={row.startPos} onChange={(e) => handleUpdateLootRow(row.id, 'startPos', e.target.value)} className="w-6 bg-transparent text-center text-amber-500 font-bold text-xs font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'startPos', Math.min(qtyPerPage, row.startPos + 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">+</button>
                          </div>
                        </td>

                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-1.5 bg-slate-950/30 border border-slate-800/40 rounded-xl px-1.5 max-w-[95px] mx-auto py-0.5">
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'endPage', Math.max(1, row.endPage - 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">-</button>
                            <input type="number" value={row.endPage} onChange={(e) => handleUpdateLootRow(row.id, 'endPage', e.target.value)} className="w-6 bg-transparent text-center text-slate-300 text-xs font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'endPage', row.endPage + 1)} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">+</button>
                          </div>
                        </td>

                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-1.5 bg-slate-950/30 border border-slate-800/40 rounded-xl px-1.5 max-w-[95px] mx-auto py-0.5">
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'endPos', Math.max(1, row.endPos - 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">-</button>
                            <input type="number" value={row.endPos} onChange={(e) => handleUpdateLootRow(row.id, 'endPos', e.target.value)} className="w-6 bg-transparent text-center text-amber-500 font-bold text-xs font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => handleUpdateLootRow(row.id, 'endPos', Math.min(qtyPerPage, row.endPos + 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">+</button>
                          </div>
                        </td>

                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-1.5 bg-slate-950/30 border border-slate-800/40 rounded-xl px-1.5 max-w-[95px] mx-auto py-0.5">
                            <button type="button" onClick={() => handleUpdateActualBidLimit(row.id, Math.max(1, (row.limit || 1) - 1))} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">-</button>
                            <input type="number" value={row.limit || 1} onChange={(e) => handleUpdateActualBidLimit(row.id, e.target.value)} className="w-6 bg-transparent text-center text-amber-500 font-bold text-xs font-mono outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => handleUpdateActualBidLimit(row.id, (row.limit || 1) + 1)} className="w-5 h-5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-bold hover:bg-slate-800 hover:text-white transition flex items-center justify-center cursor-pointer shadow-sm">+</button>
                          </div>
                        </td>

                        <td className="p-2 text-center">
                          <button type="button" onClick={() => handleRemoveLootRow(row.id)} className="text-slate-600 hover:text-rose-400 p-1 cursor-pointer transition">
                            <IconTrash />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ✅ CLEAN BASELINE: Restored tidy navigation alignments for the primary table registry */}
              <div className="flex justify-between items-center pt-2">
                <button type="button" onClick={handleAddLootRow} className="flex items-center gap-1.5 px-4 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 text-[10px] uppercase font-bold tracking-wider rounded-xl text-slate-400 hover:text-white transition cursor-pointer shadow-sm">
                  <IconPlus /> Add Item
                </button>
                <button type="button" onClick={handleCheckAndRegisterLoot} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-white transition shadow-xl cursor-pointer">
                  Allocate Members ➔
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 WORKSPACE */}
          {activeStep === 2 && (
            <div className="space-y-4 animate-fadeIn relative">
              {/* ✅ RELOCATED: Top space reclaimed. Buttons have been unified below to save workspace density. */}
              <div className="bg-slate-950 border border-slate-800/60 p-1.5 rounded-xl flex flex-wrap gap-1.5 text-center shadow-inner">
                {items.map((item) => {
                  const dropTotalQty = lootSummary[item.id]?.qty || 0;
                  const currentAllocatedSum = (categoryAllocations[item.id]?.selected || []).filter(n => n !== "").length;
                  const isActiveCategory = activeMatrixFilter === item.id;
                  return (
                    <div 
                      key={item.id} 
                      // 🛡️ LOCAL VISUAL TOGGLE: Swapping matrix column views alters browser rendering without firing any database updates
                      onClick={() => { setActiveMatrixFilter(item.id); }}
                      className={`p-2.5 rounded-lg border cursor-pointer flex-1 min-w-[150px] transition-all duration-200 ${
                        isActiveCategory 
                          ? 'bg-indigo-600 border-transparent text-white shadow-md font-bold' 
                          : 'border-slate-800/80 bg-slate-900/30 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-[9px] uppercase tracking-wider font-bold flex items-center justify-between gap-2">
                        <span className="truncate">{item.name}</span>
                        <span className={`font-mono font-bold tracking-tight shrink-0 ${isActiveCategory ? 'text-indigo-200' : 'text-amber-500/90'}`}>
                          MAX: {lootSummary[item.id]?.limit || item.limitQty || 1}
                        </span>
                      </div>
                      <div className={`text-sm font-black mt-1 font-mono tracking-tight ${isActiveCategory ? 'text-white' : 'text-slate-200'}`}>
                        {currentAllocatedSum} / {dropTotalQty}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                
                {/* GRID DROP SLOTS DESK PANEL */}
                <div className="md:col-span-8 border border-slate-800 bg-slate-950/40 rounded-xl p-3 flex flex-col shadow-md h-[28rem]">
                  <div className="grid grid-cols-1 gap-1.5 overflow-y-auto pr-0.5 scrollbar-thin h-full">
                    {activeSelectedList.map((name, i) => {
                      const coords = generatedSlots.filter(s => s.itemType === activeMatrixFilter)[i];
                      const coordLabel = coords ? `P${coords.page} - S${coords.slot}` : `SLOT ${i + 1}`;

                      if (name === "") {
                        return (
                          <div 
                            key={i}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const droppedPlayerName = e.dataTransfer.getData("text/plain");
                              if (droppedPlayerName) handlePromoteBidderToTargetSlotIndex(droppedPlayerName, i);
                            }}
                            className="p-2.5 rounded-xl border border-dashed border-slate-800 bg-slate-950/20 text-[11px] font-mono text-slate-500 flex items-center justify-between min-h-[44px] group hover:border-slate-700/80 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="px-2 py-0.5 rounded-md bg-slate-950 text-slate-400 text-[10px] font-bold tracking-wide border border-slate-800 font-mono shrink-0 select-none">
                                {coordLabel}
                              </span>
                              <span className="font-sans text-[10px] font-medium tracking-tight text-slate-600 group-hover:text-slate-400 transition-colors">
                                Drag & Drop Member to Assign Slot
                              </span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div 
                          key={i} 
                          draggable="true" 
                          onDragStart={(e) => handleRowDragStart(e, i)} 
                          onDragOver={(e) => e.preventDefault()} 
                          onDrop={(e) => { e.preventDefault(); handleRowDrop(e, i); }} 
                          className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/40 flex items-center justify-between min-h-[44px] text-xs font-mono cursor-grab active:cursor-grabbing hover:border-slate-700 hover:bg-slate-900/60 transition-all duration-150"
                        >
                          <div className="flex items-center gap-3 truncate pr-3">
                            <span className="px-2 py-0.5 rounded-md bg-indigo-950/60 text-indigo-400 text-[10px] font-bold tracking-wide border border-indigo-900/40 font-mono shrink-0 select-none">
                              {coordLabel}
                            </span>
                            <div className="truncate text-slate-400 select-none font-sans font-semibold flex items-center gap-2">
                              <span className="text-slate-700 font-mono font-normal">☰</span> 
                              <span className="text-slate-200 truncate">{resolveDisplayName(name)}</span>
                            </div>
                          </div>
                          <button 
                            type="button" 
                            onClick={() => handleDropBidderBoxSlot(i)} 
                            className="text-[9px] font-mono font-bold uppercase tracking-wider text-rose-400 hover:text-rose-300 cursor-pointer shrink-0 transition pl-2"
                          >
                            Remove ✖
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* SIDEBAR QUEUE SELECTION STACK */}
                <div className="md:col-span-4 border border-slate-800 bg-slate-950/40 rounded-xl p-3 flex flex-col space-y-3 shadow-md h-[28rem]">
                  <div className="flex bg-slate-950 border border-slate-800/80 p-0.5 rounded-xl shrink-0 gap-0.5 shadow-inner select-none">
                    <button 
                      type="button"
                      onClick={() => saveWorkspaceState({ sidebarTab: 'standby' })} 
                      className={`flex-1 py-1.5 rounded-lg text-[9px] uppercase tracking-wider font-bold transition-all duration-150 cursor-pointer ${
                        sidebarTab === 'standby' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      Standby ({activeStandbyPoolList.length})
                    </button>
                    <button 
                      type="button"
                      onClick={() => saveWorkspaceState({ sidebarTab: 'roster' })} 
                      className={`flex-1 py-1.5 rounded-lg text-[9px] uppercase tracking-wider font-bold transition-all duration-150 cursor-pointer ${
                        sidebarTab === 'roster' ? 'bg-indigo-600 text-white shadow' : 'text-slate-300 hover:text-slate-300'
                      }`}
                    >
                      Full Roster
                    </button>
                  </div>
                  
                  {sidebarTab === 'roster' && (
                    <div className="relative shrink-0 select-none animate-fadeIn">
                      <input 
                        type="text" 
                        placeholder="Search Member name..." 
                        value={sidebarSearch} 
                        onChange={(e) => setSidebarSearch(e.target.value)} 
                        className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-1.5 text-[11px] text-slate-200 font-medium placeholder-slate-650 outline-none focus:border-slate-700 font-sans transition shadow-inner" 
                      />
                    </div>
                  )}

                  <div className="space-y-1.5 overflow-y-auto pr-0.5 scrollbar-thin h-full">
                    {(sidebarTab === 'standby' ? activeStandbyPoolList : sidebarFilteredRosterList).map((name, i) => (
                      <div 
                        key={i} 
                        draggable="true" 
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", name); isUserDraggingRef.current = true; }} 
                        onDragEnd={() => { isUserDraggingRef.current = false; }} 
                        className="flex items-center justify-between p-2.5 px-3.5 rounded-xl border border-slate-800/80 bg-slate-900/20 text-xs font-mono cursor-grab active:cursor-grabbing hover:border-slate-700 hover:bg-slate-900/40 transition-colors"
                      >
                        <span className="truncate text-slate-300 font-sans font-semibold text-xs select-none">
                          {sidebarTab === 'standby' ? resolveDisplayName(name) : name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* 🛠️ CONTROL DECK ARRANGEMENT: Grouped structural overrides alongside transmission triggers within a single space-saving footer array */}
              <div className="flex justify-between items-center pt-2">
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => {
                      if (window.confirm("WARNING: Reverting back to Phase 1 will completely wipe your current layout matrix selections and manually assigned bidders. Are you sure you want to proceed?")) {
                        saveWorkspaceState({ activeStep: 1 });
                      }
                    }} 
                    className="px-4 py-2 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-sm"
                  >
                    ◀ Back to Registry
                  </button>

                  <button 
                    type="button" 
                    onClick={handleWipeStagingSandbox} 
                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-950 border border-slate-800/80 hover:border-rose-950/40 text-[10px] uppercase font-bold tracking-wider rounded-xl text-slate-500 hover:text-rose-400 transition cursor-pointer shadow-sm"
                  >
                    <IconTrash /> Wipe Session
                  </button>

                  <button
                    type="button"
                    onClick={() => saveWorkspaceState({ isDiscordGateOpen: !isDiscordGateOpen })}
                    className={`px-3 py-2 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider transition-all border duration-150 cursor-pointer select-none ${
                      isDiscordGateOpen
                        ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                        : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400'
                    }`}
                  >
                    {isDiscordGateOpen ? '● Live Auction Online' : '○ Live Auction Offline'}
                  </button>
                </div>

                <button 
                  type="button"
                  onClick={handleOriginalMatrixAssembly} 
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-white transition shadow-xl cursor-pointer"
                >
                  Lock Matrix Roster ➔
                </button>
              </div>
            </div>
          )}

          {/* 🔮 STEP 3: DYNAMIC TWIN LAYOUT RE-INTERCEPT PANEL */}
          {activeStep === 3 && (
            <div className="flex p-3 bg-slate-950 border border-slate-900 rounded-xl items-center justify-between gap-4 animate-fadeIn">
              <div className="text-xs text-slate-400 font-medium">Review the Game Auction Book Preview allocation below.</div>
              <div className="flex gap-3">
                <button 
                  type="button"
                  onClick={() => saveWorkspaceState({ activeStep: 2 })} 
                  className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition shadow cursor-pointer"
                >
                  <IconUndo /> Return to Allocations
                </button>
                <button 
                  onClick={() => saveWorkspaceState({ activeStep: 4 })} 
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-md cursor-pointer"
                >
                  Proceed to Commit Ledger ➔
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 WORKSPACE ARCHIVER */}
          {activeStep === 4 && (
            <div className="bg-gradient-to-br from-slate-900 to-amber-950/10 border border-amber-500/20 p-5 rounded-xl text-center space-y-4 animate-fadeIn">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wide">Finalize Database Registration</h3>
                <p className="text-xs text-slate-400 max-w-xl mx-auto">Verify parameters below. Committing locks records straight into permanent database history and frees up applicants for subsequent events.</p>
              </div>

              <div className="flex flex-col gap-3.5 max-w-xs mx-auto p-4 bg-slate-950 rounded-xl border border-slate-800 text-left shadow-inner">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Event Category Origin</label>
                  <div className="text-xs font-sans font-bold text-amber-500 mt-1 select-none">
                    {commitEvent}
                  </div>
                </div>
                <div className="border-t border-slate-900 my-0.5" />
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Event Date</label>
                  <input 
                    type="date" 
                    value={commitDate} 
                    onChange={(e) => setCommitDate(e.target.value)} 
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-slate-200 mt-1 focus:border-slate-700 outline-none transition cursor-pointer" 
                  />
                </div>
              </div>

              <div className="flex justify-center gap-4 pt-1">
                <button onClick={() => saveWorkspaceState({ activeStep: 3 })} disabled={committing} className="px-4 py-1.5 rounded-xl border border-slate-800 text-xs font-bold text-slate-400 hover:bg-slate-900 disabled:opacity-30 transition">Return to Preview</button>
                <button onClick={handleCommitSessionAndFlash} disabled={committing} className="px-6 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs tracking-wider uppercase shadow-xl transition" >
                  {committing ? "Writing Ledger Data..." : "COMMIT SESSION"}
                </button>
              </div>

              {isOfficer && (
                <div className="max-w-md mx-auto pt-1">
                  <button
                    onClick={() => saveWorkspaceState({ autoCommitArmed: !autoCommitArmed })}
                    className={`w-full px-4 py-2 rounded-xl text-xs font-bold tracking-wider uppercase border transition ${
                      autoCommitArmed
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {autoCommitArmed
                      ? '🟢 Auto-Commit ARMED — fires ~1 min before Phase 3 ends'
                      : '⚪ Auto-Commit OFF — click to arm safety auto-commit'}
                  </button>
                  <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                    When armed, the server auto-commits this staged board about one minute before the event's Phase 3 ends. It is skipped if no winners are staged, and disarms automatically once committed.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- PUBLIC PREVIEW DESK FILTER BAR --- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/40 border border-slate-800 rounded-2xl p-3 shadow-md">
        <div className="flex items-center bg-slate-950 border border-slate-800 p-0.5 rounded-xl shrink-0 shadow-inner gap-0.5">
          <button 
            type="button"
            onClick={() => setViewLens('ALL')} 
            className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 ${viewLens === 'ALL' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <IconEye /> See All
          </button>
          <button 
            type="button"
            onClick={() => { if (!user) return alert("Verify Discord connection parameters first."); setViewLens('MINE'); }} 
            className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all duration-150 ${viewLens === 'MINE' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <IconUser /> See Mine {viewLens === 'MINE' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <input 
            type="text" 
            placeholder="Search Member name..." 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-medium placeholder-slate-600 outline-none focus:border-slate-700 font-sans transition shadow-inner" 
          />
        </div>
      </div>

      {/* --- MASTER LEDGER VISUAL GRID --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        
        {/* LEFT COMPONENT */}
        <div className="lg:col-span-5 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md relative space-y-3.5">
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <IconBullseye /> Game Auction Book Preview
            </h2>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 min-h-[220px] shadow-inner flex flex-col justify-between space-y-3">
            <div className="text-[9px] font-bold tracking-widest uppercase text-slate-500 text-center pb-2 border-b border-slate-900/60 font-mono select-none">
              In-game Auction Book — Page: {bookCurrentPage}
            </div>

            <div className="space-y-1.5 flex-1 py-0.5">
              {pageSlotsToRender.map((slot, index) => {
                const slotIndex = index + 1;
                if (!slot) {
                  return (
                    <div key={slotIndex} className="grid grid-cols-12 text-[10px] font-mono p-2.5 border border-slate-900 bg-slate-900/10 rounded-xl text-slate-700 select-none items-center">
                      <div className="col-span-2 font-bold text-slate-800/60">[{String(slotIndex).padStart(2, '0')}]</div>
                      <div className="col-span-10 italic text-[10px] text-slate-800/30">EMPTY IN-GAME BIDDING SLOT</div>
                    </div>
                  );
                }

                const profile = getItemStyleProfile(slot.itemType);
                const slotDisplayName = resolveDisplayName(slot.name);
                const isTargetOwner = user && (slot.name === user?.id || slotDisplayName.toLowerCase() === currentUserName.toLowerCase());
                const spotlightActive = viewLens === 'MINE' && isTargetOwner;

                return (
                  <div 
                    key={slotIndex} 
                    className={`grid grid-cols-12 items-center text-[11px] font-mono px-3 py-2 border rounded-xl transition-all ${profile.className} ${spotlightActive ? 'ring-2 ring-amber-500 bg-slate-900/80 scale-[1.01]' : (viewLens === 'MINE' ? 'opacity-10' : '')}`} 
                    style={profile.style}
                  >
                    <div className="col-span-2 font-bold text-slate-500/80 flex items-center gap-2 select-none">
                      [{String(slotIndex).padStart(2, '0')}]
                      {isTargetOwner && (
                        <span className="relative flex h-1.5 w-1.5 shrink-0 ml-0.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500 shadow shadow-rose-500/50"></span>
                        </span>
                      )}
                    </div>
                    <div className="col-span-5 font-sans font-semibold text-[11px] tracking-tight truncate pr-2">{slot.itemName}</div>
                    <div className="col-span-5 text-right font-sans font-bold truncate">
                      {slot.name === "" ? (
                        <span className="inline-flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-wider font-mono font-semibold text-slate-500 select-none w-full">
                          <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" strokeDasharray="3 3"/></svg>
                          Available
                        </span>
                      ) : (
                        <span className="text-slate-300">{slotDisplayName}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-900/60 select-none">
              <button 
                type="button"
                onClick={() => setBookCurrentPage(Math.max(1, bookCurrentPage - 1))} 
                disabled={bookCurrentPage === 1} 
                className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-[10px] font-bold disabled:opacity-10 transition cursor-pointer shadow-sm"
              >
                ◀ PREV
              </button>
              <div className="text-[10px] font-mono font-bold text-slate-500">
                PAGE <span className="text-white bg-slate-900 px-1.5 py-0.5 border border-slate-800 rounded mx-0.5">{bookCurrentPage}</span> OF {totalPagesCount}
              </div>
              <button 
                type="button"
                onClick={() => setBookCurrentPage(Math.min(totalPagesCount, bookCurrentPage + 1))} 
                disabled={bookCurrentPage === totalPagesCount} 
                className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-[10px] font-bold disabled:opacity-10 transition cursor-pointer shadow-sm"
              >
                NEXT ▶
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COMPONENT */}
        <div className="lg:col-span-7 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3.5">
          <div>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <IconHistory /> Master Allocation Ledger
            </h2>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-950/40 shadow-inner">
            <div className="max-h-[310px] overflow-y-auto relative min-w-[400px] scrollbar-thin">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-900 z-10 border-b border-slate-800 text-slate-500 uppercase font-bold tracking-wider text-[9px] select-none">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Item Name</th>
                    <th className="p-3 text-right">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/40 font-mono text-[11px]">
                  {(() => {
                    let rowsToDisplay = [...generatedSlots];
                    if (viewLens === 'ALL') {
                      items.forEach(item => {
                        const standbyList = rankingsByItem[item.id] || [];
                        const winnersInCat = (categoryAllocations[item.id]?.selected || []).filter(n => n !== "").map(uid => resolveDisplayName(uid));
                        
                        standbyList.forEach(uid => {
                          const resolvedName = resolveDisplayName(uid);
                          if (!winnersInCat.includes(resolvedName)) {
                            rowsToDisplay.push({ name: uid, itemType: item.id, itemName: item.name, page: '---', slot: '---', status: 'NotSelected' });
                          }
                        });
                      });
                    }

                    if (viewLens === 'MINE') {
                      rowsToDisplay = rowsToDisplay.filter(r => {
                        const rName = resolveDisplayName(r.name);
                        return r.name === user?.id || rName.toLowerCase() === currentUserName.toLowerCase();
                      });
                      if (rowsToDisplay.length === 0) {
                        items.forEach(item => {
                          const winnersInCat = (categoryAllocations[item.id]?.selected || []).map(n => resolveDisplayName(n));
                          if (!winnersInCat.includes(currentUserName) && (rankingsByItem[item.id] || []).includes(currentUserName)) {
                            rowsToDisplay.push({ name: currentUserName, itemType: item.id, itemName: item.name, page: '---', slot: '---', status: 'NotSelected' });
                          }
                        });
                      }
                    }

                    if (searchQuery) {
                      const q = searchQuery.toLowerCase();
                      rowsToDisplay = rowsToDisplay.filter(r => {
                        const dispName = resolveDisplayName(r.name);
                        return dispName.toLowerCase().includes(q) || r.itemName.toLowerCase().includes(q);
                      });
                    }
                    if (rowsToDisplay.length === 0) return <tr><td colSpan="3" className="p-8 text-center text-slate-500 font-sans italic text-xs select-none">No entries match your spotlight filters.</td></tr>;

                    return rowsToDisplay.map((row, index) => {
                      const rowDisplayName = resolveDisplayName(row.name);
                      const isSelf = user && (row.name === user?.id || rowDisplayName.toLowerCase() === currentUserName.toLowerCase());
                      const isSelected = row.status === 'Selected';
                      return (
                        <tr key={index} onClick={() => { if (typeof row.page === 'number') setBookCurrentPage(row.page); }} className={`group hover:bg-slate-900/40 transition-all cursor-pointer ${isSelf ? 'bg-indigo-950/10 font-bold' : ''} ${!isSelected ? 'opacity-30 text-slate-500' : ''}`} >
                          <td className="p-3 font-sans font-semibold text-slate-200 group-hover:text-white flex items-center gap-2 truncate max-w-[140px]">
                            {row.name === "" ? (
                              <svg className="w-3 h-3 text-slate-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" strokeDasharray="3 3"/></svg>
                            ) : (
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 shadow-sm ${isSelected ? 'bg-emerald-400 shadow-emerald-400/50' : 'bg-slate-700'}`} />
                            )}
                            <span className="truncate">
                              {row.name === "" ? (
                                <span className="text-[10px] uppercase tracking-wider font-mono font-semibold text-slate-500 select-none">
                                  Available
                                </span>
                              ) : (
                                rowDisplayName
                              )}
                            </span>
                          </td>
                          <td className="p-3">
                            {(() => {
                              const profile = getItemStyleProfile(row.itemType);
                              return (
                                <span className={`px-2 py-0.5 rounded text-[10px] border font-sans font-medium ${profile.className}`} style={profile.style}>
                                  {row.itemName}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="p-3 text-right font-mono text-[10px] font-medium text-slate-500 group-hover:text-slate-300 transition-colors select-none">
                            {typeof row.page === 'number' && typeof row.slot === 'number' ? `Page ${String(row.page).padStart(2, '0')} | Slot ${String(row.slot).padStart(2, '0')}` : 'QUEUE'}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="bg-slate-950 border border-slate-900 p-3 rounded-xl text-[10px] text-slate-500 leading-relaxed font-sans select-none">
            <strong className="text-slate-400 uppercase tracking-wider font-mono text-[9px] mr-1">Shortcut:</strong> Clicking a row in the Master Allocation Ledger automatically flips the Auction Book Preview to the exact page containing that ledger item.
          </div>
        </div>
      </div>

      {/* --- 🌟 ACCORDION HISTORICAL MATRIX MODAL --- */}
      {isLootHistoryOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[110] p-4 font-sans animate-fadeIn">
          <div className="fixed inset-0 z-0" onClick={() => setIsLootHistoryOpen(false)} />
          <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[80vh] relative z-10">
            
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center select-none">
              <div>
                <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-200 flex items-center gap-2">
                  <IconHistory /> Registered Loot Supply History Ledger
                </h2>
                <p className="text-[10px] text-slate-500 mt-0.5 font-mono">View winning loot from previous events.</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsLootHistoryOpen(false)} 
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <IconX />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-grow space-y-2.5 scrollbar-thin">
              {loadingLootHistory ? (
                <div className="text-center py-12 text-slate-500 animate-pulse font-mono text-xs">Extracting historical snapshot folders...</div>
              ) : getGroupedHistoryTimeline().length === 0 ? (
                <div className="text-center py-12 text-slate-600 italic font-sans text-xs select-none">No legacy loot files cataloged inside the database.</div>
              ) : (
                getGroupedHistoryTimeline().map((group) => {
                  const groupKey = `${group.date}_${group.event}`;
                  const isExpanded = !!expandedGroups[groupKey];

                  return (
                    <div key={groupKey} className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/20 shadow-sm">
                      <div 
                        onClick={() => toggleAccordionGroup(groupKey)}
                        className="p-3 px-4 bg-slate-950/40 hover:bg-slate-950/80 transition-all flex items-center justify-between cursor-pointer text-xs font-mono select-none"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-slate-500 shrink-0">
                            <IconChevron direction={isExpanded ? "down" : "right"} />
                          </span>
                          <span className="text-slate-300 font-bold tracking-tight w-24 shrink-0">{group.date}</span>
                          <span className="px-2 py-0.5 rounded-md text-[9px] bg-slate-900 border border-slate-800 font-sans font-bold text-amber-500 uppercase tracking-wide">
                            {group.event}
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-4 bg-slate-950/50 border-t border-slate-900 animate-fadeIn overflow-x-auto scrollbar-none">
                          <table className="w-full text-left border-collapse text-xs font-mono">
                            <thead>
                              <tr className="bg-slate-900/40 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-900 text-[9px] select-none">
                                <th className="p-2.5">Item Name</th>
                                <th className="p-2.5 text-center">Total Quantities</th>
                                <th className="p-2.5 text-center">Limit</th>
                                <th className="p-2.5 text-center">Allocated</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-900 text-slate-300">
                              {(group.records || []).map((row) => (
                                <tr key={row.id} className="hover:bg-slate-900/10 transition-colors">
                                  <td className="p-2.5 font-sans font-semibold text-slate-200">{row.item}</td>
                                  <td className="p-2.5 text-center text-slate-400 font-bold">{row.quantity} PCS</td>
                                  <td className="p-2.5 text-center text-amber-500 font-bold">{row.max}</td>
                                  <td className="p-2.5 text-center text-emerald-400 font-bold">{row.mem} MEMBERS</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex justify-between items-center rounded-b-3xl select-none">
              <button 
                type="button"
                onClick={handleDownloadLootHistoryCSV} 
                disabled={lootHistoryData.length === 0} 
                className="px-4 py-2 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-sm disabled:opacity-20"
              >
                Export (CSV)
              </button>
              <button 
                type="button"
                onClick={() => setIsLootHistoryOpen(false)} 
                className="px-5 py-2 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}