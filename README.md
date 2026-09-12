# Guild Name

Guild tooling for auction requests, Mimic Book allocation, attendance / raid parties, live raid voice tracking, and Discord cards.

**Requirements / SRS:** [Requirements/Requirements.md](Requirements/Requirements.md)

This README is the **how to install and run** guide. It assumes you have never used the Discord Developer Portal, Firebase, Render, or Vercel before.

---

## What you will set up

| Piece | Role |
| :--- | :--- |
| **Discord** | User login (OAuth) + bot (announcements, auction / attendance / party cards, voice) |
| **Firebase Realtime Database** | Shared data store |
| **Render** | Hosts the **backend** (API + Discord bot, one Node process) |
| **Vercel** | Hosts the **frontend** (React site) |

```text
Browser  →  Vercel (frontend)
                │
                ├── API / login  →  Render (backend + Discord bot)
                │                        │
                │                        ├── Firebase Admin SDK → Realtime Database
                │                        └── Discord API / Gateway
                │
                └── (optional) Firebase client → Realtime Database
```

**Recommended order**

1. Discord application (OAuth + Bot)
2. Firebase project (Realtime Database + Web app + service account)
3. Discord server channels + invite bot + copy IDs
4. Local `.env` files (optional smoke test)
5. Deploy backend on Render
6. Deploy frontend on Vercel
7. Wire URLs (OAuth redirect, `FRONTEND_URL`, `VITE_BACKEND_API_URL`)
8. Confirm the bot is in the Discord server (slash commands are not used)
9. First login → unlock Settings → match Discord admin role names

---

## Prerequisites

- A computer with [Node.js LTS](https://nodejs.org/) installed (for local run)
- A GitHub account (to connect Render / Vercel to this repo)
- A Discord account and a Discord **server** you admin
- Free accounts on [Firebase](https://console.firebase.google.com/), [Render](https://render.com/), and [Vercel](https://vercel.com/)

Enable **Developer Mode** in Discord (User Settings → App Settings → Advanced → Developer Mode) so you can **Copy Server ID** and **Copy Channel ID**.

---

## 1. Discord Developer Portal

### 1.1 Create an application

1. Open [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**, name it (e.g. `GuildName`), accept terms, **Create**
3. On **General Information**, copy **Application ID** → this is `DISCORD_CLIENT_ID` (and `VITE_DISCORD_CLIENT_ID` if you set it)

### 1.2 Create a bot

1. Left sidebar → **Bot** → **Add Bot** → confirm
2. Under **Token**, click **Reset Token** / **Copy** → save as `DISCORD_BOT_TOKEN` (never commit this)
3. Enable these **Privileged Gateway Intents**:
   - **Server Members Intent**
   - **Message Content Intent**
4. Save changes

Presence Intent is **not** required by this repo.

### 1.3 OAuth2 client secret + redirect

1. Left sidebar → **OAuth2**
2. Copy **Client Secret** → `DISCORD_CLIENT_SECRET`
3. Under **Redirects**, add URLs (you can add both; use the one that matches where the backend runs):

| Environment | Redirect URL |
| :--- | :--- |
| Local | `http://localhost:5001/auth/callback` |
| Production (Render) | `https://YOUR-RENDER-SERVICE.onrender.com/auth/callback` |

Exact match is required (no trailing slash after `callback`).

The app requests Discord scope **`identify` only** (login). Slash commands use the bot token separately.

### 1.4 Invite the bot to your server

1. OAuth2 → **URL Generator**
2. Scopes: check **`bot`** and **`applications.commands`**
3. Bot permissions — check at least:

   - View Channels  
   - Send Messages  
   - Embed Links  
   - Read Message History  
   - Use Application Commands  
   - Manage Nicknames (`/namechange`)  
   - Create Public Threads  
   - Send Messages in Threads  
   - Connect (helps with voice / war rooms; voice **state** tracking also needs the Voice States intent, which is not privileged)

4. Copy the generated URL, open it, pick your server, authorize

### 1.5 Create channels and copy IDs

In your Discord server, create (or reuse) channels. Map them during onboard / Settings (Developer Mode → Copy Channel ID). `DISCORD_*` channel env vars are for the one-time JSON import CLI only.

| Env variable | What to put |
| :--- | :--- |
| `DISCORD_GUILD_ID` | Server ID (import CLI only) |
| `DISCORD_GENROOM_ID_1` | General text channel (import CLI only; not a slash-command room) |
| `DISCORD_AUCTION_CHANNEL_ID` | Channel for phase announcements / request snapshots |
| `DISCORD_AUCREQ_CHANNEL_ID` | Channel for the interactive auction claim card |
| `DISCORD_ATTENDANCE_ID` | Channel where the weekly attendance thread is created |
| `DISCORD_WARROOM_ID_1` … `_5` | **Voice** channel IDs used as war rooms |

---

## 2. Firebase (Realtime Database only)

Do **not** create Firestore for this project. Use **Realtime Database**.

### 2.1 Create a project

1. Open [Firebase Console](https://console.firebase.google.com/)
2. **Add project** → name it → continue (Google Analytics optional)
3. Open the project

### 2.2 Create Realtime Database

1. Build → **Realtime Database** → **Create Database**
2. Pick a region → start in **locked mode** (you will paste rules next)
3. Copy the database URL (looks like `https://YOUR-PROJECT-ID-default-rtdb.REGION.firebasedatabase.app` or `https://YOUR-PROJECT-ID.firebaseio.com`) → `FIREBASE_DATABASE_URL` and `VITE_FIREBASE_DATABASE_URL`

### 2.3 Security rules

Realtime Database → **Rules** → replace with:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null",
    "auction": {
      "web_requests": {
        ".indexOn": ["userId", "selectionStatus"]
      }
    }
  }
}
```

Click **Publish**.

**Important:** This app logs users in with **Discord**, not Firebase Auth. The **backend** uses the Firebase **Admin SDK**, which **bypasses** these rules. Most reads/writes go through Render. Browser Firebase listeners only work if rules allow them; with `auth != null` and no Firebase Auth, client listeners may fail and the UI falls back to API polling (this is expected).

### 2.4 Register a Web app (Project settings → Your apps)

This is where the frontend `VITE_FIREBASE_*` values come from.

1. Gear icon → **Project settings**
2. Scroll to **Your apps**
3. Click the **Web** icon (`</>`)
4. Register app nickname (e.g. `guild-web`) → **Register app**
5. Copy the `firebaseConfig` fields into frontend env:

| Firebase config key | Frontend env |
| :--- | :--- |
| `apiKey` | `VITE_FIREBASE_API_KEY` |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
| `databaseURL` | `VITE_FIREBASE_DATABASE_URL` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `VITE_FIREBASE_APP_ID` |

You do **not** need Firebase Authentication product enabled for Discord login.

### 2.5 Service account (backend Admin SDK)

1. Project settings → **Service accounts**
2. **Generate new private key** → download JSON
3. Map into backend env:

| JSON field | Backend env |
| :--- | :--- |
| `project_id` | `FIREBASE_PROJECT_ID` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |

On Render, paste the private key as one line with literal `\n` for newlines, usually wrapped in double quotes, e.g.:

```text
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

### 2.6 Do beginners need to seed data?

**No manual seed.** The first successful `GET /api/requests/settings/get` (opening **Settings** in the app) writes default configuration to `settings/configuration` if the node is empty.

You **should** still:

1. Sign in with Discord and pick (or set up) your server
2. Unlock Settings as the person who set up the guild, or with a Discord role listed under Access Governance
3. Pick officer Discord roles from the live list in Settings
4. Fill **Jobs** / **Roles** catalogs in Settings (job/role changes are on the attendance card)

---

## 3. Environment files (reference)

Copy examples, then fill values:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### Backend (`backend/.env`) — required at boot

See `backend/.env.example`. Required by `backend/src/config/env.js`:

- Discord: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, channel IDs listed above  
- OAuth: `OAUTH_REDIRECT_URI`  
- Session: `SESSION_SECRET` (any long random string)  
- Firebase Admin: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL`

**Strongly recommended (not in the fatal list, but needed for real use):**

- `FRONTEND_URL` — exact SPA origin, no trailing slash (`http://localhost:3000` or your Vercel URL)
- `DISCORD_GUILD_ID` — local JSON import CLI only, not a runtime fallback

**Optional:** `ATTENDANCE_POST_HOUR` (default `10`), `PROXY_URL` (if Discord blocks Render IPs), `PORT` (Render sets this).

Ignore Google Sheets variables if present — sync is not mounted.

### Frontend (`frontend/.env`)

See `frontend/.env.example`:

- All `VITE_FIREBASE_*` from the Web app config
- `VITE_BACKEND_API_URL` — backend origin **without** `/auth/callback`  
  - Local: `http://localhost:5001`  
  - Prod: `https://YOUR-RENDER-SERVICE.onrender.com`

---

## 4. Local development

1. Install Node.js LTS
2. Clone this repo and open a terminal in the repo root
3. Install dependencies:

```bash
npm install
```

4. Fill `backend/.env` and `frontend/.env` (local Discord redirect + `FRONTEND_URL=http://localhost:3000`)
5. Start both apps:

```bash
npm run dev
```

| App | URL |
| :--- | :--- |
| Frontend (Vite) | [http://localhost:3000](http://localhost:3000) |
| Backend | [http://localhost:5001](http://localhost:5001) — open `/` and expect `GuildName backend is online.` |

Vite proxies `/api` and `/auth` to port 5001.

**Cookies note:** Sessions use `secure: true` and `sameSite: 'none'`. On plain `http://localhost`, cookies can be flaky; the app also keeps a signed profile in `localStorage` / `x-user-profile` as a fallback. Prefer testing OAuth against a deployed HTTPS backend when possible.

The Discord bot clears leftover slash-command menus on startup. Job and role changes are on the attendance card.

---

## 5. Deploy backend on Render

1. Sign up at [https://render.com](https://render.com) and connect GitHub
2. **New** → **Web Service** → select this repository
3. Settings:

| Field | Value |
| :--- | :--- |
| **Root Directory** | `backend` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |

If `@guildname/shared` fails to resolve from `backend` alone, set Root Directory to the **repo root**, Build Command to `npm install`, and Start Command to `npm --prefix backend start`.

4. **Environment** → add every backend variable from section 3  
   - `OAUTH_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/auth/callback`  
   - `FRONTEND_URL` can be temporary until Vercel exists; update it after step 6  
5. Deploy. Open `https://YOUR-SERVICE.onrender.com/` and confirm the online message
6. In Discord Developer Portal, ensure the production redirect URL is listed (section 1.3)

**Free tier note:** Render may sleep inactive services; the first request after sleep can be slow. The Discord bot runs inside this same process — if the service sleeps, the bot is offline too.

If Discord API calls fail from Render with network/block errors, set optional `PROXY_URL` to a working HTTP(S) proxy.

---

## 6. Deploy frontend on Vercel

1. Sign up at [https://vercel.com](https://vercel.com) and import this GitHub repo
2. Configure:

| Field | Value |
| :--- | :--- |
| **Root Directory** | `frontend` |
| **Framework Preset** | Vite |
| **Build Command** | `npm run build` (default) |
| **Output Directory** | `dist` |

`frontend/vercel.json` already rewrites SPA routes to `index.html`.

3. **Environment Variables** — add all `VITE_*` from section 3  
   - `VITE_BACKEND_API_URL=https://YOUR-SERVICE.onrender.com`
4. Deploy. Copy the site URL (e.g. `https://your-app.vercel.app`)

5. **Deployment hygiene** (recommended so GitHub / Vercel stay tidy):

   | Setting | Where | Recommended |
   | :--- | :--- | :--- |
   | `deployment_status` Events | Vercel → Project → **Settings → Git** | **Off** (unless a GitHub Action depends on them) |
   | Production retention | Vercel → Project → **Settings → Security → Deployment Retention** | **7 days (`1w`)** — not 1 day |
   | Preview / Canceled / Errored retention | Same | **1 day (`1d`)** |

   Every git push creates a Vercel deployment and a matching **GitHub Deployments** record. Retention only deletes Vercel artifacts; it does **not** clear GitHub’s list. One current production alias is enough — you do not need hundreds of old records.

   Apply retention via API (optional) and print the Git toggle reminder:

   ```bash
   export VERCEL_TOKEN=...          # https://vercel.com/account/tokens
   export VERCEL_PROJECT_ID=...     # Project Settings → General
   # export VERCEL_TEAM_ID=...      # if the project is under a team
   ./scripts/configure-vercel-deploy-hygiene.sh
   ```

   Clear accumulated GitHub deployment metadata (safe for the live site):

   ```bash
   gh auth login
   ./scripts/cleanup-github-deployments.sh --keep 1
   ```

---

## 7. Wire production URLs together

After both deploys exist:

1. **Render** → set `FRONTEND_URL=https://your-app.vercel.app` (no trailing slash) → redeploy if needed  
2. **Discord OAuth2 Redirects** → production `https://YOUR-SERVICE.onrender.com/auth/callback`  
3. **Vercel** → `VITE_BACKEND_API_URL` points at Render (redeploy so Vite rebuilds with the env)  
4. From a machine with prod Discord credentials in `backend/.env`, the bot clears old slash menus on ready (or run `npm --prefix backend run clear-commands`)

5. Open the Vercel site → **Login with Discord**  
6. Open **Settings** as the guild onboarder (or an officer Discord role) and save channels / events  
7. Optional: use **Send** in Settings to post the auction / attendance / party cards into that guild’s mapped channels  
8. Confirm cards work in the mapped Discord channels

---

## 8. Post-setup checklist

- [ ] Render `/` returns online text  
- [ ] Discord bot appears online in the server  
- [ ] Vercel site loads and Discord login returns you to the app  
- [ ] Settings unlock works for the onboarder / officer Discord roles  
- [ ] Discord role names in Settings match live server roles for officer tools  
- [ ] Auction / attendance / party cards post into mapped channels  
- [ ] War room voice IDs match real voice channels  

---

## 9. Project scripts (quick reference)

| Location | Command | Purpose |
| :--- | :--- | :--- |
| Repo root | `npm install` | Install workspaces |
| Repo root | `npm run dev` | Frontend + backend together |
| `frontend` | `npm run build` | Production build |
| `backend` | `npm start` | Production API + bot |
| `backend` | `npm run clear-commands` | Clear leftover Discord slash-command menus |
| `scripts/` | `./scripts/configure-vercel-deploy-hygiene.sh` | Set Vercel retention (needs `VERCEL_TOKEN`) |
| `scripts/` | `./scripts/cleanup-github-deployments.sh --keep 1` | Delete old GitHub deployment records |

---

## 10. Troubleshooting

| Problem | What to check |
| :--- | :--- |
| Backend crashes on boot | Missing env from the required list in section 3 |
| OAuth “redirect_uri mismatch” | Discord Redirects must **exactly** equal `OAUTH_REDIRECT_URI` |
| Login works but API CORS errors | `FRONTEND_URL` must match the browser origin (scheme + host, no trailing slash) |
| Settings unlock fails | You must be the Discord user who set up the guild, or hold a Discord role listed in that guild’s Settings |
| Firebase permission errors in browser console | Expected with `auth != null` rules; use API-backed UI paths |
| Bot offline on Render | Service sleeping / crashed; check Render logs; optional `PROXY_URL` |

---

## License / requirements

Functional requirements live in [Requirements/Requirements.md](Requirements/Requirements.md). This README intentionally covers setup only.
