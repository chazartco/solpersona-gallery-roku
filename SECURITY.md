# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use
**GitHub → Security → Report a vulnerability** on this repository (private
vulnerability reporting). Include the Roku model and OS version, the channel
version (shown in the OK overlay), and steps to reproduce. We aim to answer
within five working days.

## What this channel holds, and how

| Secret | Where it lives | Never |
|---|---|---|
| The screen's access token (`sps_…`) | The Roku's private registry section `solpersona`, flushed the moment it arrives (SPEC §3.3). Held in memory by `ApiTask` to sign requests. | Printed, logged, drawn on screen, put in a URL, or sent to any host other than the configured SolPersona base URL. The channel has **no `print` statements** (bslint `no-print` is an error in CI), so nothing reaches the developer console on port 8085. |
| The pairing `deviceCode` | Registry, only while a code is on screen (so a restart keeps the same code). Deleted once linked. | Displayed. |

Media URLs are public and are fetched **without** the token (SPEC §6.1). The
QR endpoint needs the token, so QR images are downloaded by `ApiTask` with
the `Authorization` header and shown from `tmp:/`.

## Things that are deliberately limited

* **The base URL** can be changed only from the hidden developer menu on the
  pairing screen (★ five times), and changing it forgets the screen's link —
  a credential belongs to the SolPersona that issued it.
* **Launch parameters** (`baseUrl`, `keepVolume`) are honoured only by
  sideloaded developer builds (`roAppInfo.IsDev()`): anyone on the local
  network can send launch parameters to a Roku, and re-pointing a store build
  would unlink a screen from its account.
* **Debug overlay** shows the device id, the base URL and recent request
  paths (no query strings, no headers, no bodies) — never the token.
* No analytics, no crash reporting, no third-party SDKs.

## Out of scope

Physical access to a Roku in developer mode (which allows installing any
channel) and the security of the SolPersona service itself.
