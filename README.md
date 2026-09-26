# PMWS — Public Mass Warning System

A browser-based audio alert system. A transmitter plays AFSK data bursts through
its **speakers**, followed by an attention tone and a text-to-speech message. Receivers
listen on the **microphone**, decode the bursts, show a full-screen alert and read it aloud.

**Live site:** https://firesafetylite.github.io/pmws/

## Each alert carries
- Alert type (e.g. `TORW`, `EVAC`, `TEST`)
- Location
- Effective-until time (UTC)
- Message (read by TTS)

## Protocol

| | |
|---|---|
| Modulation | AFSK 1200 baud, async 8N1 |
| Mark / space | 1300 Hz / 2500 Hz |
| Frame | `PMWS2\|id\|TYPE\|location\|YYYYMMDDTHHMMZ\|message\|CRC16` + EOT |
| Attention | 700 + 500 Hz dual square-wave tone |
| End | 3 × `ENDM` frame |

### Headers
Each transmission sends the **same header 3 times** (0.5 s apart) for redundancy. The first copy a receiver
decodes activates it: the full alert screen appears and a 350 Hz tone plays while the remaining
copies arrive. After the 3rd copy (or a timeout if copies are lost), the tone stops and the
alert is read aloud. Every burst carries a CRC-16.

### Shorthand compression
Common alert words and phrases (e.g. "take shelter", "immediately", state names) are sent as
1–2 byte codes (`js/codebook.js`) and expanded back to the exact original text by receivers.
A typical 250-character alert shrinks by roughly 40%. The codebook is part of the protocol:
only append new entries, never reorder or remove.

### Spoken message
Receivers (and the transmitter) read the alert as, e.g.:
> Attention. Tornado Warning for the State of Kansas, effective until 9:30 PM. Take shelter now.

The location gets "the" where needed and is title-cased if typed all lowercase or all caps.
Only the time (local, 12-hour) is spoken, not the date. The message is capitalised and ended
with a period.

### Test / Drill
`TEST` alerts play only the tones (data bursts and attention tone). No text-to-speech on the
transmitter or receivers, and the message is optional.

## Use
1. Open the site on two devices (or one, since it will hear itself).
2. Receiver: **Start listening** and allow microphone access.
3. Transmitter: fill in the form and click **Broadcast alert**.

## Development
Plain static files, no build step. Serve locally with `python3 -m http.server` and run
`node test/modem.test.mjs && node test/echo.test.mjs && node test/limits.test.mjs && node test/speech.test.mjs && node test/codebook.test.mjs`.
