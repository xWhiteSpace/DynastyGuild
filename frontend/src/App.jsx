// frontend/src/App.jsx
import { useEffect, useState, createContext, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import RequestTab from './pages/RequestTab';
import MimicBookTab from './pages/MimicBookTab';
import RequestHistoryTab from './pages/RequestHistoryTab';
import PastAuctionTab from './pages/PastAuctionTab';
import LandingPage from './pages/LandingPage';
import SettingsTab from './pages/SettingsTab'; // ◄ 1. ENSURE THIS IMPORT IS UNCOMMENTED
import { logoutUser } from './services/authService';
import MasterListTab from './pages/MasterListTab';

import RaidPartyTab from './pages/RaidPartyTab';
import RaidComposeTab from './pages/RaidComposeTab';
import Profile from './pages/Profile';
import StatisticsTab from './pages/StatisticsTab';
import LiveRaidTab from './pages/LiveRaidTab';
import AttendanceHistoryTab from './pages/AttendanceHistoryTab';

import Scheduler from './pages/Scheduler';
import SelectGuildPage from './pages/SelectGuildPage';
import OnboardGuildPage from './pages/OnboardGuildPage';
import { apiFetch } from './services/apiClient';
import { formatGuildDate, DEFAULT_TZ } from './utils/guildTime';

export const MimicBookContext = createContext(null);

const SESSION_KEY = 'guild_raid_session';
const LEGACY_SESSION_KEY = 'dynasty_raid_session';

function readSessionRaw() {
  const current = localStorage.getItem(SESSION_KEY);
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
  if (legacy) {
    localStorage.setItem(SESSION_KEY, legacy);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return legacy;
  }
  return null;
}

export function MimicBookProvider({ children }) {
  const [isAdminMode, setIsAdminMode] = useState(true); 
  const [activeStep, setActiveStep] = useState(1); 
  const [loadingPool, setLoadingPool] = useState(false);
  const [isLootHistoryOpen, setIsLootHistoryOpen] = useState(false);
  const [loadingLootHistory, setLoadingLootHistory] = useState(false);
  const [lootHistoryData, setLootHistoryData] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({}); 
  const [commitEvent, setCommitEvent] = useState('');
  const [availableEvents, setAvailableEvents] = useState({});
  const [commitDate, setCommitDate] = useState(() => formatGuildDate(new Date(), DEFAULT_TZ));
  const [committing, setCommittingSetting] = useState(false);
  const [syncingRoster, setSyncingRoster] = useState(false);
  const [items, setItems] = useState([]); 
  const [rankingsByItem, setRankingsByItem] = useState({});
  const [requestsByItemDetails, setRequestsByItemDetails] = useState({});
  const [masterGuildRoster, setMasterGuildRoster] = useState([]); 
  const [qtyPerPage, setQtyPerPage] = useState(4);
  const [lootRows, setLootRows] = useState([]);
  const [lootSummary, setLootSummary] = useState({});
  const [validationError, setValidationError] = useState('');
  const [liveGapsWarning, setLiveGapsWarning] = useState('');
  const [activeMatrixFilter, setActiveMatrixFilter] = useState('');
  const [categoryAllocations, setCategoryAllocations] = useState({});
  const [initialWinnersByItem, setInitialWinnersByItem] = useState({});
  const [isDiscordGateOpen, setIsDiscordGateOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('standby'); 
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [viewLens, setViewLens] = useState('MINE'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [bookCurrentPage, setBookCurrentPage] = useState(1);
  const [generatedSlots, setGeneratedSlots] = useState([]);
  const [autoCommitArmed, setAutoCommitArmed] = useState(false);
  const lastLocalWriteTimeRef = useRef(0);
  const clientVersionRef = useRef(0);

  return (
    <MimicBookContext.Provider value={{
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
    }}>
      {children}
    </MimicBookContext.Provider>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [macroTab, setMacroTab] = useState('auction');

  useEffect(() => {
    async function loadUser() {
      setAuthLoading(true);
      const urlParams = new URLSearchParams(window.location.search);
      const authUserRaw = urlParams.get('auth_user');

      if (authUserRaw) {
        try {
          let parsedUser;
          try {
            parsedUser = JSON.parse(decodeURIComponent(authUserRaw));
          } catch {
            parsedUser = JSON.parse(authUserRaw);
          }
          setAuthUser(parsedUser);
          localStorage.setItem(SESSION_KEY, JSON.stringify(parsedUser));
          localStorage.removeItem(LEGACY_SESSION_KEY);
          window.history.replaceState({}, document.title, window.location.pathname);
          setAuthLoading(false);
          return; 
        } catch (error) {
          console.error(error);
        }
      }

      // 🚀 CACHE PRE-LOAD: Instantly parse local storage to eliminate UI loading flicker
      const savedSession = readSessionRaw();
      let initialInMemoryUser = null;
      
      if (savedSession) {
        try {
          initialInMemoryUser = JSON.parse(savedSession);
          setAuthUser(initialInMemoryUser);
        } catch (e) {
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem(LEGACY_SESSION_KEY);
        }
      }

      // 🛰️ BACKGROUND SIGNATURE VERIFICATION: Verify token integrity with backend cryptographic seals
      try {
        const response = await apiFetch('/auth/me', { method: 'GET' });
        const result = await response.json();
        
        if (result.authenticated && result.user) {
          setAuthUser(result.user);
          localStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
          localStorage.removeItem(LEGACY_SESSION_KEY);
        } else {
          setAuthUser(null);
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem(LEGACY_SESSION_KEY);
        }
      } catch (err) {
        // Fallback: If your server is briefly unreachable, trust local cache to prevent offline lockouts
        if (!initialInMemoryUser) {
          setAuthUser(null);
        }
      } finally {
        setAuthLoading(false);
      }
    }
    loadUser();
  }, []);

  // Browser tab: "Sign in" while logged out; "{Guild} Guild App" after auth
  useEffect(() => {
    if (!authUser) {
      document.title = 'Sign in';
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/requests/settings/help', { method: 'GET' });
        const data = await res.json();
        if (cancelled) return;
        const name = (data?.guildDisplayName || '').trim();
        document.title = `${name || 'Guild'} Guild App`;
      } catch {
        if (!cancelled) document.title = 'Guild App';
      }
    })();
    return () => { cancelled = true; };
  }, [authUser]);

  const handleLogout = async () => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    await logoutUser();
    setAuthUser(null);
    window.location.assign('/landing');
  };

  const handleSessionUser = (nextUser) => {
    setAuthUser(nextUser);
    if (nextUser) localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
  };

  // Landing is public — don't block it behind session sync
  if (authLoading && window.location.pathname !== '/landing') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-white font-mono text-xs uppercase tracking-widest animate-pulse">
        Synchronizing Security Workspace Modules...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <MimicBookProvider>
        <AppShell
          authUser={authUser}
          onLogout={handleLogout}
          onSessionUser={handleSessionUser}
          macroTab={macroTab}
          setMacroTab={setMacroTab}
        />
      </MimicBookProvider>
    </BrowserRouter>
  );
}

/** Landing is full-bleed (no nav chrome); everything else stays in MainLayout. */
function AppShell({ authUser, onLogout, onSessionUser, macroTab, setMacroTab }) {
  const { pathname, search } = useLocation();

  // Old /login URLs (and OAuth error redirects) → landing, keep ?error=...
  if (pathname === '/login') {
    return <Navigate to={`/landing${search}`} replace />;
  }

  if (pathname === '/select-guild' && !authUser) {
    return <Navigate to="/landing" replace />;
  }
  if (pathname === '/onboard' && !authUser) {
    return <Navigate to="/landing" replace />;
  }
  if (pathname === '/select-guild' && authUser) {
    return <SelectGuildPage user={authUser} onSessionUser={onSessionUser} />;
  }
  if (pathname === '/onboard' && authUser) {
    return <OnboardGuildPage onSessionUser={onSessionUser} />;
  }

  // Signed-in users skip landing
  if (pathname === '/landing' && authUser) {
    if (!authUser.currentTenantId) return <Navigate to="/select-guild" replace />;
    return <Navigate to="/" replace />;
  }

  // Logged-out users: landing is the front door
  if (pathname === '/landing' && !authUser) {
    return <LandingPage />;
  }
  if (pathname === '/' && !authUser) {
    return <Navigate to="/landing" replace />;
  }

  if (authUser && !authUser.currentTenantId && pathname !== '/select-guild' && pathname !== '/onboard') {
    return <Navigate to="/select-guild" replace />;
  }

  return (
    <MainLayout user={authUser} onLogout={onLogout} onSessionUser={onSessionUser} macroTab={macroTab} setMacroTab={setMacroTab}>
      <Routes>
        <Route path="/" element={<RequestTab user={authUser} />} />
        <Route path="/mimic-book" element={<MimicBookTab user={authUser} />} />
        <Route path="/request-history" element={<RequestHistoryTab user={authUser} />} />
        <Route path="/past-auction" element={<PastAuctionTab />} />
        <Route path="/submit-evidence" element={<Navigate to="/" replace />} />

        {/* ⚙️ 2. MUST BE INSIDE THIS EXACT GROUP FOR FIRST-PARTY COMPONENT LAYOUTS */}
        <Route path="/settings-configuration" element={<SettingsTab />} />

        {/* 🛡️ Foundational Raid Governance Routes Mapping */}
        <Route path="/attendance/masterlist" element={<MasterListTab user={authUser} />} />
        <Route path="/attendance/profile" element={<Profile user={authUser} />} />
        <Route path="/attendance/profile/:uid" element={<Profile user={authUser} />} />
        <Route path="/attendance/raidparty" element={<RaidPartyTab user={authUser} />} />
        <Route path="/attendance/compose" element={<RaidComposeTab user={authUser} />} />
        <Route path="/attendance/liveraid" element={<LiveRaidTab user={authUser} />} />
        <Route path="/attendance/history" element={<AttendanceHistoryTab user={authUser} />} />
        <Route path="/attendance/statistics" element={<StatisticsTab user={authUser} />} />
        <Route path="/attendance/scheduler" element={<Scheduler user={authUser} />} />
      </Routes>
    </MainLayout>
  );
}