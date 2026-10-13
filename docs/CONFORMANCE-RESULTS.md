# Conformance results

The checklist is `docs/solpersona/CONFORMANCE.md`. This file records what has
been verified, where, and how.

> **Hardware runs are still to be done.** Everything below the "Simulation
> engine" heading was run in the BrightScript Simulation Engine (brs-node 2.6.1,
> SceneGraph extension) against `tools/mock-server.mjs`, not on a Roku. The
> engine is faithful for BrightScript, the registry, files, HTTP and most of
> SceneGraph, but it does **not** decode H.264 video, and it is not a judge of
> image quality, frame rate or texture memory. The hardware tables are the
> owner's to fill in: one **Roku TV** and one **Roku stick** at minimum —
> [TESTING-ON-ROKU.md](TESTING-ON-ROKU.md) walks through every check.

## Devices

| Device | Model | Roku OS | Panel / output | USB/SD | Tested by, date |
|---|---|---|---|---|---|
| Roku TV | _e.g. TCL 55S455 (C-series)_ | | | | |
| Roku stick | _e.g. Streaming Stick 4K 3820_ | | | | |
| (optional) Roku Ultra | | | | | |

Model and OS: **Settings → System → About**. Video output: **Settings → Display type**.

## Image formats (per device)

Pair the device to `make mock` (or a staging SolPersona), turn on the debug
overlay (OK → Debug overlay), and watch the CACHE section: a ready entry shows
`ready <via> <w>x<h> <ext>`; a file that downloaded but would not decode shows
`decode <ext>` and the next candidate is used.

| Format | Expected | Roku TV | Stick |
|---|---|---|---|
| WebP display/poster copy | decodes (OS ≥ 9.4) | | |
| JPEG original, 6000×4000 | decodes at ≤1920×1080 | | |
| PNG original, 4000×4000 | decodes (watch for memory warnings on old models) | | |
| GIF (animated) | first frame | | |
| AVIF / SVG original | skipped → display copy | | |

## Video (per device)

| Case | Expected | Roku TV | Stick |
|---|---|---|---|
| MP4 H.264/AAC, muted | plays from `offsetMs mod duration`; `durations` reported once (mock log: `duration v:5 … ms`) | | |
| `videoSound: true` | audible | | |
| Short film, `loopShortVideos` | whole plays loop until the slot ends | | |
| Estimated slot | the play finishes before the next piece (≤ length + 5 s) | | |
| WebM film | still shown for the slot | | |
| Film from the stick (`ext1:`) | plays; if not, streams (overlay shows no error) | | |
| Fade into / out of a film | still fades, film starts after / stops before | | |

## Screensaver and power (per device)

| Case | Expected | Roku TV | Stick |
|---|---|---|---|
| 30 min with stills only, screensaver wait 5 min | no screensaver (keep-awake clip) | | |
| Same, keep-awake off (developer menu) | screensaver appears | | |
| TV "Auto power savings" on, 4 h | _record what happens_ | | |
| Power-cycle the Roku | returns to the Roku home screen (no auto-launch — see QUESTIONS §3) | | |

## Checklist status

Legend: ✅ verified in the simulation engine · 🧪 covered by unit tests in CI ·
⬜ to verify on hardware · ⚠️ platform limit (QUESTIONS.md)

### A. Automated
| Item | Status |
|---|---|
| Clock passes every `test-vectors.json` case (`positionAt`, `clockOffset`, `imageChoice`, `schedule`), in CI | 🧪 `tests/specs/Vectors.spec.bs` reads the file itself |
| Sync handling: new vs same version, command de-dup by `seq`, `401` → pairing, `429` → `Retry-After` | 🧪 `tests/specs/SyncLogic.spec.bs` (+ pairing in `PairLogic.spec.bs`) |

67 tests, all passing headless (`make test`).

### B. Pairing
| Item | Status |
|---|---|
| First boot straight to pairing: QR, code, countdown | ✅ (screenshot `docs/screenshots/pairing.jpg`) · ⬜ legibility at 3 m |
| Linking moves to playing within ~3 s | ✅ (token poll every `intervalMs`) |
| Unlinked 15+ min → fresh code | 🧪 expiry logic · ⬜ wall-clock run |
| Power-cycle after linking → back linked and playing | ✅ comes back linked (registry, `brs-cli -y`); offline it shows "Connecting" until media is reachable · ⬜ |
| Removed from dashboard → pairing within one poll | ✅ (`/mock/unlink`) |
| Forget this account | ✅ menu flow · ⬜ against SolPersona |
| Try a sample gallery, code visible, linking switches, Back returns | ✅ |
| Wording per §11c | ✅ |

### C2. Storage modes
| Item | Status |
|---|---|
| Streaming never changes to an unloaded piece; rejoins the clock | ✅ hold logic · ⬜ throttled network |
| Persistent storage: `persistentStorage: true`, stores every piece in order, counts | ✅ with a simulated stick (`keepVolume=cachefs:`): overlay "5 of 6 pieces kept" · ⚠️ real USB is read-only on most models |
| Offline + power-cycle plays from the stick; prune on change; off clears | ⬜ needs a writable stick |

### C. Playback
| Item | Status |
|---|---|
| Changes every `slideSeconds` with the chosen transition | ✅ · ⬜ smoothness at full frame rate |
| Pause / resume / next / previous / jump / restart within a poll | ✅ next, restart (`/mock/next`, `/mock/restart`) · 🧪 pause via the clock vectors · ⬜ |
| Two devices in step within ~150 ms | ⬜ (next piece is pre-built and the change fires on a boundary timer) |
| Video never cut, loops, duration reported | 🧪 hold logic · ⬜ playback (engine has no H.264) |
| Takeover, then the show resumes in step | ✅ |
| identify / reload / clear-cache once | ✅ identify on screen; 🧪 de-dup |
| Idle screen | ✅ |
| Unlicensed notice, comes back by itself | ✅ |

### D. Presentation
| Item | Status |
|---|---|
| BLUR (0/60/100, shadow on/off), FRAME (5 styles), BLACK, FILL | ✅ rendered · ⬜ side by side with the simulator on a TV |
| `marginPercent` 0 and 20 | ✅ (4, 12 shown) |
| Label styles, timing, corners, toggles; legible over white and black | ✅ |
| QR targets, corners, none; scanning opens the right page | ✅ placement · ⬜ scan with a phone |
| ORIGINAL sharper than DISPLAY on 4K | ⚠️ 1080p graphics plane; ⬜ |
| Opening hours black; takeover still shows | ✅ logic · ⬜ |
| Burn-in shift every ~2 min | ✅ |

### E. Resilience
| Item | Status |
|---|---|
| Network pulled 5 min: keeps playing; re-syncs without a jump | ✅ (`/mock/offline`): offline dot, playing on |
| Reboot with no network plays from cache | ⚠️ `cachefs` is RAM; plays only from a writable stick |
| A 404 piece is skipped for the lap; error in state | ✅ logic (`could not load …`) |
| 8 hours unattended, no memory growth | ⬜ (`make debug` + Roku's Memory Monitor) |
| Token in no log or screenshot | ✅ no `print` anywhere (lint error); overlay/debug never show it |
| Commercial: `plays` sent after an outage | ✅ mock received `plays [{"itemId":"v:5","startedAt":1791882604471,"ms":20018}]` |
| `state.visible` false when closed | ✅ logic |

### F. Store / platform
| Item | Status |
|---|---|
| Starts on power-on | ⚠️ not possible on Roku (QUESTIONS §3) |
| Screensaver never appears while playing | ⬜ (QUESTIONS §1 about certification) |
| Certification rules | ⬜ run Roku's Static Analysis and Test Automation before submitting |
| README: build, install, base URL, tests | ✅ |
