import { useMemo } from 'react';
import DiscordSignInButton from '../components/DiscordSignInButton';
import { oauthBridgeUserMessage } from '../utils/oauthErrorMessage';

export default function LandingPage() {
  const errorMessage = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (!err) return null;
    if (err === 'discord_rate_limited') {
      const until = params.get('until');
      if (!until || until === 'none' || until === 'later') {
        return 'That was not a Discord ban — a login gate misfired. Open /landing and try Sign in once.';
      }
      return `Discord is temporarily blocking this server IP. Try again after ${until}.`;
    }
    if (err === 'login_busy') {
      return 'Sign-in was already in progress. Wait a few seconds, then click once.';
    }
    if (err === 'oauth_offload_required') {
      return 'Sign-in cannot use the Render server IP. FRONTEND_URL on Render must be your Vercel site URL.';
    }
    if (err === 'oauth_bridge_failed') {
      return oauthBridgeUserMessage(params.get('detail'));
    }
    const map = {
      missing_code: 'Discord did not return an authorization code. Try again.',
      access_denied: 'Discord login was cancelled.',
      token_exchange_failed: 'Could not complete Discord login. Check OAuth redirect URI on Render.',
      discord_oauth_failed: 'Discord login failed. Do not spam Sign in — wait, then try once.',
    };
    return map[err] || `Login failed (${err}).`;
  }, []);

  const ctaClass = 'inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950">
      <video
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src="/assets/videos/landing-bg.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 bg-slate-950/55" aria-hidden="true" />

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-8 px-6 text-center">
        <h1 className="sr-only">RO Guild App</h1>
        <img
          src="/assets/brand/ro-guild-logo.png"
          alt="RO Guild App"
          className="h-28 w-auto object-contain drop-shadow-lg sm:h-36"
        />
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-slate-300 sm:text-base">
          Auctions, raid attendance, and Discord cards for your Ragnarok guild — private to each Discord server.
        </p>

        {errorMessage && (
          <div className="max-w-sm rounded-xl border border-rose-900/50 bg-rose-950/70 px-4 py-3 text-xs text-rose-300 font-mono">
            {errorMessage}
          </div>
        )}

        <div className="grid w-full gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 text-left shadow-xl">
            <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Sign in</div>
            <h2 className="mt-1 text-base font-semibold text-white">My guild already uses this</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Open the workspace for a Discord server that is already on RO Guild App. Members never pay.
            </p>
            <div className="mt-4">
              <DiscordSignInButton
                intent="signin"
                label="Sign in with Discord"
                className={`${ctaClass} bg-[#5865F2] hover:bg-[#4752C4]`}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-indigo-500/30 bg-slate-950/70 p-5 text-left shadow-xl">
            <div className="text-[10px] font-mono uppercase tracking-widest text-indigo-400">Get started</div>
            <h2 className="mt-1 text-base font-semibold text-white">Add my Discord server</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Create a workspace for your server. You need Manage Server. This is the account payments will use later.
            </p>
            <div className="mt-4">
              <DiscordSignInButton
                intent="signup"
                label="Get started with Discord"
                className={`${ctaClass} bg-indigo-600 hover:bg-indigo-500`}
              />
            </div>
          </div>
        </div>

        <p className="max-w-md text-[11px] leading-relaxed text-slate-500">
          You need a Discord account.{' '}
          <a
            href="https://discord.com/register"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-400 hover:text-indigo-300"
          >
            Create one on Discord
          </a>
          , join or create a server, then Sign in or Get started.
        </p>
      </div>
    </div>
  );
}
