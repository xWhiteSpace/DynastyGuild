import LeftNavBar from '../components/LeftNavBar';
import UserPanel from '../components/UserPanel';
import { useEffect, useRef, useState } from 'react';

export default function MainLayout({ children, user, onLogout, onSessionUser, macroTab, setMacroTab }) {
  const [macroBarVisible, setMacroBarVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      const delta = y - lastScrollY.current;

      if (y < 24) {
        setMacroBarVisible(true);
      } else if (delta > 8) {
        setMacroBarVisible(false);
      } else if (delta < -8) {
        setMacroBarVisible(true);
      }

      lastScrollY.current = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div
        className={`w-full bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-6 py-2.5 flex gap-5 text-xs font-mono select-none sticky top-0 z-[80] transition-transform duration-300 ${
          macroBarVisible ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <button
          type="button"
          onClick={() => setMacroTab('auction')}
          className={`hover:text-white transition-colors duration-100 cursor-pointer ${macroTab === 'auction' ? 'text-indigo-400 font-bold' : 'text-slate-400'}`}
        >
          [Auction]
        </button>
        <button
          type="button"
          onClick={() => setMacroTab('raid')}
          className={`hover:text-white transition-colors duration-100 cursor-pointer ${macroTab === 'raid' ? 'text-indigo-400 font-bold' : 'text-slate-400'}`}
        >
          [Raid]
        </button>
      </div>
      <div className="flex flex-1">
        <LeftNavBar macroTab={macroTab} />
        <main className="flex-1 p-6 lg:p-8">
          <div className="mb-6">
            <UserPanel user={user} onLogout={onLogout} onSessionUser={onSessionUser} />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
