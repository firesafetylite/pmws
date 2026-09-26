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
| Modulation | AFSK 700 baud, async 8N1 |
| Mark / space | 1300 Hz / 2500 Hz |
| Frame | `PMWS1\|id\|TYPE\|location\|YYYYMMDDTHHMMZ\|message\|CRC16` + EOT |
| Attention | 700 + 500 Hz dual square-wave tone |
| End | 3 × `ENDM` frame |

### Headers
Each transmission sends the **same header 3 times** for redundancy. The first copy a receiver
decodes activates it: the full alert screen appears and a 350 Hz tone plays while the remaining
copies arrive. After the 3rd copy (or a timeout if copies are lost), the tone stops and the
alert is read aloud. Every burst carries a CRC-16.

### Test / Drill
`TEST` alerts play only the tones (data bursts and attention tone). No text-to-speech on the
transmitter or receivers, and the message is optional.

## Use
1. Open the site on two devices (or one, since it will hear itself).
2. Receiver: **Start listening** and allow microphone access.
3. Transmitter: fill in the form and click **Broadcast alert**.

## Development
Plain static files, no build step. Serve locally with `python3 -m http.server` and run
`node test/modem.test.mjs && node test/echo.test.mjs`.
