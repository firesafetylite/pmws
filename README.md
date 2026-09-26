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
| Modulation | AFSK 600 baud, async 8N1 |
| Mark / space | 1300 Hz / 2500 Hz |
| Frame | `PMWS1\|id\|TYPE\|seq\|location\|YYYYMMDDTHHMMZ\|message\|CRC16` + EOT |
| Attention | 700 + 500 Hz dual square-wave tone |
| End | 3 × `ENDM` frame |

### Progressive headers
Each transmission sends 3 header bursts, each adding information:

1. **Header 1/3**: ID + alert type. Activates receivers: they show the alert screen and play a 350 Hz tone.
2. **Header 2/3**: adds location and effective-until time.
3. **Header 3/3**: adds the message. The alert is complete, the tone stops and the alert is read aloud.

If a later header is lost, the receiver completes the alert with whatever it has.
Every burst carries a CRC-16.

### Test / Drill
`TEST` alerts play only the tones (data bursts and attention tone). No text-to-speech on the
transmitter or receivers, and the message is optional.

## Use
1. Open the site on two devices (or one, since it will hear itself).
2. Receiver: **Start listening** and allow microphone access.
3. Transmitter: fill in the form and click **Broadcast alert**.

## Development
Plain static files, no build step. Serve locally with `python3 -m http.server` and run
`node test/modem.test.mjs && node test/headers.test.mjs`.
