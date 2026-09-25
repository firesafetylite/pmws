# PMWS — Public Mass Warning System

A hobby, browser-based audio alert system inspired by EAS. A transmitter plays an
AFSK data burst through your **speakers**, followed by an attention chime and a
text-to-speech message. A receiver listens on the **microphone**, decodes the
burst, shows a banner and reads the alert aloud.

**Live site:** https://firesafetylite.github.io/pmws/

> ⚠️ Not affiliated with, and deliberately **incompatible** with, EAS/SAME.
> It cannot trigger real EAS/NOAA weather radio decoders. Don't use it for real emergencies.

## Each alert carries
- Alert type (e.g. `TORW`, `EVAC`, `TEST`)
- Location
- Effective-until time (UTC)
- Message (read by TTS)

## Protocol

| | PMWS | EAS / SAME |
|---|---|---|
| Modulation | AFSK 600 baud, async 8N1 | AFSK 520.83 baud |
| Mark / space | 1300 Hz / 2500 Hz | 2083.3 Hz / 1562.5 Hz |
| Preamble | 300 ms continuous mark | 16 × `0xAB` |
| Header | `PMWS1\|id\|TYPE\|location\|YYYYMMDDTHHMMZ\|message\|CRC16` + EOT | `ZCZC-…` |
| Attention | 698 / 1047 Hz alternating chime | 853 + 960 Hz dual tone |
| End | frame with type `ENDM` | `NNNN` |

Each header is sent 3×; receivers de-duplicate by ID and verify a CRC-16.

## Use
1. Open the site on two devices (or one — it'll hear itself).
2. Receiver: **Start listening** and allow microphone access.
3. Transmitter: fill in the form and click **Broadcast**.

You can also download a `.wav` of the data bursts and play it from anywhere.

## Development
Plain static files, no build step. Serve locally with `python3 -m http.server` and
run the modem self-test with `node test/modem.test.mjs`.
