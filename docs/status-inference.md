# Status Inference

> Documents every heuristic used to derive session status, per AC1.4.4.
> Any status with `statusSource: "inferred"` renders with an `inferred` marker in both clients.

## Status Table

| Status | Source | Rule |
|---|---|---|
| `awaiting_permission` | observed | ≥1 pending approval record exists |
| `working` | observed | Prompt sent, no `turn_end` received yet |
| `idle` | observed | `turn_end` received |
| `awaiting_input` | **inferred** | Turn ended with trailing interrogative, no tool call in final segment |
| `error` | observed | ACP error frame or agent stderr output |
| `disconnected` | observed | Child process exited |

## Heuristic: `awaiting_input`

**Logic:** After a `turn_end`, if the last `agent_message_chunk` text ends with `?` and there was no `tool_call` update in the final segment, infer the agent is waiting for user input.

**Known failure modes:**
1. Agent asks a rhetorical question at end of turn → false positive
2. Agent asks a question mid-paragraph that gets chunked across updates → may miss the `?`
3. Non-English content where questions don't end with `?` → false negative

**Mitigation:** Always show `inferred` badge in UI. Users can send a prompt regardless of displayed status.
