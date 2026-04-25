# Vantage Studio

A web admin + CLI for Apache SkyWalking's runtime-rule hot-update system —
browse, edit, push, and live-debug MAL / LAL / OAL rules without restarting
the OAP cluster.

> Status: project bootstrap. The design (HTML/CSS/JS prototype) lives in
> `docs/design/` and the required backend API contract — covering both the
> APIs that already exist in the upstream feature branch and the ones that
> still need to be implemented — lives in [`docs/api/required-api.md`](docs/api/required-api.md).

## What it is

Vantage Studio is an **extension** of Apache SkyWalking, not a fork. It runs
as a separate process (Docker image) and talks to OAP's runtime-rule admin
HTTP port (default `17128`) plus the upstream status APIs on the query port
(`12800`). It adds the things SkyWalking's runtime-rule receiver intentionally
doesn't ship:

- A login + RBAC layer in front of an admin port that has none today.
- A pixel-careful UI for browsing rule catalogs (`otel-rules`,
  `log-mal-rules`, `lal`, `oal`), editing YAML with DSL assistance, and
  pushing via `addOrUpdate` / `fix` / `inactivate` / `delete`.
- A live debugger that visualises per-stage `SampleFamily` / log-record /
  source-row capture from the real push path — never a simulation.
- Cluster status, history · diff · rollback, dump & restore, and the
  destructive-confirm gate for `allowStorageChange`.

## Repository layout (planned)

See the proposal in chat. This README will be expanded once the scaffold lands.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Apache, Apache SkyWalking, and SkyWalking are trademarks of The Apache
Software Foundation. Vantage Studio is an independent extension and is not
endorsed by the ASF.
