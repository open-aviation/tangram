# protocol

The WebSocket protocol follows the Phoenix Channels message format, which uses JSON arrays with the following structure:

```
[join_ref, ref, topic, event, payload]
```

Where:
- `join_ref`: Reference to the channel join request (null for system messages)
- `ref`: Message reference for tracking responses
- `topic`: Channel name
- `event`: Event name
- `payload`: Message data

### Events

- `phx_join`: Join a channel (requires JWT token)
- `phx_leave`: Leave a channel
- `phx_reply`: Acknowledgment of a message
- `presence_state`: Current state of all clients in a channel
- `presence_diff`: Changes in channel presence
- Custom events: Any custom event name can be used for application-specific messages