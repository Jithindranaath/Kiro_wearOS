# Aibou — Requirements

## Overview
Aibou is a remote control for locally running Kiro agent sessions, enabling developers to approve/deny permission requests from their phone or watch without returning to their desk.

## Requirements

### R1: Bridge Core (ACP Host)
- The Bridge SHALL spawn Kiro CLI as an ACP subprocess and manage the session lifecycle.
- The Bridge SHALL intercept permission requests and hold ACP responses until resolved.

### R2: Permission Interception & Policy
- The Bridge SHALL evaluate permission requests against a configurable policy engine.
- Unmatched rules SHALL escalate to the human (fail closed).
- Deny rules SHALL always take precedence over allow rules.

### R3: Transport & Auth
- The Bridge SHALL bind to 127.0.0.1:8787 by default.
- Clients SHALL authenticate via a 6-digit pairing code exchanged for a bearer token.

### R4: PWA Client
- The PWA SHALL display sessions, live events, and approval controls.
- The PWA SHALL be installable as a standalone app.

### R5: Wear OS Client
- The watch app SHALL display a glanceable approval screen with single-tap approve/deny.
- The watch app SHALL vibrate and wake the screen on permission requests.
