// frontend/src/pages/RequestHistoryTab.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const backendUrl = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:5001';

// --- 🎨 PURE VECTOR MICRO-ICONS CONSOLE ---
const IconSearch = () => <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconGlobal = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
const IconUser = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconDownload = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v4M7 10l5 5 5-5M12 15V3"/></svg>;
const IconUndo = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>;
const IconAward = () => <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>;
const IconLayers = () => <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polygon points="2 17 12 22 22 17"/><polygon points="2 12 12 17 22 12"/></svg>;
const IconTrash = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>;
const IconAlertTriangle = () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"/></svg>;
const IconX = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>;
const IconSortArrows = ({ active, direction }) => {
  if (!active) return <svg className="w-3 h-3 text-slate-600 inline ml-1.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>;
  return direction === 'asc' 
    ? <svg className="w-3 h-3 text-indigo-400 inline ml-1.5 animate-fadeIn" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
    : <svg className="w-3 h-3 text-indigo-400 inline ml-1.5 animate-fadeIn" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>;
};

export default function RequestHistoryTab({ user }) {
  const navigate = useNavigate();
  const isOfficer = user?.isOfficer === true;
  const [loading, setLoading] = useState(true);
  const [historyData, setHistoryData] = useState([]);
  const [currentUserName, setCurrentUserName] = useState('');
  const [configItems, setConfigItems] = useState([]); // Dynamic setting collection matrix
  const [authError, setAuthError] = useState(false);
  const [resettingKey, setResettingKey] = useState(null); // 🛡️ Tracks in-flight officer priority reset requests
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [clearRangeStart, setClearRangeStart] = useState('');
  const [clearRangeEnd, setClearRangeEnd] = useState('');
  const [clearingHistory, setClearingHistory] = useState(false);

  const [currentUserId, setCurrentUserId] = useState('');
  
  // --- 🔍 ADVANCED FILTER, SEARCH, AND SORT STATES ---
  const [viewFilter, setViewFilter] = useState('all'); // 'all' or 'mine'
  const [searchQuery, setSearchQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [rowLimit, setRowLimit] = useState(20); // 📊 Dynamic capacity limit selector (20, 60, 100)
  
  const [historyPage, setHistoryPage] = useState(1); // 🧭 Current navigation page track

  // 🔄 Sync Reset Hook: Prevents index overflows by resetting page marker when filter arrays mutate
  useEffect(() => {
    setHistoryPage(1);
  }, [viewFilter, searchQuery, outcomeFilter, rowLimit]);

  // Sorting controls
  const [sortKey, setSortKey] = useState('date'); // 'date', 'member', 'item', or 'priority'
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' or 'desc'

  const fetchGlobalHistoryLog = async () => {
    try {
      setLoading(true);
      setAuthError(false);

      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      
      if (savedUserSession) {
        try {
          const parsedUser = JSON.parse(savedUserSession);
          setCurrentUserName(parsedUser.displayName || parsedUser.username || '');
          setCurrentUserId(parsedUser.id || '');
          customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);
        } catch (e) {
          console.error("Failed to extract cached session criteria:", e.message);
        }
      }

      const res = await fetch(`${backendUrl}/api/requests/request-history`, {
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
        setHistoryData(data.history || []);

        // Query dynamic item mapping tables to link relational styling indexes inline
        try {
          const configRes = await fetch(`${backendUrl}/api/requests/settings/get`, {
            headers: customHeaders,
            credentials: 'include'
          });
          const configData = await configRes.json();
          if (configData.success && configData.config?.items) {
            setConfigItems(configData.config.items);
          }
        } catch (err) {
          console.error("Failed to map live configuration styles:", err);
        }
      }
    } catch (err) {
      console.error("Connection link offline:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGlobalHistoryLog();
  }, []);

  const handleSortToggle = (targetKey) => {
    if (sortKey === targetKey) {
      // Toggle direction if clicking the same header row
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      // Set new key and default to ascending order
      setSortKey(targetKey);
      setSortDirection('asc');
    }
  };

  const getSortIconIndicator = (targetKey) => {
    if (sortKey !== targetKey) return '↕';
    return sortDirection === 'asc' ? '▲' : '▼';
  };

  // 🛡️ OFFICER GUARDRAIL: Manually force a member's priority on a specific item back to
  // zero — the safety valve for the High Value "retained priority on Absent" ruling.
  const handleResetPriority = async (targetUserId, itemId, memberName, itemName) => {
    if (!isOfficer || !targetUserId || !itemId) return;
    const resetKey = `${targetUserId}_${itemId}`;
    if (!window.confirm(`Force reset priority for ${memberName || 'this member'} on ${itemName || itemId}? This cannot be undone.`)) {
      return;
    }

    try {
      setResettingKey(resetKey);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);

      const res = await fetch(`${backendUrl}/api/requests/reset-priority`, {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({ userId: targetUserId, itemId }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        await fetchGlobalHistoryLog();
      } else {
        alert(data.error || 'Failed to reset priority.');
      }
    } catch (err) {
      console.error("Priority reset request failed:", err.message);
      alert('Connection error while resetting priority.');
    } finally {
      setResettingKey(null);
    }
  };

  // 🗑️ OFFICER GUARDRAIL: Permanently deletes ledger rows within a selected Timestamp
  // date range. A live preview count (computed below) is shown before this ever fires.
  const handleClearHistory = async () => {
    if (!isOfficer || !clearRangeStart || !clearRangeEnd || clearPreviewCount === 0) return;
    if (!window.confirm(`Permanently delete ${clearPreviewCount} record(s) dated ${clearRangeStart} through ${clearRangeEnd}? This cannot be undone.`)) {
      return;
    }

    try {
      setClearingHistory(true);
      const savedUserSession = localStorage.getItem('guild_raid_session');
      const customHeaders = { 'Content-Type': 'application/json' };
      if (savedUserSession) customHeaders['x-user-profile'] = encodeURIComponent(savedUserSession);

      const res = await fetch(`${backendUrl}/api/requests/clear-history`, {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({ startDate: clearRangeStart, endDate: clearRangeEnd }),
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setIsClearModalOpen(false);
        setClearRangeStart('');
        setClearRangeEnd('');
        await fetchGlobalHistoryLog();
        alert(`${data.deletedCount} record(s) permanently deleted.`);
      } else {
        alert(data.error || 'Failed to clear history.');
      }
    } catch (err) {
      console.error("Clear history request failed:", err.message);
      alert('Connection error while clearing history.');
    } finally {
      setClearingHistory(false);
    }
  };

 const getItemStyleProfile = (itemType, itemId) => {
    const THEME_MAP = {
      purple: 'text-violet-400 border-violet-500/30 bg-violet-950/20 shadow-[0_0_15px_rgba(139,92,246,0.1)]',
      yellow: 'text-yellow-400 border-yellow-500/30 bg-yellow-950/10 shadow-[0_0_15px_rgba(234,179,8,0.1)]',
      slate:  'text-slate-100 border-slate-700 bg-slate-900/40 shadow-[0_0_15px_rgba(255,255,255,0.05)]',
      red:    'text-red-500 border-red-950 bg-black/60 border-l-4 border-l-red-600'
    };

    const matchedItem = configItems.find(i => 
      (itemId && i.id.toLowerCase() === itemId.toLowerCase()) || 
      (itemType && i.name.toLowerCase() === itemType.toLowerCase())
    );

    // If it's a dynamic Hex Color from the system color wheel
    if (matchedItem?.colorTheme?.startsWith('#')) {
      return {
        className: 'px-2.5 py-0.5 rounded border text-[10px] font-sans font-semibold',
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
      className: `px-2.5 py-0.5 rounded border text-[10px] font-sans font-semibold ${baseClass}`,
      style: {}
    };
  };

  // 📋 Apply Filtering Matrix Logic
  const filteredRecords = historyData.filter(row => {
    if (viewFilter === 'mine') {
      const isMatch = row.userId === currentUserId;
      if (!isMatch) return false;
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesMember = (row.member || '').toLowerCase().includes(query);
      const matchesItem = (row.item || '').toLowerCase().includes(query);
      if (!matchesMember && !matchesItem) return false;
    }
    if (outcomeFilter !== 'all' && (row.selectionStatus || '').toLowerCase() !== outcomeFilter.toLowerCase()) {
      return false;
    }
    return true;
  });

  // 📊 Apply Interactive Multi-Column Sorting Engine (Propagates straight into CSV exports too!)
  const sortedRecords = [...filteredRecords].sort((a, b) => {
    let comparison = 0;

    switch (sortKey) {
      case 'date': {
        // Safe string chronological timestamp grouping
        const dateA = new Date(a.date || 0);
        const dateB = new Date(b.date || 0);
        comparison = dateA - dateB;
        break;
      }
      case 'member': {
        comparison = (a.member || '').localeCompare(b.member || '');
        break;
      }
      case 'item': {
        comparison = (a.item || '').localeCompare(b.item || '');
        break;
      }
      case 'priority': {
        comparison = (parseInt(a.priority, 10) || 0) - (parseInt(b.priority, 10) || 0);
        break;
      }
      default:
        break;
    }

    return sortDirection === 'asc' ? comparison : comparison * -1;
  });

  const historyTotalPages = Math.ceil(sortedRecords.length / rowLimit) || 1;

  // 🔎 LIVE CLEAR-HISTORY PREVIEW: Counts how many already-loaded rows fall inside the
  // selected range, so officers see the exact impact before anything is deleted.
  const clearPreviewCount = (() => {
    if (!clearRangeStart || !clearRangeEnd) return 0;
    const rangeStart = new Date(clearRangeStart);
    const rangeEnd = new Date(`${clearRangeEnd}T23:59:59.999`);
    if (isNaN(rangeStart) || isNaN(rangeEnd) || rangeStart > rangeEnd) return 0;
    return historyData.filter(row => {
      const rowDate = new Date(row.date || '');
      return !isNaN(rowDate) && rowDate >= rangeStart && rowDate <= rangeEnd;
    }).length;
  })();

  /**
   * 📥 BROWSER-NATIVE CSV EXPORT MODULE
   */
  const handleDownloadCSVExport = () => {
    if (sortedRecords.length === 0) return;

    const csvHeaders = ["Timestamp", "Member", "Item", "Qty", "ApplicationStatus", "SelectionStatus", "LiveStatus", "Priority", "EventDate"];
    
    const csvRows = sortedRecords.map(row => [
      `"${row.date}"`,
      `"${row.member}"`,
      `"${row.item}"`,
      row.quantity,
      `"${row.applicationStatus}"`,
      `"${row.selectionStatus}"`,
      `"${row.liveStatus}"`,
      row.priority,
      `"${row.eventDate || ''}"`
    ]);

    const csvContent = [
      csvHeaders.join(","),
      ...csvRows.map(e => e.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `RequestHistory_Export_${viewFilter.toUpperCase()}_Sorted_${sortKey.toUpperCase()}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      <div className="flex h-64 items-center justify-center text-slate-400 font-medium animate-pulse">
        Reading historical priority allocations...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 text-white pb-32 relative font-sans space-y-4">
      
      {/* HEADER CONTROLS PLACEMENT */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:flex-row sm:items-center shadow-md select-none">
        <div>
          <h1 className="text-lg font-bold tracking-wider text-slate-200 uppercase">Request History Ledger</h1>
          <div className="text-[11px] font-mono text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span>USER: <strong className="text-indigo-400 font-sans font-semibold">{currentUserName || 'Unassigned'}</strong></span>
            <span>TOTAL ROWS: <strong className="text-slate-300">{sortedRecords.length} ROWS</strong></span>
          </div>
        </div>

        <div className="flex bg-slate-950 p-0.5 rounded-xl border border-slate-800 shrink-0 gap-0.5 shadow-inner">
          <button
            type="button"
            onClick={() => setViewFilter('all')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
              viewFilter === 'all' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <IconGlobal /> All Records
          </button>
          <button
            type="button"
            onClick={() => setViewFilter('mine')}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
              viewFilter === 'mine' ? 'bg-indigo-600 text-white shadow font-bold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <IconUser /> My Record
          </button>
        </div>
      </div>

      {/* --- 🔍 STREAMLINED LIVE FILTER CONTROL CONSOLE PANEL --- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl shadow-md">
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5 select-none">
            <IconSearch /> Name / Item Search
          </label>
          <input 
            type="text"
            placeholder="Filter by keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 placeholder-slate-650 outline-none focus:border-slate-700 transition shadow-inner font-sans"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5 select-none">
            <IconAward /> Filter
          </label>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-300 outline-none focus:border-slate-700 transition shadow-inner font-sans font-medium cursor-pointer"
          >
            <option value="all" className="bg-slate-950 text-slate-300">All Status</option>
            <option value="pending" className="bg-slate-950 text-slate-300">Pending</option>
            <option value="selected" className="bg-slate-950 text-slate-300">Selected</option>
            <option value="notselected" className="bg-slate-950 text-slate-300">NotSelected</option>
            <option value="absent" className="bg-slate-950 text-slate-300">Absent</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5 select-none">
            <IconLayers /> Show Record
          </label>
          <select
            value={rowLimit}
            onChange={(e) => setRowLimit(parseInt(e.target.value, 10))}
            className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-300 outline-none focus:border-slate-700 transition shadow-inner font-sans font-medium cursor-pointer"
          >
            <option value={20} className="bg-slate-950 text-slate-300">Display 20 Rows</option>
            <option value={60} className="bg-slate-950 text-slate-300">Display 60 Rows</option>
            <option value={100} className="bg-slate-950 text-slate-300">Display 100 Rows</option>
          </select>
        </div>
      </div>

      {/* GLOBAL VIEW-ONLY REQUISITION GRID MATRIX */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto overflow-y-auto max-h-[60vh] scrollbar-thin">
          <table className="w-full text-left border-collapse table-fixed min-w-[950px] text-xs font-mono">
            <thead>
              <tr className="bg-slate-950 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-800 sticky top-0 z-10 text-[9px] select-none">
                
                {/* INTERACTIVE COLUMN HEADERS */}
                <th 
                  onClick={() => handleSortToggle('date')}
                  className="p-3.5 cursor-pointer hover:bg-slate-900/60 hover:text-slate-200 transition-colors group w-[14%]"
                >
                  Timestamp <IconSortArrows active={sortKey === 'date'} direction={sortDirection} />
                </th>
                
                <th 
                  onClick={() => handleSortToggle('member')}
                  className="p-3.5 cursor-pointer hover:bg-slate-900/60 hover:text-slate-200 transition-colors group w-[18%]"
                >
                  Member <IconSortArrows active={sortKey === 'member'} direction={sortDirection} />
                </th>
                
                <th 
                  onClick={() => handleSortToggle('item')}
                  className="p-3.5 cursor-pointer hover:bg-slate-900/60 hover:text-slate-200 transition-colors group w-[18%]"
                >
                  Item Variant <IconSortArrows active={sortKey === 'item'} direction={sortDirection} />
                </th>
                
                <th className="p-3.5 text-center font-semibold w-[5%]">Qty</th>
                <th className="p-3.5 font-semibold w-[11%]">Request Status</th>
                <th className="p-3.5 font-semibold w-[15%]">Bid Status</th>
                <th className="p-3.5 font-semibold w-[11%]">Live Status</th>
                
                <th 
                  onClick={() => handleSortToggle('priority')}
                  className="p-3.5 text-center cursor-pointer hover:bg-slate-900/60 hover:text-slate-200 transition-colors group w-[8%]"
                >
                  Priority <IconSortArrows active={sortKey === 'priority'} direction={sortDirection} />
                </th>
                
                <th className="p-3.5 font-semibold text-right pr-5 w-[10%]">Event Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 bg-slate-900/40 text-slate-300">
              {sortedRecords.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-slate-600 italic font-sans text-xs select-none">
                    No transaction entries matching this specific filter matrix query layout criteria.
                  </td>
                </tr>
              ) : (
                sortedRecords.slice((historyPage - 1) * rowLimit, historyPage * rowLimit).map((row) => {
                  const selStatus = (row.selectionStatus || '').toLowerCase();
                  const appStatus = (row.applicationStatus || '').toLowerCase();
                  const isSelected = selStatus === 'selected';
                  const isPending = selStatus === 'pending';
                  const isVoided = appStatus === 'canceled'; // 🎯 Target the intent state directly

                  return (
                    <tr 
                      key={row.id} 
                      className={`group border-b border-slate-900/30 transition-all duration-75 ${
                        isVoided ? 'opacity-35 text-slate-500 bg-slate-950/5' : 'text-slate-450'
                      }`}
                    >
                      <td className="p-3 whitespace-nowrap text-[11px] select-none text-slate-500">{row.date}</td>
                      <td className={`p-3 font-sans font-normal truncate whitespace-nowrap group-hover:text-white transition-colors ${isVoided ? 'line-through text-slate-500' : 'text-slate-400'}`}>{row.member}</td>
                      <td className="p-3 font-sans whitespace-nowrap">
                        {(() => {
                          const profile = getItemStyleProfile(row.item, row.itemId);
                          return (
                            <span className={profile.className} style={profile.style}>
                              {row.item || row.itemId}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-3 font-normal text-center group-hover:text-slate-200 transition-colors">{row.quantity}</td>
                      <td className={`p-3 font-sans text-[11px] uppercase tracking-wide ${isVoided ? 'line-through text-slate-500' : ''}`}>
                        {row.applicationStatus}
                      </td>
                      <td className="p-3 truncate">
                        <span className="inline-flex items-center gap-1.5 font-sans text-[11px] uppercase tracking-wide max-w-full truncate">
                          <span className={`w-1 h-1 rounded-full shrink-0 ${
                            isSelected ? 'bg-emerald-400 shadow shadow-emerald-400/50' : isPending ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
                          }`} />
                          <span className={`truncate ${isVoided ? 'line-through text-slate-500' : ''}`}>{row.selectionStatus}</span>
                        </span>
                      </td>
                      <td className="p-3 text-slate-500 group-hover:text-slate-400 transition-colors whitespace-nowrap text-[10px] font-sans uppercase font-bold tracking-wide truncate">
                        <span className="block truncate">{row.liveStatus ? row.liveStatus : '---'}</span>
                      </td>
                      <td className="p-3 font-normal text-center text-cyan-600/90 group-hover:text-cyan-400 transition-colors">
                        <span className="inline-flex items-center justify-center gap-1.5">
                          <span>{row.priority}</span>
                          {isOfficer && row.userId && row.itemId && (
                            <button
                              type="button"
                              onClick={() => handleResetPriority(row.userId, row.itemId, row.member, row.item)}
                              disabled={resettingKey === `${row.userId}_${row.itemId}`}
                              className="text-slate-700 hover:text-amber-400 transition opacity-0 group-hover:opacity-100 cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                              title={`Force reset priority for ${row.member} on ${row.item || row.itemId}`}
                            >
                              <IconUndo />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500 group-hover:text-slate-400 transition-colors font-semibold whitespace-nowrap text-right pr-5">
                        {row.eventDate === "" ? "---" : row.eventDate}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* INTERACTIVE LEDGER PAGINATION CONTROL BAR */}
        <div className="flex items-center justify-between p-3 px-4 bg-slate-950 border-t border-slate-800 text-xs font-mono select-none rounded-b-2xl">
          <button 
            type="button"
            onClick={() => setHistoryPage(Math.max(1, historyPage - 1))} 
            disabled={historyPage === 1} 
            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-[10px] font-bold disabled:opacity-10 transition cursor-pointer shadow-sm"
          >
            ◀ PREV
          </button>
          <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">
            PAGE <span className="text-white bg-slate-900 px-1.5 py-0.5 border border-slate-800 rounded mx-0.5 font-sans">{historyPage}</span> OF {historyTotalPages}
          </div>
          <button 
            type="button"
            onClick={() => setHistoryPage(Math.min(historyTotalPages, historyPage + 1))} 
            disabled={historyPage === historyTotalPages} 
            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-[10px] font-bold disabled:opacity-10 transition cursor-pointer shadow-sm"
          >
            NEXT ▶
          </button>
        </div>
      </div>

      {/* IN-FLOW LEDGER ACTION PLATFORM FOOTER CONTAINER */}
      <div className="w-full select-none pt-2 animate-fadeIn">
        <div className="w-full flex items-center justify-between bg-slate-900/40 border border-slate-800/80 p-3 px-5 rounded-2xl shadow-md">
          
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadCSVExport}
              disabled={sortedRecords.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold uppercase tracking-wider text-white transition py-2 px-4 shadow cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <IconDownload /> Export to CSV
            </button>

            {isOfficer && (
              <button
                type="button"
                onClick={() => setIsClearModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-950/20 hover:bg-rose-600 hover:border-rose-500 text-[10px] font-bold uppercase tracking-wider text-rose-400 hover:text-white transition py-2 px-4 shadow cursor-pointer"
              >
                <IconTrash /> Clear History
              </button>
            )}
          </div>
          
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider transition py-2 px-4 shadow cursor-pointer"
          >
            <IconUndo /> Return to Request
          </button>
          
        </div>
      </div>

      {/* 🗑️ CLEAR HISTORY DATE-RANGE MODAL (OFFICER-ONLY DESTRUCTIVE ACTION) */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-fadeIn">
          <div className="fixed inset-0 z-0" onClick={() => !clearingHistory && setIsClearModalOpen(false)} />
          <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl relative z-10 space-y-4">

            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-semibold tracking-wider uppercase text-rose-400">Clear History</h2>
                <p className="text-[11px] text-slate-400 mt-1">Permanently delete ledger rows within a Timestamp date range.</p>
              </div>
              <button
                onClick={() => !clearingHistory && setIsClearModalOpen(false)}
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <IconX />
              </button>
            </div>

            <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-500/20 text-amber-400 text-[11px] px-3.5 py-2.5 rounded-xl font-medium shadow-inner">
              <IconAlertTriangle />
              <span>Rows inside the configured Priority Lookback window still feed current pity calculations. Clearing them removes that history from future priority scoring.</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider select-none">From</label>
                <input
                  type="date"
                  value={clearRangeStart}
                  onChange={(e) => setClearRangeStart(e.target.value)}
                  className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 outline-none focus:border-slate-700 transition shadow-inner font-sans"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider select-none">To</label>
                <input
                  type="date"
                  value={clearRangeEnd}
                  onChange={(e) => setClearRangeEnd(e.target.value)}
                  className="w-full h-9 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 outline-none focus:border-slate-700 transition shadow-inner font-sans"
                />
              </div>
            </div>

            <div className={`text-center py-3 rounded-xl border font-mono text-xs font-bold ${
              clearPreviewCount > 0
                ? 'bg-rose-950/20 border-rose-500/30 text-rose-400'
                : 'bg-slate-950 border-slate-800 text-slate-600'
            }`}>
              {!clearRangeStart || !clearRangeEnd
                ? 'Select both dates to preview affected records.'
                : `${clearPreviewCount} record(s) will be permanently deleted`}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsClearModalOpen(false)}
                disabled={clearingHistory}
                className="px-4 py-2 border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition cursor-pointer shadow-sm disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                disabled={clearingHistory || clearPreviewCount === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-[10px] font-bold uppercase tracking-wider rounded-xl text-white transition cursor-pointer shadow-md disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <IconTrash /> {clearingHistory ? 'Deleting...' : `Delete ${clearPreviewCount} Record(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}