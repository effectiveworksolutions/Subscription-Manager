# SubTracker

Track every subscription in one place. Works as a website, an installable web app, and (after wrapping) a native Android / iOS app.

```
subtracker/
├── docs/                    ← the web app (this is what gets deployed)
│   ├── index.html
│   ├── app.css
│   ├── app.js               main logic
│   ├── brands.js            logos + quick-pick list
│   ├── sync.js              Supabase auth + cloud sync
│   ├── config.js            ← YOU EDIT THIS (Supabase keys)
│   ├── sw.js                offline support
│   ├── manifest.json
│   ├── privacy.html         ← required by both app stores
│   └── icon-*.png
├── store-assets/            1024px icon for store listings
├── supabase-schema.sql      run once in Supabase
├── capacitor.config.json    native app config
├── package.json
└── README.md                you are here
```

---

## Phase 1 — Deploy the web app (10 minutes, any device)

The folder is called `docs/` because GitHub Pages can serve directly from it **and** Capacitor can use it as the app source. One folder, both jobs.

1. Go to your GitHub repo (or create a new one called `subtracker` — Public, with a README).
2. **Add file → Upload files** — drag the **entire unzipped `subtracker` folder contents** in (all files and the `docs/` and `store-assets/` folders). Commit.
3. **Settings → Pages**. Under *Branch*, change the folder dropdown from `/ (root)` to **`/docs`**. Click **Save**.
4. Wait ~60 seconds, refresh. Your URL appears in the green box.

Your data from the old version carries over automatically — it lives in your browser under the same `effectiveworksolutions.github.io` origin, and the app migrates it on first open.

> **Updating later:** edit a file on GitHub (pencil icon) or re-upload it. Then open `docs/sw.js` and bump `CACHE_VERSION` (e.g. `v1` → `v2`) so phones pick up the change on next open.

---

## Phase 2 — Turn on cloud sync (5 minutes, any device)

This lets your phone and PC share one list and gives users accounts.

1. Go to **[supabase.com](https://supabase.com)** → Start your project → sign in with GitHub.
2. **New project**. Name: `subtracker`. Region: **Sydney**. Set a database password (save it somewhere — you won't need it day-to-day). Free plan.
3. Wait ~2 min for it to provision.
4. Left sidebar → **SQL Editor → New query**. Paste the entire contents of `supabase-schema.sql`. Click **Run**. You should see "Success".
5. Left sidebar → **Project Settings → API**. Copy two things:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (long string starting with `eyJ…`)
6. Open `docs/config.js` on GitHub, click the pencil, paste them in:
   ```js
   SUPABASE_URL:      'https://abcdefgh.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…',
   ```
   Commit.
7. **Authentication → Providers → Email**: leave *Confirm email* ON (recommended) or turn it OFF for instant sign-ups while testing.
8. **Authentication → URL Configuration**: set *Site URL* to your GitHub Pages URL.

Open the app → **Settings → Sign in or create account**. Your existing subscriptions upload automatically. Sign in on another device → they appear.

> **Is the anon key safe to publish?** Yes. It's designed to be public. The Row Level Security policies in the SQL file mean the database itself refuses to show anyone data that isn't theirs.

---

## Phase 3 — Android app for Google Play (at your Windows PC)

### One-time setup
1. Install **[Node.js LTS](https://nodejs.org)** (click through the installer).
2. Install **[Android Studio](https://developer.android.com/studio)**. On first launch accept the SDK install (takes a while).
3. Download this project to your PC (GitHub → green **Code** button → Download ZIP → unzip).

### Build
Open a terminal in the project folder (in File Explorer: right-click → *Open in Terminal*), then:

```bash
npm run setup          # installs Capacitor + plugins (~2 min)
npm run android:add    # creates the android/ folder (once)
npm run android        # syncs your web files in and opens Android Studio
```

In Android Studio: wait for *Gradle sync* to finish (bottom bar), then **Run ▶** with your phone plugged in (enable *USB debugging* in Developer Options) or use the emulator. The app will launch with real background notifications.

### Notification icon (one small manual step)
Android needs a white-on-transparent icon for the status bar. In Android Studio: right-click `app/res` → **New → Image Asset** → Icon type: *Notification Icons* → Name: `ic_stat_icon` → pick `store-assets/icon-1024.png` → Finish.

### Release to Google Play
1. **[play.google.com/console](https://play.google.com/console)** → create developer account (**$25 USD, once**).
2. In Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**. Create a new keystore — **save the file and passwords somewhere safe, you need the same one for every future update**.
3. Play Console → **Create app** → fill in the listing (see checklist below) → **Production → Create new release** → upload the `.aab` file.
4. Review usually takes 1–7 days for a first app.

---

## Phase 4 — iOS app for the App Store (needs a Mac)

1. On the Mac: install **Xcode** from the Mac App Store (large download). Install Node.js. Clone/download the project.
2. In Terminal in the project folder:
   ```bash
   npm run setup
   npm run ios:add
   npm run ios        # opens Xcode
   ```
3. In Xcode: select the `App` target → **Signing & Capabilities** → tick *Automatically manage signing* → choose your team (needs an **Apple Developer account, $99 USD/year** from [developer.apple.com](https://developer.apple.com)).
4. Plug in an iPhone, select it as the run target, press **▶**. First run prompts you to trust the developer cert on the phone (Settings → General → VPN & Device Management).
5. To submit: **Product → Archive** → **Distribute App** → App Store Connect → Upload. Then finish the listing at [appstoreconnect.apple.com](https://appstoreconnect.apple.com).

**Passing Apple review.** Apple rejects apps that are "just a website". SubTracker clears that bar because it has native local notifications, offline mode, file export via the share sheet, and no required login. In the *App Review notes* field, say: *"Personal finance tracker with local notifications, offline storage and native share/export. No account required; optional sync."*

---

## Store listing checklist (both stores)

| Item | Where it is / what to write |
|---|---|
| App icon 512×512 (Play) / 1024×1024 (Apple) | `store-assets/icon-1024.png` — resize for Play |
| Feature graphic 1024×500 (Play only) | Make one in Canva: dark bg, app name, a phone screenshot |
| Screenshots | Take 4–6 on your phone: home, detail, insights, settings, add form. Apple needs 6.7" and 6.5" sizes — just use your phone's native screenshots |
| Short description (80 chars) | *Track every subscription in one place. Know what you pay and when it renews.* |
| Full description | See `STORE_DESCRIPTION.md` |
| Category | Finance |
| Privacy policy URL | `https://YOUR-USERNAME.github.io/subtracker/privacy.html` — already included, edit the contact email |
| Data safety / privacy nutrition label | Collects: email (if user signs in), app data (subscriptions). Not shared with third parties. Encrypted in transit. User can request deletion (Settings → Delete all data). |
| Content rating | Everyone / 4+ |
| Contact email | Your support email |

---

## Testing locally without deploying

```bash
npm run serve
```
Open **http://localhost:8080**. Resize the browser below 700px wide to see the mobile layout.

---

## Troubleshooting

- **"Sign in" is missing from Settings** → `config.js` still has the placeholder values, or the Supabase script didn't load (check internet).
- **Changes don't show on my phone** → bump `CACHE_VERSION` in `sw.js`, or in Chrome: ⋮ → Settings → Site settings → Storage → clear for your site.
- **Notifications don't fire when the app is closed (web version)** → expected. Only the Capacitor-wrapped app can do background notifications. The web version checks on open.
- **`npx cap` says "command not found"** → run `npm run setup` first.
- **Android Studio Gradle errors** → File → Invalidate Caches → Restart. Nine times out of ten that fixes it.
