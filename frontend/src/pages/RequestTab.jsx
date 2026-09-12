// frontend/src/pages/RequestTab.jsx
import { useState, useEffect } from 'react';

const backendUrl = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:5001';

// --- 🎨 PURE VECTOR MICRO-ICONS CONSOLE ---
const IconLock = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
const IconCalendar = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>;
const IconPackage = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>;
const IconUser = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconActivity = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
const IconTrash = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>;
const IconCart = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>;
const IconX = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>;
const IconCycle = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/></svg>;
const IconTarget = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>;
const IconMoneyBag = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5c-.5-1 0-2 1-3h4c1 1 1.5 2 1 3M7 5h10l2.5 5.5A7 7 0 0112 21a7 7 0 01-7.5-10.5L7 5z"/><path d="M12 10v6M10 13.5c0 1 .8 1.5 2 1.5s2-.5 2-1.5-.8-1.5-2-1.5-2-.5-2-1.5.8-1.5 2-1.5 2 .5 2 1.5"/></svg>;

export default function RequestTab({ user }) {
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState({ name: '', date: '', eventId: '', eventName: '' });
  const [items, setItems] = useState([]);
  const [liveCounts, setLiveCounts] = useState({});
  const [localSelections, setLocalSelections] = useState({});
  const [authError, setAuthError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);

  // ⏳ Time-lock & Request List Integration Hooks
  const [isGateOpen, setIsGateOpen] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentPhase, setCurrentPhase] = useState(1);
  const [rankingsByItem, setRankingsByItem] = useState({});
  const [phaseIntervals, setPhaseIntervals] = useState({ phase1: '', phase2: '', phase3: '' });
  const [activeListTab, setActiveListTab] = useState('');

  const [members, setMembers] = useState({});

const [requestsByItemDetails, setRequestsByItemDetails] = useState({});

  const initLobbyDashboard = async () => {
    try {
      setLoading(true);
      setAuthError(false);

      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }

      const res = await fetch(`${backendUrl}/api/requests/init`, { 
        method: 'GET',
        headers: customHeaders,
        credentials: 'include' 
      });

      if (res.status === 401) {
        setAuthError(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setItems(data.items);
        setLiveCounts(data.liveCounts || {});
        // ✅ VERIFIED UNCHANGED: The data contract matches the modular backend payload perfectly.
        // It consumes the server's calculated state fields with zero local timezone calculations.
        setUserData({ 
          name: data.displayName, 
          date: data.date, 
          eventId: data.eventId || "Unconfigured", 
          eventName: data.eventName || "No Active Target Event Scheduled" 
        });
        
        if (data.isGateOpen !== undefined) setIsGateOpen(data.isGateOpen);
        if (data.nextStatusChangeMessage) setStatusMessage(data.nextStatusChangeMessage);
        if (data.currentPhase !== undefined) setCurrentPhase(data.currentPhase);
        if (data.rankingsByItem) setRankingsByItem(data.rankingsByItem);
        if (data.phaseIntervals) setPhaseIntervals(data.phaseIntervals);

        if (data.members) setMembers(data.members);
        if (data.requestsByItemDetails) setRequestsByItemDetails(data.requestsByItemDetails);

        // Dynamically initialize selection baskets and tabs based on database IDs
        const blankInputs = {};
        data.items.forEach(item => { blankInputs[item.id] = 0; });
        setLocalSelections(blankInputs);

        }
    } catch (err) {
      console.error("Connection link offline:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initLobbyDashboard();
  }, [user]);

  useEffect(() => {
    if (items.length > 0) {
      const isCurrentTabValid = items.some(item => item.id === activeListTab);
      if (!activeListTab || !isCurrentTabValid) {
        setActiveListTab(items[0].id);
      }
    } else {
      setActiveListTab('');
    }
  }, [items, activeListTab]);

  const adjustCounter = (itemId, direction, limitQty, currentActive) => {
    if (!isGateOpen) return; 
    const currentInput = localSelections[itemId] || 0;
    // ✅ FIXED: Check boundaries against the combined total state to allow downsizing selections down to a minimum floor of 1
    if (direction === 'up' && currentActive + currentInput < limitQty) {
      setLocalSelections(prev => ({ ...prev, [itemId]: currentInput + 1 }));
    } else if (direction === 'down' && currentActive + currentInput > 1) {
      setLocalSelections(prev => ({ ...prev, [itemId]: currentInput - 1 }));
    }
  };

  const handleBatchSubmitRequests = async () => {
    if (!isGateOpen) return; 
    const batchPayload = {};
    let activeItemsCount = 0;

    // ✅ FIXED: Transmit the final target state volume (Active + Staged modifications) for any altered items to match backend logic
    items.forEach(item => {
      const localInput = localSelections[item.id] || 0;
      const currentActive = liveCounts[item.id] || 0;
      if (localInput !== 0) {
        batchPayload[item.id] = currentActive + localInput;
        activeItemsCount++;
      }
    });

    if (activeItemsCount === 0) return;

    try {
      setProcessing(true);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }

      const res = await fetch(`${backendUrl}/api/requests/submit`, {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({ selections: batchPayload }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        await initLobbyDashboard();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handleExecuteCancel = async (itemId, itemName, activeQty) => {
    try {
      setProcessing(true);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) {
        customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
      }

      const res = await fetch(`${backendUrl}/api/requests/cancel`, {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({ itemId, itemName, cancelQty: activeQty }), 
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setIsCancelModalOpen(false);
        await initLobbyDashboard();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  if (authError) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-white border border-slate-800 bg-slate-900 rounded-2xl mt-12">
        <h2 className="text-lg font-bold text-rose-400 mb-2">Authentication Required</h2>
        <p className="text-xs text-slate-400">Please use the login portal to authorize your guild roster token profile.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium animate-pulse text-xs font-mono tracking-widest uppercase">
        Loading Relational Loot Configuration Matrix...
      </div>
    );
  }

  const activeCancelableItems = items.filter(item => (liveCounts[item.id] || 0) > 0);
  const totalStagedInCart = Object.values(localSelections).reduce((sum, val) => sum + val, 0);
  const currentRosterList = rankingsByItem[activeListTab] || [];

  return (
    <div className="mx-auto max-w-6xl p-6 text-white pb-32 relative">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-5 gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">Request Deck</h1>
          <div className="flex flex-wrap items-center gap-2.5 mt-2 text-[11px] font-mono">
            <span className="flex items-center gap-1.5 bg-slate-900/40 border border-slate-800/60 px-2.5 py-1 rounded-xl text-slate-400">
              <IconUser /> <span className="font-sans text-slate-500">User:</span> <strong className="text-indigo-400 font-bold">{userData.name}</strong>
            </span>
            <span className="flex items-center gap-1.5 bg-slate-900/40 border border-slate-800/60 px-2.5 py-1 rounded-xl text-slate-400">
              <IconCalendar /> <span className="font-sans text-slate-500">Date:</span> <strong className="text-slate-300 font-medium">{userData.date}</strong>
            </span>
            <span className="flex items-center gap-1.5 bg-slate-900/40 border border-slate-800/60 px-2.5 py-1 rounded-xl text-slate-400">
              <IconTarget /> <span className="font-sans text-slate-500">Event:</span> <strong className="text-amber-500 font-bold">[{userData.eventId}] {userData.eventName}</strong>
            </span>
          </div>
          {!isGateOpen && statusMessage && (
            <div className="flex items-center gap-2 bg-amber-950/20 border border-amber-500/20 text-amber-400 text-xs px-3.5 py-2 rounded-xl font-semibold mt-3 shadow-inner animate-slideIn">
              <IconLock /> {statusMessage}
            </div>
          )}
        </div>
        <button
          onClick={() => setIsCancelModalOpen(true)}
          disabled={currentPhase === 3}
          title={currentPhase === 3 ? 'Cancellations are locked during the Live Event / Auction phase.' : undefined}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-[10px] uppercase font-bold tracking-wider rounded-xl text-rose-400 hover:text-rose-300 transition cursor-pointer shadow-sm shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-slate-800 disabled:hover:text-rose-400"
        >
          {currentPhase === 3 ? 'Cancel Locked' : 'Cancel Request'} <IconTrash />
        </button>
      </div>

      {/* ASYMMETRIC GRID WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* PANEL ROW TRACK: Sidebars occupy 4 out of 12 columns */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* TIMELINE PHASE FLOW TREE CONTAINER */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3.5">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <IconCycle /> Event Cycle
            </div>
            <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 relative space-y-4 select-none">
              <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-slate-800 z-0" />
              
              {/* NODE 1 */}
              <div className="flex items-center gap-4 relative z-10 font-mono text-[11px]">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center font-sans font-bold shrink-0 text-[10px] transition-all duration-300 ${
                  currentPhase === 1 
                    ? 'bg-indigo-950 border-2 border-indigo-500 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.6)] animate-pulse' 
                    : currentPhase > 1 
                      ? 'bg-slate-900 border-2 border-slate-700 text-slate-500' 
                      : 'bg-slate-950 border border-slate-800 text-slate-600'
                }`}>
                  1
                </div>
                <div className="flex flex-col truncate">
                  <span className={`font-sans font-semibold text-xs ${currentPhase === 1 ? 'text-indigo-400' : 'text-slate-400'}`}>Bid Request Open</span>
                  <span className="text-[10px] text-slate-500 font-mono mt-0.5 tracking-tight truncate">
                    {phaseIntervals.phase1 || 'Pending configuration...'}
                  </span>
                </div>
              </div>

              {/* NODE 2 */}
              <div className="flex items-center gap-4 relative z-10 font-mono text-[11px]">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center font-sans font-bold shrink-0 text-[10px] transition-all duration-300 ${
                  currentPhase === 2 
                    ? 'bg-indigo-950 border-2 border-indigo-500 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.6)] animate-pulse' 
                    : currentPhase > 2 
                      ? 'bg-slate-900 border-2 border-slate-700 text-slate-500' 
                      : 'bg-slate-950 border border-slate-800 text-slate-600'
                }`}>
                  2
                </div>
                <div className="flex flex-col truncate">
                  <span className={`font-sans font-semibold text-xs ${currentPhase === 2 ? 'text-indigo-400' : 'text-slate-400'}`}>Bid Request Locked</span>
                  <span className="text-[10px] text-slate-500 font-mono mt-0.5 tracking-tight truncate">
                    {phaseIntervals.phase2 || 'Pending configuration...'}
                  </span>
                </div>
              </div>

              {/* NODE 3 */}
              <div className="flex items-center gap-4 relative z-10 font-mono text-[11px]">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center font-sans font-bold shrink-0 text-[10px] transition-all duration-300 ${
                  currentPhase === 3 
                    ? 'bg-indigo-950 border-2 border-indigo-500 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.6)] animate-pulse' 
                    : 'bg-slate-950 border border-slate-800 text-slate-600'
                }`}>
                  3
                </div>
                <div className="flex flex-col truncate">
                  <span className={`font-sans font-semibold text-xs ${currentPhase === 3 ? 'text-indigo-400' : 'text-slate-400'}`}>Event + Live Auction</span>
                  <span className="text-[10px] text-slate-500 font-mono mt-0.5 tracking-tight truncate">
                    {phaseIntervals.phase3 || 'Pending configuration...'}
                  </span>
                </div>
              </div>

            </div>
          </div>

          {/* 📋 SCROLLABLE REQUEST LIST COMPONENT */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3.5">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <IconPackage /> Active Request Queue
            </div>
            
            {/* Dynamic Category Selector Dropdown Matrix */}
            <div className="flex items-center bg-slate-950 border border-slate-800/60 p-2 rounded-xl gap-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider pl-1.5 select-none">Item:</span>
              <select
                value={activeListTab}
                onChange={(e) => setActiveListTab(e.target.value)}
                className="flex-1 bg-transparent text-xs text-indigo-400 font-sans font-bold outline-none cursor-pointer py-0.5"
              >
                {items.map(item => (
                  <option key={item.id} value={item.id} className="bg-slate-950 text-slate-300 font-sans font-medium text-xs">
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Column Header Metadata Labels */}
            <div className="flex justify-between items-center text-[9px] font-sans font-bold text-slate-500 uppercase tracking-widest px-3 pt-2 select-none border-b border-slate-900 pb-1">
              <div className="flex items-center gap-2">
                <span>#</span>
                <span className="pl-4">Member Name</span>
              </div>
              <div className="flex items-center gap-6 text-right pr-2">
                <span className="w-12 text-center">Prio</span>
                <span className="w-10 text-center">Time</span>
              </div>
            </div>

            {/* Strict height wrapper scroll context list box */}
            <div className="h-[210px] overflow-y-auto pr-0.5 text-xs font-mono font-medium space-y-1.5 scrollbar-thin">
              {currentRosterList.length === 0 ? (
                <div className="text-center py-12 text-[11px] text-slate-500 font-mono italic">No registrations filed for this entry.</div>
              ) : (
                currentRosterList.map((playerName, index) => {
                  const positionLabel = String(index + 1).padStart(2, '0');
                  const itemDetails = requestsByItemDetails[activeListTab]?.[playerName];
                  // Fall back to the request-time name when the live member record
                  // is missing (e.g. purged/vanished) so we never show a bare id.
                  const resolvedDisplayName = members[playerName]?.displayName || itemDetails?.name || playerName;
                  
                  const priorityScoreInt = itemDetails?.priority ?? 0;
                  const timestampTimeStr = itemDetails?.time || '';
                  return (
                    <div key={playerName} className="flex items-center justify-between bg-slate-950/30 border border-slate-900/40 px-3 py-2 rounded-xl text-xs hover:border-slate-800 hover:bg-slate-950/80 transition-colors">
                      <span className="text-slate-300 font-sans font-medium flex items-center gap-2.5 min-w-0 truncate flex-1">
                        <span className="text-slate-600 font-mono font-bold text-[11px] shrink-0">#{positionLabel}</span>
                        <span className="truncate">{resolvedDisplayName}</span>
                      </span>
                      <div className="flex items-center gap-4 shrink-0 font-mono text-[11px]">
                        <span className="text-cyan-400 font-bold w-12 text-center bg-cyan-950/30 border border-cyan-900/30 py-0.5 rounded-md text-[10px]">
                          {priorityScoreInt}
                        </span>
                        {timestampTimeStr ? (
                          <span className="text-slate-400 font-bold tracking-tight bg-slate-950 px-2 py-0.5 border border-slate-900 rounded-md shadow-inner select-none w-10 text-center text-[10px]">
                            {timestampTimeStr}
                          </span>
                        ) : (
                          <span className="text-slate-700 w-10 text-center text-[10px]">—:—</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        {/* CARDS REGISTRATION DECK */}
        <div className="lg:col-span-8">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
            {items.length === 0 ? (
              <div className="col-span-2 text-center py-16 bg-slate-900/10 border border-dashed border-slate-800 rounded-2xl text-xs text-slate-500 font-mono italic flex flex-col items-center justify-center gap-2">
                <IconPackage /> Set up loot items and events in Settings.
              </div>
            ) : (
              items.map(item => {
                const currentActive = liveCounts[item.id] || 0;
                const localInput = localSelections[item.id] || 0;
                const combinedTotal = currentActive + localInput;
                const limitQty = item.limitQty;
                
                // Construct architectural ambient shadow/border dynamically if a custom theme profile passes down
                const dynamicStroke = item.colorTheme?.startsWith('#') ? item.colorTheme : null;

                return (
                  <div 
                    key={item.id} 
                    style={{ boxShadow: dynamicStroke ? `0 4px 20px ${dynamicStroke}08` : 'none' }}
                    className={`bg-slate-900/40 border rounded-2xl p-4 flex flex-col justify-between space-y-4 hover:bg-slate-900/60 transition group ${
                      dynamicStroke ? 'border-slate-800/80' : 'border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate min-w-0">
                        <h3 className="text-xs font-semibold text-slate-200 truncate font-sans group-hover:text-indigo-400 transition flex items-center gap-1.5">
                          <span className="truncate">{item.name}</span>
                          {item.isHighValue && (
                            <span
                              className="shrink-0 text-amber-400"
                              title="High Value: Absent outcomes retain priority"
                            >
                              <IconMoneyBag />
                            </span>
                          )}
                        </h3>
                        <span className="font-mono text-[9px] text-slate-500 block mt-0.5">{item.id}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-mono tracking-wider uppercase shrink-0 font-bold border ${
                        currentActive > 0 
                          ? 'bg-indigo-950/40 border-indigo-500/30 text-indigo-400 shadow-sm' 
                          : 'bg-slate-950 border-slate-800 text-slate-500'
                      }`}>
                        {currentActive > 0 ? `${currentActive} Saved` : 'Idle'}
                      </span>
                    </div>

                    {/* 🛠️ UPGRADED STEPPER CONSOLE: Configured with a dedicated, low-profile one-click maximum fill action row */}
                    <div className="flex flex-col items-center justify-center bg-slate-950/40 border border-slate-800/50 rounded-xl py-2.5 shadow-inner space-y-1.5">
                      <div className="flex items-center justify-center gap-5">
                        <button
                          type="button"
                          onClick={() => adjustCounter(item.id, 'down', limitQty, currentActive)}
                          disabled={combinedTotal <= 1 || processing || !isGateOpen}
                          className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 text-xs font-bold hover:bg-slate-800 hover:text-white disabled:opacity-10 select-none cursor-pointer flex items-center justify-center transition shadow-sm"
                        >
                          -
                        </button>
                        
                        <div className="flex items-baseline gap-1.5 select-none font-mono">
                          <span className="text-xl font-black text-slate-100 tracking-tight">{combinedTotal}</span>
                          <span className="text-[10px] text-slate-600 font-bold">/</span>
                          <span className="text-[10px] text-slate-500 font-bold tracking-tight">{limitQty}</span>
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => adjustCounter(item.id, 'up', limitQty, currentActive)}
                          disabled={combinedTotal >= limitQty || processing || !isGateOpen}
                          className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 text-xs font-bold hover:bg-slate-800 hover:text-white disabled:opacity-10 select-none cursor-pointer flex items-center justify-center transition shadow-sm"
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!isGateOpen || processing) return;
                          // Set the input delta value exactly to match the remaining available limit cap headroom
                          setLocalSelections(prev => ({ ...prev, [item.id]: limitQty - currentActive }));
                        }}
                        disabled={combinedTotal >= limitQty || processing || !isGateOpen}
                        className="px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-800 hover:border-slate-700 text-[9px] font-mono font-bold uppercase tracking-wider text-indigo-400 disabled:opacity-20 transition cursor-pointer select-none"
                      >
                        Set Max
                      </button>
                    </div>

                    <div className="border-t border-slate-900/60 pt-2.5 text-[10px] font-mono space-y-1.5 text-slate-400">
                      <div className="flex justify-between items-center">
                        <span className="font-sans text-slate-500">Application Status:</span>
                        <span className={`font-bold ${currentActive > 0 ? 'text-indigo-400' : 'text-slate-600'}`}>
                          {currentActive > 0 ? 'ACTIVE' : 'NOT APPLIED'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="font-sans text-slate-500">Queue Status:</span>
                        <span className={`font-semibold ${currentActive > 0 ? 'text-amber-500' : 'text-slate-600'}`}>
                          {currentActive > 0 ? 'PENDING' : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* STICKY BAR ACTIONS BOTTOM CONTROL FLUID RUNNER */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-900 bg-slate-950/90 backdrop-blur-md p-4 z-40 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 shadow-inner hidden sm:block">
              <IconCart />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cart Status</span>
              <span className="text-xs font-mono font-bold tracking-tight text-slate-200 mt-0.5">
                {!isGateOpen 
                  ? 'Event is currently Locked' 
                  : totalStagedInCart > 0 
                    ? `${totalStagedInCart} Additional Request` 
                    : 'No adjustments made'}
              </span>
            </div>
          </div>
          <button
            onClick={handleBatchSubmitRequests}
            disabled={totalStagedInCart === 0 || processing || !isGateOpen}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition shadow-xl cursor-pointer disabled:bg-slate-900 disabled:border disabled:border-slate-800/80 disabled:text-slate-600 disabled:shadow-none"
          >
            {!isGateOpen ? 'Event Locked' : processing ? 'Submitting Requests...' : 'Submit Requests'}
          </button>
        </div>
      </div>

      {/* COUNTER BALANCE CANCELLATION MODAL ENGINE */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="fixed inset-0 z-0" onClick={() => setIsCancelModalOpen(false)} />
          <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl relative z-10 space-y-4">
            
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-200">Active Requests</h2>
                <p className="text-[11px] text-slate-400 mt-1">Select an active request below and press [drop] to cancel.</p>
              </div>
              <button 
                onClick={() => setIsCancelModalOpen(false)} 
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <IconX />
              </button>
            </div>

            {currentPhase === 3 && (
              <div className="flex items-center gap-2 bg-amber-950/20 border border-amber-500/20 text-amber-400 text-xs px-3.5 py-2 rounded-xl font-semibold shadow-inner">
                <IconLock /> Cancellations are locked during the Live Event / Auction phase.
              </div>
            )}

            {activeCancelableItems.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-slate-800 rounded-xl text-[11px] text-slate-500 font-mono italic">
                You have no active pending requests currently in queue.
              </div>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-0.5 scrollbar-thin">
                {activeCancelableItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between bg-slate-950 border border-slate-800/80 p-3 rounded-xl font-mono text-xs group hover:border-slate-700 transition">
                    <div className="truncate pr-3">
                      <div className="text-xs font-sans font-medium text-slate-300 truncate">{item.name}</div>
                      <div className="text-[9px] text-indigo-400 font-bold tracking-wider uppercase mt-0.5">Requested Qty: {liveCounts[item.id]}</div>
                    </div>
                    <button
                      onClick={() => handleExecuteCancel(item.id, item.name, liveCounts[item.id])}
                      disabled={processing || currentPhase === 3} 
                      title={currentPhase === 3 ? 'Cancellations are locked during the Live Event / Auction phase.' : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/20 border border-rose-500/20 hover:border-rose-500 hover:bg-rose-600 text-[10px] font-bold uppercase tracking-wider rounded-lg text-rose-400 hover:text-white transition cursor-pointer shrink-0 disabled:opacity-20 disabled:bg-slate-950 disabled:border-slate-800 disabled:text-slate-600"
                    >
                      <IconTrash /> Drop
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setIsCancelModalOpen(false)} 
                className="px-4 py-2 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-sm"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}