# Datalink Plugin

The `tangram_datalink` plugin bridges normalized datalink events from [`datalink`](https://github.com/xoolive/datalink) decoder into
`tangram`.

## Redis Events

| Direction | Channel                                 | Event/Command | Payload                                                            |
| :-------- | :-------------------------------------- | :------------ | :----------------------------------------------------------------- |
| Input     | `datalink-*`                            | `PUBLISH`     | Normalized decoded event emitted by `datalink                      |
| Output    | `to:datalink:feed:message`              | `PUBLISH`     | The same normalized event schema, relayed to the frontend.         |
| Output    | `to:streaming-{id}:new-datalink-data`   | `PUBLISH`     | `{ "count": 123, "aircraft": [...] }` containing visible aircraft. |

## Configuration

See [`tangram_datalink.backend.DatalinkConfig`][] for all available options.
