# Status Inference

Documents every heuristic used to derive session status (AC1.4.4).

Any status with `statusSource: "inferred"` is rendered with an `inferred` marker
in both the PWA and the Wear OS app. Everything else is `observed`, meaning it
comes directly from an ACP signal.

## Status table

| Status | Source | Derived from |
|---|---|---|
| `awaiting_permission` | observed | ≥1 held `session/request_permission` |
| `working` | observed | Prompt forwarded; turn not yet resolved |
| `idle` | observed | `session/prompt` resolved with `stopReason: "end_turn"` |
| `awaiting_input` | **inferred** | See heuristic below |
| `error` | observed | `stopReason: "refusal"`, ACP error frame, or prompt failure |
| `disconnected` | observed | Agent child process exited |

## How end-of-turn is detected

ACP v1 has **no `turn_end` notification**. The authoritative end-of-turn signal
is the response to the original `session/prompt` request, carrying a
`stopReason` (verified against kiro-cli 2.18.1 — see `acp-findings.md`).

| `stopReason` | Resulting status |
|---|---|
| `end_turn` | `idle`, or `awaiting_input` if the heuristic below fires |
| `max_tokens` | `idle` with `statusReason: "Turn stopped: max_tokens"` |
| `max_turn_requests` | `idle` with `statusReason: "Turn stopped: max_turn_requests"` |
| `cancelled` | `idle` with `statusReason: "Turn stopped: cancelled"` |
| `refusal` | `error` with an explanatory `statusReason` |

`max_tokens`, `max_turn_requests` and `cancelled` are reported as `observed`
because the agent stated them explicitly; the `statusReason` preserves the
detail rather than flattening it to a bare `idle`.

## The one inferred status: `awaiting_input`

**Rule.** When a turn ends with `stopReason: "end_turn"`, the session is marked
`awaiting_input` if **both** hold:

1. No `tool_call` update was seen during the turn, and
2. The accumulated `agent_message_chunk` text ends with `?` (ignoring trailing
   whitespace).

Otherwise the session is `idle`.

**Why it is a guess.** ACP does not distinguish "I finished" from "I finished and
I am waiting for you to answer something". The agent simply ends its turn. The
trailing question mark is the only available signal.

### Known failure modes

| Failure | Effect | Why it is acceptable |
|---|---|---|
| Rhetorical question at end of turn ("Neat, right?") | False positive: shows `awaiting_input` when nothing is needed | Labelled `inferred`; sending a prompt is never blocked by status |
| Question not at the very end ("Should I proceed? I'll wait.") | False negative: shows `idle` | Status is advisory only |
| Non-English text where questions do not end with `?` | False negative | Same as above |
| Question asked mid-turn, then tools run | False negative (tool call seen) | Correct: the agent kept working |
| Agent ends with a question *and* ran tools | False negative by design | Tool activity is stronger evidence the agent was working, not asking |

### Mitigations

- The marker is always shown next to the status in both clients.
- Status never gates actions: prompting and interrupting stay available in every
  state, so a wrong inference cannot block the user.
- `statusReason` carries a plain-language explanation, surfaced on the PWA.

## What is deliberately not inferred

Per the honesty rule (`context.md` §6), the Bridge does not guess at:

- **Token or cost usage.** Emitted only when the agent sends `usage_update`.
  With no `usage_update`, clients render `—` rather than a plausible number.
- **Progress percentages.** ACP exposes a task list via the `plan` update, but no
  overall progress figure, so none is shown.
- **Time remaining.** Not derivable; the clients show elapsed time in the current
  status instead, computed from real timestamps.
