ProxySniff v1.5

Run locally:
1. Unzip the folder.
2. Open Command Prompt or Terminal inside the ProxySniff_v1_5 folder.
3. Run:
   python -m http.server 8000
4. Open:
   http://localhost:8000

Do not double-click index.html. The browser can block cameras.json when opened as a file.

Default dataset:
- cameras.json = Bay / SF / Tracy / Los Banos route pack.
- packs/cameras-california.json = larger California pack.

v1.5 update:
- Fixed the map HUD location chip logic.
- The location chip no longer shows dataset/camera count messages.
- When Follow Me is ON, the HUD shows the user's live GPS/reverse-geocoded location.
- When searching an address, the HUD shows the searched/viewed place.
- When Follow Me is OFF and no place has been searched, the HUD says: Search a place or tap Follow Me.
- Service worker cache bumped to v1.5.0.

Prior fixes included:
- Fullscreen map mode.
- Map layout hardening.
- Zoom controls moved above the recenter button.
- Follow Me toggle with red Following state.
- Address search pauses follow mode so browsing the map does not snap back.

Important:
If an older version is still cached, open Settings > Clear App Cache once, then reopen the app.


ProxySniff v1.6 changes:
- SAFE:on keeps the app looking/working like v1.5.
- SAFE:off unlocks a visual-only Handshakes / MITM-style ops panel under Scanner.
- Added simulated target chips, op buttons, and fake ops terminal/progress meter.
