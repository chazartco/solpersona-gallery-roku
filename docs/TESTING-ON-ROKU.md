# Testing on a Roku

How to install the channel on a Roku on your own network, point it at a test
SolPersona, and work through the hardware checks. Write what you find in
[`CONFORMANCE-RESULTS.md`](CONFORMANCE-RESULTS.md); that file's device tables
are still empty until someone does this.

Allow about two hours for a first full pass on one device.

## What you need

- A **Roku TV** and a **Roku streaming stick or box** on the same network as
  your computer. Wired or 5 GHz Wi-Fi is better for the video checks.
- A computer with **Node 24** or newer, **make** and this repository (`npm ci` done).
- A phone, to scan QR codes.
- Something to link the Roku to. Either:
  - the **mock server** in this repo (`make mock`), which needs nothing else; or
  - a SolPersona **development stack** or **staging account**, for the checks
    that need the real dashboard (two screens in step, Forget this account,
    the venue `plays` report).
- Optional: a **USB stick** (FAT32 or exFAT) for the keep-on-the-screen checks.

## 1. Put the Roku in developer mode

1. With the Roku remote press **Home ×3, Up ×2, Right, Left, Right, Left, Right**.
2. Note the address on screen, e.g. `http://192.168.1.40`.
3. Choose **Enable installer and restart**, accept the agreement, and choose a
   password. The user name is always `rokudev`.

On the Roku, also note **Settings → System → About** (model and software
version) for the results file.

## 2. Tell the tools where the Roku is

In the repository root create `.env`. Git ignores it.

```sh
ROKU_IP=192.168.1.40
ROKU_PASSWORD=the-password-you-chose
```

Check that the computer can reach it: open `http://192.168.1.40` in a browser
and sign in as `rokudev`.

## 3. Build and install

```sh
make dev
```

This builds `build/solpersona-gallery-roku.zip` and installs it as the
developer channel. After a few seconds the pairing screen appears on the TV.
Run `make dev` again after every change; it replaces the installed copy.

If `make dev` fails, open `http://<ROKU_IP>`, sign in as `rokudev`, and upload
the zip by hand. That narrows the problem to the network or the password.

## 4. Watch the console

In a second terminal:

```sh
make debug
```

This streams the Roku's BrightScript console (port 8085). The channel prints
nothing of its own, by design: the access token must never reach this
console. What you'll see there is the OS's own messages, and **crash reports
with a file and line**, which is what you want it for. Leave it running.

## 5. Run a test SolPersona the Roku can reach

### Option A: the mock server

```sh
make mock          # listens on port 8090
```

The Roku has to reach your computer on port 8090. Find your computer's LAN
address (e.g. `192.168.1.20`). From another device on the network, opening
`http://192.168.1.20:8090/mock/state` should return JSON.

> **If your repository lives in WSL** (Windows): WSL 2 sits behind its own
> network, so a Roku can't reach a server started inside it. Either switch WSL
> to mirrored networking (`%UserProfile%\.wslconfig`, `[wsl2]` then
> `networkingMode=mirrored`, then `wsl --shutdown`), or forward the port from
> an administrator PowerShell:
> ```powershell
> netsh interface portproxy add v4tov4 listenport=8090 listenaddress=0.0.0.0 connectport=8090 connectaddress=$(wsl hostname -I).Trim().Split(' ')[0]
> New-NetFirewallRule -DisplayName "SolPersona mock" -Direction Inbound -LocalPort 8090 -Protocol TCP -Action Allow
> ```
> Installing on the Roku (`make dev`) works either way; only incoming
> connections to WSL need this.

The mock makes a short H.264 test film only if it finds an `ffmpeg` (on
`PATH`, or set `FFMPEG=/path/to/ffmpeg`). Without one, the video checks
need a real gallery.

### Option B: a development stack or staging

Use its address in the next step instead of the mock's. Production is
`https://solpersona.com`; leave that alone until the channel is ready.

### Point the channel at it

Either use the **hidden developer menu**: on the pairing screen press **★ five
times** within five seconds, then **Enter an address…** and type
`http://192.168.1.20:8090`. Or send a launch parameter, which only developer
builds accept:

```sh
curl -d '' "http://$ROKU_IP:8060/launch/dev?baseUrl=http://192.168.1.20:8090"
```

Changing the address forgets any existing link, so the channel shows a new
pairing code. Its address line should now read `192.168.1.20:8090/pair`.

## 6. Link the screen

- **Mock:** `curl http://192.168.1.20:8090/mock/link`. Within about 3 seconds
  the screen leaves the pairing code and starts playing.
- **Real stack:** scan the QR with your phone, sign in, press **Link this
  screen**, then choose and play a gallery in **Dashboard → Gallery
  Exhibition**.

Press **OK** and turn on **Debug overlay**. It shows sync latency, the clock
offset, what is on the wall, the cache and recent requests. Keep it on for
most checks below.

## 7. Driving the mock

Each command takes effect on the next poll (about 3 seconds):

```sh
M=http://192.168.1.20:8090/mock
curl "$M/set?fit=FRAME&frameStyle=OAK"        # any setting; arrives as a new version
curl "$M/set?slideSeconds=10"                 # faster changes while testing
curl  $M/next                                 # also: prev, pause, resume, restart
curl "$M/takeover?item=a:3&seconds=30"        # "show this now"; ?clear=1 ends it
curl "$M/command?type=identify"               # also: reload, clear-cache
curl "$M/status?value=IDLE"                   # also: PLAYING, UNLICENSED
curl "$M/offline?seconds=300"                 # a 5-minute outage; the mock remembers everything
curl "$M/keep?on=1"                           # the owner's "Keep this gallery on the screen"
curl  $M/unlink                               # remove the screen from its account
curl  $M/log                                  # the last sync bodies the Roku sent
```

The mock's terminal also prints each registration, link, reported film length
(`duration`) and offline report (`plays`).

## 8. The checks

These are the parts of [`solpersona/CONFORMANCE.md`](solpersona/CONFORMANCE.md)
the simulator could not prove. Do each on both devices.

### Pictures

- **Every fit** (`fit` = BLUR, FRAME, BLACK, FILL; FRAME with each
  `frameStyle`): compare with the reference simulator
  (`solpersona/reference/device-simulator.html`) on a laptop beside the TV,
  showing the same gallery. Pay most attention to the **BLUR wash**: it is an
  approximation (see [QUESTIONS.md](QUESTIONS.md)). If it looks blocky or
  banded, try the four `WASH_*` constants at the top of
  `components/views/ArtLayer.bs`, run `make dev` again, and record what worked.
- **Formats:** in the debug overlay's CACHE section, a piece shows `ready …
  webp` when the WebP copy decoded, or `decode webp` when it didn't and the
  next copy was used. Record either way.
- **Sharpness:** set `imageQuality` to ORIGINAL, then DISPLAY. ORIGINAL should
  be visibly sharper.
- **Labels from 3 m:** stand across the room. Check the museum card and the
  one-line label over a white piece (`a:4` on the mock) and a dark one.
- **QR:** scan the code on the wall with your phone. It should open the
  piece's page.

### Movement

- **Transitions:** FADE, DISSOLVE, CUT at `transitionMs` 600 and 3000.
  Note any stutter.
- **Two screens in step:** link both Rokus to the same gallery on a real stack
  (the mock serves one show to every screen, so it works too). Film both
  screens with a phone at 60 fps for a few changes, and count frames between
  them. Within ~150 ms (9 frames) passes.
- **Pause, next, previous, jump, restart** from the dashboard (or the mock):
  each should reach the wall within one poll.

### Video

Play a gallery with an MP4 film (the mock's `v:5` when ffmpeg is available).

- It starts in step (join mid-slot: it should start mid-film, not from the
  beginning). It plays muted, and with sound after `set?videoSound=true`.
- The film's length is reported once: the mock prints `duration v:5 …`, and
  the next version's timeline uses it.
- A short film loops whole plays. An estimated slot lets the film finish.
- The mock's `v:6` is WebM: it should show its still for the slot.
- Fading into and out of a film: the still fades, the film takes over after
  the fade.

### Keeping awake and power

- Set the Roku's screensaver wait to 5 minutes (**Settings → Theme →
  Screensavers → Change wait time**) and leave stills playing for 30 minutes.
  No screensaver should appear.
- Turn off **Keep the screen awake** in the developer menu and repeat. The
  screensaver should appear; that confirms what the setting does.
- On the Roku TV, note what **Auto power savings** does over several hours.
- Pull the power and restore it. Record where the Roku comes back to (we
  expect the Roku home screen: Roku can't auto-launch a channel).

### Network and storage

- **Outage:** `curl "$M/offline?seconds=300"`, or unplug the router's uplink.
  The wall keeps playing, with a small orange dot bottom-left. When it
  reconnects there should be no jump, and the mock prints `plays …` covering
  the outage.
- **Restart while offline:** with the network still down, restart the channel
  (Home, then open it again). It should come back linked, not on a pairing
  code. On a streaming Roku it shows "Connecting" until the network returns.
- **USB stick:** insert one, then `curl "$M/keep?on=1"`. The overlay's "On
  this screen" line says either "n of N pieces kept" or that this Roku can't
  write to the stick. Record which, because Roku documents USB as read-only
  for channels. If it does keep the gallery: pull the network, power-cycle,
  and confirm it plays the whole show from the stick.
- **Slow network:** throttle the Roku (router QoS, or a phone hotspot). The
  wall should hold the current piece until the next one has loaded, never
  show a blank one.

### Pairing and wording

- Leave the pairing screen for 16 minutes. It should get a new code by itself.
- **Try a sample gallery** (OK on the pairing screen). Link from your phone
  while it plays: your gallery should take over. Back returns to pairing.
- **Forget this account** (OK → Forget this account), and removing the screen
  from the dashboard (or `$M/unlink`): both return to a pairing code within a
  poll.
- Read every screen, including "isn't active" (`$M/status?value=UNLICENSED`).
  Nothing may mention buying, prices or plans.

### Eight hours unattended

Leave a gallery with stills and a film running overnight with `make debug`
open. In the morning, check for crashes in the console and look at the
overlay's error line. For memory, connect to the Roku's developer console
(`telnet <ROKU_IP> 8080`) and run `chanperf` at the start and the end. The
memory figure should be about the same.

## 9. Run the unit tests on the device

```sh
make test-device
```

This installs the test build and prints Rooibos's report from the Roku's
console. It should end in `[Rooibos Result]: PASS`, the same 67 tests CI runs
in the simulator. Run `make dev` afterwards to put the real channel back.

## 10. Screenshots

```sh
make screenshot    # saves to build/screenshots/
```

Use real-device screenshots in `CONFORMANCE-RESULTS.md` and, once the art is
final, in the README in place of the simulator renders.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `make dev` says it can't connect | Wrong `ROKU_IP`, the Roku is on another network/VLAN, or the developer installer is off (repeat step 1). |
| `make dev` says unauthorized | Wrong `ROKU_PASSWORD` (the developer password, not your Roku account's). |
| Pairing screen says "Cannot reach …" | The Roku can't reach the address set in step 5: test it from another device; check the firewall, and the WSL note. |
| The QR and code never appear | Same as above, or the address has a typo: reopen the developer menu (★ ×5). |
| Pieces stay on the loading dot | Media URLs aren't reachable from the Roku. In the mock, media URLs use the address the Roku called, so this means the port is blocked. |
| `make debug` shows nothing | Normal until something happens: the channel itself never prints. |
| A crash in the console | Note the file and line, run `make test` locally, and open an issue with the Roku model and OS version. |

## Recording results

Fill in the device table and the per-device sections of
[`CONFORMANCE-RESULTS.md`](CONFORMANCE-RESULTS.md): model, OS version, and
for each check a short pass/fail with anything surprising. Commit it with the
date, so the next tester can see what changed between OS versions.
