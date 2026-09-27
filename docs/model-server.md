# Model server contract

The interface between the Thalamus API gateway and the model server operated by the model lab. It is functional only and says nothing about how the model works. The gateway is the only caller; none of these endpoints is public.

## Endpoints

| Method and path | Purpose |
|---|---|
| `POST /internal/v1/generate` | Generate a reply; SSE response |
| `POST /internal/v1/sessions/{session_id}/end` | Merge a session into its user's memory |
| `POST /internal/v1/warm` | Load a user's memory ahead of a first message (body: `{"user_key"}`) |
| `DELETE /internal/v1/users/{user_key}` | Erase a user's memory and all of their sessions; idempotent |
| `GET /internal/healthz` | Readiness for the gateway's circuit breaker |

## Authentication

Every request carries `X-Thalamus-Signature: t=<unix seconds>,n=<nonce>,s=<hex HMAC-SHA256 of "t.n.body">` with a secret shared by the gateway and the model server. The model server rejects a timestamp more than 60 seconds from its clock and any repeated nonce.

## Generate

```json
{
  "request_id": "uuid",
  "model": "thalamus-sophon-1.0",
  "user_key": "pseudonymous stable id",
  "session_id": "uuid",
  "new_session": false,
  "regenerate": false,
  "messages": [{ "role": "user", "content": "..." }],
  "max_output_chars": 16000,
  "resume_token": null
}
```

- `messages` holds only the turns the session has not seen. On a new session it holds the full transcript, including any `system` message, which becomes part of the session.
- `regenerate: true` with no `messages` replays the last turn from the state before it.
- An edit to an earlier message is sent as a new session with the transcript up to the edit.
- `resume_token` is reserved and always `null`. Streams are not cut by the host's request timeout once bytes are flowing.

### Stream

```
event: delta
data: {"text":"..."}

event: done
data: {"finish_reason":"stop","chars_in":123,"chars_out":456,"user_file_bytes":0,"session_file_bytes":0}

event: error
data: {"code":"MEMORY_LOAD_FAILED","message":"..."}
```

### Commit rule

The model server saves the session only after it has sent `done`. A disconnect or failure before `done` leaves the session unchanged, and the gateway may retry the same `request_id`. The session records the last committed `request_id`; a repeat of it returns `ALREADY_COMMITTED` together with the stored final text, which the gateway treats as a completed reply.

## Guarantees from the gateway

- At most one `generate`, `end` or `warm` call is in flight per `user_key`.
- `session_id` and `request_id` are minted by the gateway.
- `user_key` never contains an email or a raw account id.

## Limits

The model server enforces 64 MiB per user and 8 MiB per session, returning `FILE_CAP_REACHED` instead of truncating. Deleted memory stops being readable immediately; storage billing can lag by up to four days.

## Error codes

| Code | Gateway response |
|---|---|
| `MODEL_CAPACITY_EXCEEDED` | 503 with `Retry-After` |
| `MEMORY_LOAD_FAILED` | 502, retried once |
| `MEMORY_SAVE_FAILED` | 502; the turn is not recorded as committed |
| `FILE_CAP_REACHED` | 413 |
| `UNKNOWN_SESSION` | Start a new session with the full transcript |
| `SESSION_INCOMPATIBLE` | Session made by another model version; start a new session. User memory carries across versions. |
| `ALREADY_COMMITTED` | 200 with the stored reply |
| `INTERNAL_ERROR` | 500 |

Every error still produces a usage event for anything streamed before it.
