import { useEffect, useState } from 'react';
import { getBackendUrl } from '../services/apiClient';

const backendUrl = getBackendUrl();

const IconDiscord = () => (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.094 13.094 0 01-1.873-.894.077.077 0 01-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 01.077-.011c3.92 1.793 8.18 1.793 12.061 0a.073.073 0 01.078.009c.12.099.246.195.373.289a.077.077 0 01-.006.127 12.298 12.298 0 01-1.873.894.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03a.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.156 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.156 2.418z" />
  </svg>
);

/**
 * Sign-in must not keep POSTing /oauth2/token from the Render IP during a
 * Cloudflare global block — each extra click extends the ban.
 */
export default function DiscordSignInButton({
  className = '',
  compact = false,
  intent = 'signin',
  label,
}) {
  const params = new URLSearchParams(window.location.search);
  const urlBlocked = params.get('error') === 'discord_rate_limited';
  const urlUntil = params.get('until');

  const [clicked, setClicked] = useState(false);
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${backendUrl}/api/debug/discord-ratelimit`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setRemote(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const untilLooksReal = urlUntil && urlUntil !== 'none' && urlUntil !== 'later';
  const loginExempt = remote?.oauthOffRender === true || remote?.oauthLocalRedirect === true;
  const blocked = !loginExempt && (
    (urlBlocked && untilLooksReal) || remote?.circuitOpen === true || remote?.coolingDown === true
  );
  const until = urlUntil || remote?.untilHuman || remote?.remainingHuman;
  const disabled = blocked || clicked;
  const resolvedIntent = intent === 'signup' ? 'signup' : 'signin';
  const buttonLabel = label
    || (compact ? 'Sign in' : resolvedIntent === 'signup' ? 'Get started with Discord' : 'Sign in with Discord');

  const href = `${backendUrl}/auth/login?intent=${encodeURIComponent(resolvedIntent)}`;

  const rememberIntent = () => {
    try {
      sessionStorage.setItem('ro_guild_intent', resolvedIntent);
    } catch {
      /* ignore */
    }
    setClicked(true);
  };

  if (disabled) {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          disabled
          className={`${className} cursor-not-allowed opacity-50`}
        >
          <IconDiscord />
          {blocked ? 'Sign in paused' : 'Redirecting…'}
        </button>
        {blocked && (
          <p className="max-w-xs text-[11px] leading-relaxed text-amber-400/90">
            {remote?.circuitOpen
              ? `Do not retry. Discord is blocking this server IP${until ? ` until ${until}` : ''}. Extra clicks make the ban last longer.`
              : `Sign-in is paused${until ? ` until ${until}` : ''} so Discord traffic stays spaced. Wait — do not refresh.`}
          </p>
        )}
      </div>
    );
  }

  return (
    <a
      href={href}
      onClick={rememberIntent}
      className={className}
    >
      <IconDiscord />
      {buttonLabel}
    </a>
  );
}
