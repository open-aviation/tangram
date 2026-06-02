# Datalink Plugin

The `tangram_datalink` plugin bridges ACARS and VDL2 datalink data into `tangram`.

## Redis Events

| Direction | Channel                                 | Event/Command | Payload                                                            |
| :-------- | :-------------------------------------- | :------------ | :----------------------------------------------------------------- |
| Input     | `from:datalink:live`                    | `PUBLISH`     | Decoded datalink JSON message from the upstream producer.          |
| Output    | `to:datalink:feed:message`              | `PUBLISH`     | Normalized message envelope for the selected aircraft feed.        |
| Output    | `to:streaming-{id}:new-datalink-data`   | `PUBLISH`     | `{ "count": 123, "aircraft": [...] }` containing visible aircraft. |

## Configuration

See [`tangram_datalink.backend.DatalinkConfig`][] for all available options.
