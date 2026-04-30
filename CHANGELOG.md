<!--
Copyright 2026 The Vantage Studio Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
-->

# Changelog

All notable changes to Vantage Studio will be tracked here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- _(your change here)_

## [0.1.0] — 2026-04-30

First release. Wires every locked-in design surface to the upstream
runtime-rule receiver (`apache/skywalking#feature/runtime-rule-hot-update`,
squashed tip `9eeb0a8f66`).

### Added

- **Catalog browse** for `otel-rules`, `log-mal-rules`, `lal` —
  grouped cards over `/api/catalog/list` with override / modified /
  bundled-only / SUSPENDED badges. No second API call needed for
  any badge.
- **Editor** — Monaco YAML with bundled MAL/LAL DSL grammar
  autocomplete, edit / diff-vs-server / diff-vs-bundled tabs,
  save / inactivate / delete / revert-to-bundled action set,
  recovery via `force=true` under the "advanced" disclosure.
- **Destructive-confirm gate** — typed-name confirm reused for
  `allowStorageChange` saves and `revertToBundled` deletes.
- **Cluster status** — per-rule × per-node matrix from the BFF's
  fan-out of `/runtime/rule/list` across every configured admin
  URL, refetched every 5 s.
- **Dump** — streaming `tar.gz` download per catalog or for the
  whole runtime ruleset.
- **DSL Management** — operator-facing reference page; explains
  where every schema-change action lives in v1 + renders the
  current session's verb table.
- **Auth** — local-config users with argon2id hashes, in-memory
  sessions, opt-in RBAC, JSONL audit log.
- **Distroless Docker image** — multi-stage build (~30 MB on top of
  the distroless base + a 28 MB pnpm-deploy node_modules tree
  carrying argon2 + pino externals).
- **Demo compose stack** — `studio + oap + banyandb`. OAP admin port
  stays on the cluster network; only Studio publishes to the host.

### Notable defaults

- RBAC is off by default — every authenticated user has the wildcard
  `*` verb. Turn it on via `rbac.enabled: true` + a roles map.
- Default `/delete` is **non-destructive** in OAP since the upstream
  cleanup pass (`9eeb0a8f66`); the schema-change destructive path
  lives only on `?mode=revertToBundled`.
- Sessions are in-memory, single-replica; lost on restart by design.
- Audit log rotation is external — point a `logrotate` config or a
  sidecar shipper at `audit.file`.

### Known deferrals

Live debugger (MAL + LAL), pre-flight validate, DSL schema
autocomplete from server, history · diff · rollback, restore,
OAL surfaces, OIDC, LDAP, Helm chart, `vsctl` CLI. See
[`docs/compatibility.md`](docs/compatibility.md) for the full
list and the upstream APIs each one depends on.

[Unreleased]: https://github.com/wu-sheng/vantage-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wu-sheng/vantage-studio/releases/tag/v0.1.0
