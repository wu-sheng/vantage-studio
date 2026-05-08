<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Compatibility

Vantage Studio v0.1+ requires **Apache SkyWalking 10.5.0 or newer**.

The 10.5.0 release is the first SkyWalking version that ships the
`admin-server` module, the runtime-rule receiver, the `/runtime/oal/*`
listing endpoints, and the `/dsl-debugging/*` live-debugger surface
that Studio binds to. Earlier OAP releases do not expose these
endpoints; Studio will not run against them.

## Ports Studio uses

| Port    | Module          | Purpose                                                  |
| ------- | --------------- | -------------------------------------------------------- |
| `17128` | `admin-server`  | Runtime-rule + OAL listing + DSL-debugging HTTP surface. |
| `12800` | `query-graphql` | Cluster status (`/status/cluster/nodes`).                |

The admin-server has no auth of its own — keep it on the cluster's
private network and put Studio (or any operator client) in front of
it as the access point.

## Required OAP modules

All three SWIP-13 selectors default to disabled. The OAP operator
must opt in to the surfaces Studio uses:

| Env var                            | YAML selector           | Effect                                         |
| ---------------------------------- | ----------------------- | ---------------------------------------------- |
| `SW_ADMIN_SERVER=default`          | `admin-server.selector` | Stand up the shared HTTP server on `:17128`.   |
| `SW_RECEIVER_RUNTIME_RULE=default` | `receiver-runtime-rule` | Register `/runtime/rule/*` + `/runtime/oal/*`. |
| `SW_DSL_DEBUGGING=default`         | `dsl-debugging`         | Register `/dsl-debugging/*` (live debugger).   |

Without `admin-server`, OAP fails fast at boot with
`ModuleNotFoundException: admin-server`.
