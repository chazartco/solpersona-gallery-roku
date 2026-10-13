# Questions, platform limits and proposals

Where Roku cannot do what SPEC.md asks, or where the spec leaves a choice, this
file says what the channel does instead and what would make it better. Nothing
here invents a server endpoint; the last section proposes two small additions.

Status: written from Roku's documentation and from runs in the BrightScript
Simulation Engine. Items marked **verify on hardware** need checking on a real
Roku TV and stick (see CONFORMANCE-RESULTS.md).

---

## Decisions needed

### 1. The screensaver vs certification rule 4.5

A SceneGraph app with no playing video lets the Roku screensaver start after the
idle time the person set (default 10 minutes). A gallery wall must not be
interrupted (SPEC §11 "Never sleeps").

**What the channel does:** a 2-second silent black clip
(`media/keepawake.mp4`, 3 KB) loops in a hidden, 2×2-pixel Video node under
everything, with `disableScreenSaver=true` — the only documented control
(Video node fields `disableScreenSaver`, `enableScreenSaverWhilePlaying`). It
stops while a film plays (Roku decodes one video at a time; the film keeps the
screen awake itself).

**The conflict:** Roku certification criterion 4.5 says apps "are prohibited
from overriding or interfering with Roku's system screensaver". A reviewer may
read the keep-awake clip as exactly that.

**Options for the owner:**
- Keep it on and explain in the submission notes that the channel is a
  digital-signage / ambient-art display whose purpose is continuous display
  (the setting is visible in the developer menu as "Keep the screen awake").
- Ship store builds with it off and document that the Roku's own setting
  (**Settings → Theme → Screensavers → Change wait time → Disabled**) must be
  used on gallery walls. Change the default in `loadConfig()`
  (`components/MainScene.bs`).

### 2. Linking from a phone and certification rule 2.2

Roku's criteria (2.2, 4.2, 4.3) push account sign-up and sign-in to happen on
the device, and require Roku Pay / Automatic Account Link for some
subscription apps. SolPersona Gallery sells nothing on the device, has no
sign-in form and links by code, as many Roku channels do. The **Try a sample
gallery** button gives reviewers a working channel without an account
(SPEC §11b). The wording follows SPEC §11c exactly.

**Ask:** is the SolPersona team comfortable submitting with code linking as the
only way to show one's own gallery? If Roku asks for it, an on-device sign-in
would need a new endpoint (not proposed here).

### 3. Auto-launch at power-on

Roku has no API for an app to start itself, and no consumer setting that
launches a channel at power-on. The closest:

- **Roku TV:** Settings → System → Power → **Power on** → *Last used input*
  returns to the last HDMI/tuner input, not to a channel. Leaving the TV on
  (with **Auto power savings** turned off: Settings → System → Power) and
  never pressing Home is what keeps the gallery up.
- **Roku players (sticks/boxes):** they stay on when the TV is switched off;
  the channel keeps running unless Home is pressed or the power is cut.
- **Signage:** Roku has no enterprise/kiosk auto-launch mode for third-party
  channels that we could find; venues needing auto-start after power cuts
  should use a signage player (BrightSign) or a Raspberry Pi.

**Verify on hardware:** whether the channel survives a TV's own standby on the
models you test, and whether Roku's "Fast TV start" brings it back.

### 4. Turning the panel off outside opening hours

`schedule` asks for standby where possible. Roku gives channels no way to turn
the panel off (ECP `PowerOff` exists only for external controllers; a channel
sending ECP to itself is not allowed in store builds). Outside opening hours
the channel shows black, keeps the keep-awake clip running (so the screensaver
does not light the wall at night), reports `state.visible: false`, and records
no `plays`. On OLED, black is effectively off.

---

## Platform limits (what the channel does instead)

| SPEC asks | Roku | What the channel does |
|---|---|---|
| 4K-sharp stills (§11 Performance, CONFORMANCE §D "ORIGINAL on a 4K panel") | The SceneGraph graphics plane is at most 1920×1080, even on 4K TVs; only video is 4K. | Stills are decoded at 1920×1080 at most. `ORIGINAL` is still visibly sharper than the ~1000 px `DISPLAY` copy at 1080p. `capabilities.screenWidth/Height` report the panel (from `GetVideoMode`, e.g. 3840×2160), as the spec asks. |
| BLUR: CSS blur ~18 px (§8) | No blur filter. | The piece is decoded twice, tiny (24×14 and 56×32, "scaleToZoom"), and stretched to 115 % of the screen; bilinear upscaling reads as a soft blur, the two sizes hide each other's sampling grid. `washOpacity` sets the group's opacity over black. Constants at the top of `components/views/ArtLayer.bs`. **Verify on hardware** side by side with the simulator. Proposal B below would remove the approximation. |
| Shadow, rounded panels | No box-shadow, no corner radius. | Pre-rendered 9-patch images (`images/ui/*.9.png`, generated by `tools/make-art.mjs`), tinted with `blendColor`. |
| FRAME mouldings with wood grain | No gradients/patterns. | Four pre-rendered strips per moulding (`images/frames/`), each carrying its share of the 145° gradient, grain running along the moulding; butt joints rather than mitres (at 16 px the difference is invisible from the room). The mat is `#fbfaf7` as SPEC §8 says (the simulator uses `#f5f3ee`). |
| Video fades with the transition | The video plane is under the graphics plane; layer opacity does not fade it (undocumented; assumed). | A film's still is drawn in its layer and fades; the film starts once the fade has finished and stops before the next fade begins. |
| FILL for a video (cover, crops) | The Video node letterboxes; it cannot crop. | Films under FILL are fitted to the whole screen (letterboxed). |
| WebM/VP9 films | Not in Roku's media spec for progressive files. | Unless `roDeviceInfo.CanDecodeVideo({Codec:"vp9"})` says yes, a `.webm` film shows its `display ?? poster` still for the slot; a film that errors at play time falls back the same way. |
| Animated GIF/WebP | A Poster shows the first frame (animation needs an AnimatedImage node, unsupported on older models). | First frame. |
| AVIF, SVG, HEIC, TIFF originals | Not decodable. | Skipped without downloading; the next candidate (display copy) is used. |
| WebP display/poster copies | Supported since Roku OS 9.4. | Used. A file that downloads but will not decode is marked bad for the session and the next candidate is tried. **Verify on hardware** per model (CONFORMANCE-RESULTS.md). |
| Persistent storage for "Keep this gallery on the screen" (§11a) | Roku documents USB as **read-only** for apps; many models have no USB/SD. | The channel probes `ext1:` (create, write, read back, delete). If writable it reports `persistentStorage: true` and keeps the whole show there; otherwise it reports `false` and streams, and the OK overlay says "This Roku cannot write to its USB stick or SD card" (or "Insert a USB stick or SD card…"). **Verify on hardware**: we expect most retail Rokus to stream. |
| Reboot with no network still plays (§4.3, §11) | `cachefs:` (the only large writable store on most Rokus) is RAM and is emptied at reboot. The registry holds 16 KB for the whole app. | The playlist and clock are saved to the registry (trimmed to ~9 KB: descriptions shortened, links dropped) and, when keeping, in full on the stick. After a reboot without network, a streaming Roku knows what to play but has no media until the network returns; it shows the idle/connecting screen, not a broken one. A Roku keeping its gallery on a writable stick plays it. |
| Watchdog restart after a crash (§11) | A crashed channel returns to the Roku home screen; nothing can restart it. | Defence instead: every render-thread entry point (`tick`, task answers) is wrapped in `try/catch`; an unexpected answer is reported in `state.error` ("internal (…)") and playback continues. |
| Monotonic clock (§5.1) | `roTimeSpan` is monotonic but its millisecond counter is 32-bit (wraps after 24.8 days). | Monotonic time = wall clock at start-up + `roTimeSpan`, folded into the anchor every 3 days. Request timestamps from the task thread are wall-clock and mapped onto this scale on arrival. |
| `qrDataUri` "or draw your own from pairUrl" (§3.2) | No QR encoder in BrightScript. | Uses `qrDataUri` (decoded to `tmp:/`). If it is ever missing, the screen shows the code and address without a QR. |
| Typography "read from three metres" | — | Labels are 10 % larger than the simulator's proportions (`TYPE_SCALE` in ArtLayer.bs); otherwise the simulator's layout, in `u` units. |

---

## Choices the spec leaves open

* **Takeover during closed hours** — shown, as the simulator does (a person asked for it).
* **Burn-in guard** moves the label, the QR and the idle block by up to ±0.6u (±6 px) every 2 minutes, over 4 s.
* **Pairing code persistence** — an unexpired registration is kept in the registry so a restart keeps showing the same code (as the simulator does).
* **Film drift correction** — Roku seeks rebuffer, so a playing film is re-seeked only when more than 1.5 s out of step, at most every 10 s (the simulator: 1 s / 8 s).
* **Sample gallery Back** — returns to pairing; OK during the sample opens a small overlay with "Back to the pairing screen".

---

## Proposals (optional, small, additive)

### A. A JPEG `display` copy — *not needed now*

WebP has decoded in Poster nodes since Roku OS 9.4 (2020); every Roku still
receiving updates supports it, and the channel falls back to `original` where
it does not. Revisit only if CONFORMANCE-RESULTS.md shows a supported model
failing.

### B. A pre-blurred wash: `media.wash`

An optional field on `ScreenItem.media`: a small (e.g. 64×36), heavily blurred
JPEG of the piece (of a video's poster), made once on upload.

```ts
media: { original, display, poster, fallbacks, wash?: string | null }
```

Players without a blur filter (Roku, older smart TVs) would show it stretched
under the piece instead of approximating a blur, and every platform's wash
would match the simulator exactly. Unknown fields are ignored (SPEC §2), so it
is backward-compatible. The channel would use `wash` when present and keep the
current approximation otherwise.
