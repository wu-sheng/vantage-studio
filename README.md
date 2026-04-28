# Vantage Studio

A web admin for Apache SkyWalking's runtime-rule hot-update system —
browse, edit, and push MAL / LAL rules without restarting the OAP cluster.

> Status: project bootstrap. v1 focuses on management for MAL and LAL —
> catalog browse, YAML editor, push / inactivate / delete, cluster status,
> and dump. The live debugger, history · rollback, restore, and OAL
> surfaces are deferred to later releases (they depend on backend APIs
> that aren't shipped yet).

## What it is

Vantage Studio is an **extension** of Apache SkyWalking, not a fork. It
runs as a separate process (Docker image) and talks to the OAP server's
runtime-rule admin HTTP port (default `17128`) plus the upstream status
APIs on the query port (`12800`). It adds the things SkyWalking's
runtime-rule receiver intentionally doesn't ship:

- A login + RBAC layer in front of an admin port that has none today.
- A UI for browsing rule catalogs (`otel-rules`, `log-mal-rules`,
  `lal`), editing YAML, and pushing via `addOrUpdate` / `inactivate` /
  `delete`.
- Cluster status across every OAP node, dump (tar.gz) of the live
  ruleset, and the destructive-confirm gate for `allowStorageChange`.

## Repository layout

To be added once the scaffold lands.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Apache, Apache SkyWalking, and SkyWalking are trademarks of The Apache
Software Foundation. Vantage Studio is an independent extension and is not
endorsed by the ASF.
