# Submitting SolPersona Gallery to the Roku Channel Store

Every step from a finished build to a published channel, in order. Testing a
build on your own Roku first is in [TESTING-ON-ROKU.md](TESTING-ON-ROKU.md).

Roku's Developer Dashboard changes its screens from time to time. Where it
asks for something this guide doesn't mention, follow the dashboard.

---

## Decisions already made

| Question | Decision |
|---|---|
| **Screensaver** (certification rule 4.5: apps must not override the system screensaver) | The channel doesn't hold it off. The keep-awake clip from earlier builds is gone. Owners turn the screensaver off on gallery screens (the README says how). A playing film keeps the screen awake by itself. |
| **Linking by code** (rules 2.2 / 4.2 / 4.3 favour sign-in on the device) | Submit with code linking, as the other SolPersona players do. Reviewers get a SolPersona test account with test images, and **Try a sample gallery** works without an account. If Roku insists on sign-in on the TV, that can be added later (it needs a new SolPersona endpoint). |
| **Commerce** | None. The channel sells nothing, and SolPersona sells no screens yet. No Roku Pay, no subscription products. |

Background for each is in [QUESTIONS.md](QUESTIONS.md) §1–2.

---

## What you need

- A Roku developer account (developer.roku.com) and a Roku in developer mode
  that you keep. Its signing key becomes the channel's identity.
- `.env` in the repo root (git-ignored) with `ROKU_IP`, `ROKU_PASSWORD` and,
  after step 4, `ROKU_SIGNING_PASSWORD`.
- The Roku linked to a SolPersona account showing a typical gallery, with
  some films.
- On that Roku:
  - **Settings → Theme → Screensavers → Change wait time → Disabled.**
    Owners will do the same.
  - No telnet session left open to port 8080: the soak test reads memory
    there, and the Roku takes one client at a time.
- A SolPersona **test account for the reviewer**, linked to nothing, with a
  small public gallery of test images and at least one film. Its email and
  password go only into the dashboard's reviewer notes, never into this repo.

---

## Step by step

### 1. Final artwork

Replace the placeholder art in `images/`. You can edit `tools/make-art.mjs`
and run `make art`, or drop in finished files. None may have transparency.

| File | Size | Used for |
|---|---|---|
| `channel-poster_fhd.png` | 540×405 | home-screen tile (FHD) |
| `channel-poster_hd.png` | 290×218 | home-screen tile (HD) |
| `splash_fhd.jpg` | 1920×1080 | launch splash |
| `splash_hd.jpg` | 1280×720 | launch splash |
| `splash_sd.jpg` | 720×480 | launch splash |

The dashboard asks for its own store artwork too (step 8). Prepare the same
art at the sizes it lists.

### 2. Version

In `manifest`, raise `build_version` for **every** upload; Roku rejects a
repeat. Raise `minor_version` or `major_version` for real releases. Commit the
change, because the soak report records the commit and flags uncommitted
changes.

### 3. Check that it's pointed at production

The channel uses `https://solpersona.com` unless someone changed it in the
★×5 developer menu on that Roku. Check that **SolPersona address** there
reads `https://solpersona.com`. Store builds ignore the development launch
parameters.

### 4. Make the signing key (once, ever)

On the Roku you keep:

```sh
telnet <ROKU_IP> 8080
genkey
```

Close that telnet session afterwards (type `exit`). The soak test needs the
port.

- Store the printed **password** and **DevID** in your password manager.
- Add `ROKU_SIGNING_PASSWORD=<password>` to `.env`.
- **Never commit them, and don't lose them.** Every future update must be
  signed with this same key. To sign on a different Roku later, use that
  Roku's Utilities → **Rekey** with a package you've already signed, plus
  the password.

### 5. Run the checks and the soak test

```sh
make lint test                 # 70 tests, all must pass
make soak                      # 8 hours by default
```

`make soak` builds the zip, has the Roku **install and sign that exact zip**
(the `.pkg` lands in `build/`), then watches it run. See
[The soak test](#the-soak-test) below. Wait for **PASS**.

Also, by hand:

- Run Roku's **Static Analysis** (Developer Dashboard → the channel →
  Static Analysis) on the `.pkg`. Fix anything marked **Mistake**. See
  [Static Analysis results](#static-analysis-results) for what the first run
  found and what each finding means.
- Check the basics on the TV: the pairing screen and QR, **Try a sample
  gallery**, linking with a code, OK overlay → **Forget this account**, and
  Back → **Leave the gallery?** → Leave.
- Make sure the debug overlay is **off** (OK → Debug overlay) before
  screenshots or handing the build over.

### 6. Keep the evidence

Keep `build/soak/<time>/` (the report, screenshots and raw data) and the
signed `build/solpersona-gallery-roku.pkg` together. The report records both
files' SHA-256, so it proves which package was tested. Roku doesn't ask you to
upload a soak report. It's your record, and its summary goes in the reviewer
notes.

### 7. Create the channel in the dashboard

Developer Dashboard → **Streaming Store / Channel** → add a new **public**
channel (the type is "SDK"/"Public", not "Beta" or "Non-certified").

### 8. Fill in the listing

| Field | Suggestion |
|---|---|
| Name | SolPersona Gallery |
| Short description | Your art, on the wall. |
| Long description | See the draft below. |
| Category | Photos & Video / Art (whichever the dashboard offers closest to art display) |
| Content rating | Fill in the questionnaire. User galleries are curated art. |
| Countries / languages | Where SolPersona is offered / English |
| Monetization | None (free) |
| Store artwork | The sizes the dashboard lists, plus screenshots (`docs/screenshots/` or fresh ones from `make screenshot`, with the debug overlay off) |
| Privacy policy URL | A page on solpersona.com (required) |
| Terms of use URL | A page on solpersona.com |
| Support email / URL | SolPersona support |

**Long description (draft):**

> SolPersona Gallery turns your Roku into a gallery wall for your SolPersona
> art. Open it, scan the QR code with your phone and link the screen to your
> SolPersona account. Then choose what it shows from SolPersona: a gallery,
> how each piece is framed, when the wall opens and closes, and which piece
> takes over right now. Several screens showing one gallery stay in step.
> No account? Choose "Try a sample gallery" to see it in action.
> For an always-on wall, turn off the Roku screensaver: Settings → Theme →
> Screensavers → Change wait time → Disabled.

### 9. Upload and write the reviewer notes

Upload `build/solpersona-gallery-roku.pkg` (the one the soak test signed).
Set **minimum firmware** to **15.1** (or the closest version above it in the
list): the channel uses RSG 1.3, which Roku requires to run on OS 15.1 or
later.

In the channel's properties, **don't** select a customer-account or
subscription requirement that implies Roku Pay. The channel is free, sells
nothing, and has no sign-up or sign-in form (it links by code). Those
settings make Static Analysis demand Roku Pay features (`getUserData`, the
Partner Payouts Program).

**Reviewer notes.** The publish page (October 2026) has no reviewer-notes
field. With no customer-account requirement set, it doesn't ask for test
credentials either. Reviewers use **Try a sample gallery**, which the
description and release notes mention. If certification asks for an account,
reply to their email with the test account. Keep this text ready for that
email, or for a notes field if the dashboard adds one:

> **What it is.** An ambient art display. A SolPersona user links the screen
> to their account by code (QR or solpersona.com/pair). Then the screen shows
> their chosen gallery continuously. Nothing is sold in the channel and there
> is no sign-in form.
>
> **To review without an account:** on the first screen press OK on **Try a
> sample gallery**.
>
> **To review a linked screen:** sign in at https://solpersona.com/pair on a
> phone or computer with the test account **[email] / [password]** and enter
> the code shown on the TV. The test gallery has [N] images and [N] films.
>
> **Remote:** OK shows an overlay (screen name, what's showing, **Forget this
> account** to unlink). Back asks before leaving.
>
> **Screensaver:** the channel doesn't override the system screensaver. On an
> always-on wall the owner disables it in Roku Settings. A playing film keeps
> the screen awake as usual.
>
> **Testing:** ran [8 h] unattended on a [Roku Ultra 4800X, OS 16.0.4], no
> crashes, memory steady ([+0.0 MiB/hour]).

### 10. Submit for certification

Submit. Roku tests it and emails results, usually within a few days to a
couple of weeks. If it fails:

1. Read the failed criteria and fix them.
2. Raise `build_version` (step 2) and commit.
3. Run `make soak` again. It re-signs with the same key.
4. Upload the new `.pkg` and resubmit, noting what changed.

### 11. Publish

Once it's approved, publish from the dashboard (you can set a release date).
Keep the signing password, DevID, the `.pkg` and the soak folder for that
version.

---

## The soak test

`make soak` (or `node tools/soak.mjs`) runs the build that will be uploaded
for hours, unattended, and writes a report.

```sh
make soak                                  # 8 hours: memory every 2 min, screenshot every 10 min
make soak SOAK="--hours=12"
make soak SOAK="--minutes=10 --mem-mins=1 --shot-mins=2"    # a quick trial
make soak SOAK="--no-package"              # without signing (no key yet)
```

**What it does:**

1. Builds the zip, and has the Roku install it as the dev channel and sign
   that same zip into `build/solpersona-gallery-roku.pkg`. What runs is what
   gets uploaded.
2. Every 2 minutes it records the channel's memory and CPU (`chanperf`) and
   texture memory (`r2d2_bitmaps`) from the developer console on telnet
   port 8080. Where ECP's Network access is Permissive, it uses ECP's
   `/query/chanperf` instead. It also records which app is in front,
   including whether the screensaver is up (ECP `/query/active-app`, allowed
   in Limited mode).
3. Every 10 minutes it takes a screenshot.
4. The whole time it listens to the BrightScript console (port 8085) for
   crashes and debugger stops. **Close `make debug` and any telnet session
   to 8080 first**, because the Roku accepts one client on each.
5. At the end it writes `build/soak/<time>/report.html` (open it in a
   browser) and `report.md`, plus `samples.json`, `console.log` and
   screenshots. **Ctrl-C** ends early and still writes the report. A partial
   report is refreshed as it goes.

**It passes when:**

- there was no crash or debugger stop;
- the channel was in front at every sample;
- memory grew by less than 2 MiB/hour after the first 15 minutes (warm-up,
  shaded on the chart);
- the screenshots change over time (the wall is playing).

It only warns if the screensaver appeared: that means the Roku's
screensaver is still on, not that the channel is at fault.

**Before you start:** turn the screensaver off and close other console
sessions (see [What you need](#what-you-need)). If it can't read memory, the
run stops at once and says why. Leave the TV on, and don't touch the remote for
the length of the run. Roku screenshots leave out video, so a film shows as
black in them; that's expected.

---

## Static Analysis results

First run, version 1.0.2 (2026-10-15):

| Finding | What it meant | Done |
|---|---|---|
| RSG 1.3 needs minimum firmware 15.1 | Dashboard setting | Set 15.1 on upload (step 9) |
| `getUserData` required for authenticated channels (RP 2.1/4.1, 2.2); "Customer Account Requirement" selected without the Partner Payouts Program | Triggered by the channel properties: those rules are for channels that sign people up or sell through Roku Pay | Clear that property (step 9). If Roku still requires on-device sign-up, adding Roku's Request for Information (email) needs a new SolPersona endpoint ([QUESTIONS.md](QUESTIONS.md) §2) |
| `InitClientCertificates()` deprecated (×3) | Only needed for client-certificate servers; HTTPS needs only the CA bundle | Removed |
| `GetVersion()` deprecated | Was `roAppInfo.GetVersion()` | Version is read from the manifest fields |
| Manifest `subtitle` deprecated | — | Removed |
| Memory monitoring not found (`EnableMemoryWarningEvent`, `EnableLowGeneralMemoryEvent`, `GetMemoryLimitPercent`, `GetChannelMemoryLimit`) | Roku wants channels to react to low memory | The media task listens for both events. On a warning the scene lets go of every picture not on the wall, plus cached files when the Roku is critical. The debug overlay shows memory as a percentage of the limit |
| `KeyboardDialog` not valid for voice entry | Was only a fallback for old firmware | `StandardKeyboardDialog` only |

