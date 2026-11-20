# 🎄 Bauble Shake

A party game for phones. Everyone joins a room and gets the same decorated glass Christmas tree. When the countdown ends, everyone shakes their phone to knock the decorations off. The star falls last. The fastest to clear their tree wins.

- **Join by room code, invite link or QR code**
- **Own tree only**: no peeking at anyone else's progress until the podium
- **Synced countdown and timing** based on the server clock, so results are fair
- **Full podium**: the round runs until everyone finishes or 90 seconds pass, then 🥇🥈🥉 with times
- **Host handover**: if the host drops out, the next player takes over
- **No build step**: plain HTML, CSS and JavaScript modules, hosted free on GitHub Pages with Firebase for live sync

![Design reference](docs/design-reference.png)

## Try it right now (no setup)

Until you add a Firebase config, the game runs in **local demo mode**. It syncs between tabs on one device and uses tap/space bar instead of shaking.

```bash
cd bauble-shake
python3 -m http.server 8000
# open http://localhost:8000 in two or more tabs
```

## Set up Firebase (about 5 minutes, free)

1. Go to <https://console.firebase.google.com> → **Add project**. Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Realtime Database → Create database**. Pick a region, then start in **locked mode**.
4. Open the database's **Rules** tab, paste in the contents of [`database.rules.json`](database.rules.json), and click **Publish**.
5. **Project settings (⚙) → Your apps → Web (`</>`)**. Register an app (Firebase Hosting isn't needed), then copy the `firebaseConfig` values into [`js/firebase-config.js`](js/firebase-config.js). Make sure `databaseURL` is included. If it's missing, copy it from the Realtime Database page.
6. **Authentication → Settings → Authorized domains**: add `YOUR-USERNAME.github.io`.

The web config is meant to be public, so committing it is fine. Access is controlled by the database rules.

## Deploy to GitHub Pages

```bash
cd bauble-shake
git remote add origin https://github.com/YOUR-USERNAME/bauble-shake.git
git push -u origin main
```

Then on GitHub, go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The game will be live at `https://YOUR-USERNAME.github.io/bauble-shake/`.

> Phones only allow motion sensors on **https** pages. GitHub Pages is https, so this works out of the box. On iPhone, each player taps **Enable shaking** and then **Allow**.

## How to play

1. The host taps **Create a room** and shares the code, link or QR code.
2. Everyone chooses **📱 Shake** (phones) or **🖱️ Tap** (computers). Shakers give a test shake, and the 🔔 rings when one is detected.
3. The host taps **Start game**. After 3‑2‑1, shake!
4. Each sharp shake (or tap/click) knocks off one decoration, and a really hard shake knocks off two. Clear all 40 to finish.
5. The podium appears when everyone is done or time runs out. The host can start another round with **Play again**.

## Tuning

| What | Where |
|---|---|
| Decorations per tree, time limit, countdown | top of `js/main.js` (`ORNAMENTS`, `TIME_LIMIT_MS`, `COUNTDOWN_MS`) |
| Shake sensitivity | `SHAKE` in `js/shake.js` (`threshold`, `strong`, `cooldownMs`) |
| 3D scene: tree shape, colours, gifts, swirls, glow | `js/tree3d.js` (add `?flat` to the URL to force the flat tree) |
| Colours and scenery | `css/style.css` |

In the lobby, each player chooses **📱 Shake** (phones, using the motion sensor) or **🖱️ Tap** (click or tap the tree, or press space; recommended on computers). Tapping is capped at about 6–7 decorations a second (`TAP_COOLDOWN_MS` in `js/main.js`) so it's no faster than good shaking. The lobby and podium show which way each player played.

## Project layout

```
index.html               screens (home, lobby, game, waiting, results)
css/style.css            glass/neon styling and scenery
js/main.js               game flow, rooms, rendering
js/tree3d.js             3D glass tree scene (WebGL2, no libraries): glass, glow, swirls, reflections
js/tree.js               flat SVG tree, used automatically if a phone can't do 3D
js/shake.js              accelerometer shake detection (incl. iOS permission)
js/backend-firebase.js   Firebase Realtime Database adapter
js/backend-local.js      same API over localStorage for local demo mode
js/firebase-config.js    your Firebase web config
database.rules.json      security rules to paste into Firebase
```

## Known limitations

- Timing is measured on each phone and checked against the server clock. A determined cheater could edit their own result, so it's built for friendly games, not tournaments.
- Old rooms are never deleted. Each room is tiny, so the free tier covers years of play, but you can clear `rooms` in the Firebase console whenever you like.
