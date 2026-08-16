# Security — Aibou

Aibou is a remote control for a process that executes arbitrary shell commands. Security is treated as an application quality deliverable.

## Threat Model

| Threat | Impact | Mitigation |
|---|---|---|
| Attacker on the LAN intercepts traffic | Can see approval content, steal token | Bind to 127.0.0.1 by default; LAN binding requires explicit `--host` flag with printed warning; recommend Tailscale/VPN for remote access |
| Attacker brute-forces pairing code | Gains permanent access token | 6-digit code (1M combinations); rate limit: 5 attempts/60s → 5-min block per IP; code expires in 10 minutes |
| Token stolen from device storage | Full session control | PWA: localStorage (same-origin protection); Wear: EncryptedSharedPreferences with AES-256 |
| Malicious client sends forged approval | Agent executes unauthorized action | Bearer token required on all connections; token is 32 bytes CSPRNG; constant-time comparison prevents timing attacks |
| Agent self-modifies Aibou config | Policy bypass | Default deny rule prevents writes to `~/.aibou/` |
| Replay attack on WebSocket | Re-approve previously denied action | Each approval has a unique `approvalId`; second response returns `AIBOU_ALREADY_RESOLVED` |

## Architecture Decisions

### Binding
- Default: `127.0.0.1:8787` (localhost only)
- LAN mode: requires `--host 0.0.0.0` flag
- When LAN-bound, Bridge prints a warning naming the exposure risk

### No TLS
Aibou does not implement TLS. Rationale:
- Default binding is localhost (no network exposure)
- LAN binding is intended for trusted home/office networks
- For remote access, users should use Tailscale, WireGuard, or similar VPN
- Self-signed certificates create UX friction without meaningful security against local attackers

**Recommendation for users:** If accessing the Bridge from outside your local machine, use [Tailscale](https://tailscale.com/) for zero-config encrypted networking.

### Token Handling
- Tokens are generated with `crypto.randomBytes(32)` (CSPRNG)
- Stored in `~/.aibou/config.json` with restricted permissions where supported
- Never logged at any level
- Compared using `crypto.timingSafeEqual` (constant-time)

### Policy Engine — Fail Closed
- If no rule matches a permission request → escalate to human (never auto-approve)
- If both `allow` and `deny` rules match → deny wins (regardless of order)
- If `policy.json` is malformed → fall back to paranoid mode (escalate everything)
- `--paranoid` flag escalates everything regardless of rules

### Rate Limiting
- Pairing endpoint: 5 failed attempts per IP in 60 seconds → block for 5 minutes
- WebSocket: auth required within 5 seconds or connection is closed (code 4401)
- Heartbeat: 3 missed pongs → connection terminated

## What an Attacker on the LAN Could Do

If the Bridge is running with `--host 0.0.0.0` and an attacker is on the same network:

1. **Without a token:** Nothing. All WebSocket connections require auth within 5 seconds. All API endpoints except `/api/health` require authentication.
2. **If they guess the pairing code:** They get a valid token and full control. Mitigated by: code expiry (10 min), rate limiting, and the fact that the code is displayed only in the terminal.
3. **If they steal a token:** Full control over the Kiro session (approve/deny permissions, send prompts, interrupt). Mitigated by: tokens are stored only on the paired device, never transmitted after initial pairing.

## Recommendations for Users

1. Use the default localhost binding unless you specifically need LAN access
2. If using LAN binding, ensure you're on a trusted network
3. For remote access, use Tailscale or a VPN — do not expose the Bridge to the public internet
4. Regenerate the pairing code periodically (restart the Bridge or send SIGHUP)
5. Review `~/.aibou/policy.json` to ensure the default rules match your risk tolerance
