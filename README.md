# Vantage Studio

A web admin for Apache SkyWalking's runtime-rule hot-update system —
browse, edit, and push MAL / LAL rules without restarting the OAP
cluster.

[![CI](https://github.com/wu-sheng/vantage-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/wu-sheng/vantage-studio/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

## What it is

Vantage Studio is an **extension** of Apache SkyWalking, not a fork.
It runs as a separate process (Docker image) and talks to the OAP
server's runtime-rule admin HTTP port (default `17128`) plus the
upstream status APIs on the query port (`12800`). It adds the things
SkyWalking's runtime-rule receiver intentionally doesn't ship:

- A login + RBAC layer in front of an admin port that has none today.
- A pixel-careful UI for browsing rule catalogs (`otel-rules`,
  `log-mal-rules`, `lal`), editing YAML with Monaco + bundled MAL/LAL
  DSL grammar autocomplete, and pushing via `addOrUpdate` /
  `inactivate` / `delete`.
- Cluster status across every OAP node, dump (`tar.gz`) of the live
  ruleset, and the destructive-confirm gate for `allowStorageChange`
  and `revertToBundled`.

## Quick start

```bash
git clone https://github.com/wu-sheng/vantage-studio
cd vantage-studio
make compose-up
```

Visit <http://localhost:8080>; login `admin` / `vantage-changeme`.

> Replace the default password by editing the `studio.yaml` that
> lives in the `studio-data` volume. See [`docs/install.md`](docs/install.md)
> for the OAP image pin you'll need until the upstream
> `feature/runtime-rule-hot-update` branch lands in a tagged release.

## Documentation

- [`docs/install.md`](docs/install.md) — Docker, compose, production
  install hints.
- [`docs/configure.md`](docs/configure.md) — every `studio.yaml` knob.
- [`docs/auth.md`](docs/auth.md) — users, optional RBAC, audit log.
- [`docs/operator-workflows.md`](docs/operator-workflows.md) — push
  a rule, recover from a broken push, inspect cluster, take a dump.
- [`docs/compatibility.md`](docs/compatibility.md) — OAP version pin
  and the deferred-features list.
- [`CHANGELOG.md`](CHANGELOG.md) — release notes.

## Repository layout

```
vantage-studio/
├── apps/
│   ├── ui/                 # Vue 3 + Vite SPA
│   └── bff/                # Fastify TypeScript BFF
├── packages/
│   ├── api-client/         # typed wrappers for the OAP runtime-rule REST surface
│   └── design-tokens/      # rrDark + RR_FONT_* + spacing scale
├── deploy/
│   └── docker/             # Dockerfile + docker-compose.yml + studio.yaml.example
├── docs/                   # operator documentation
├── scripts/                # license-header check
├── Makefile                # make compose-up / make image / make check
└── .github/workflows/      # ci.yml + release.yml
```

## Releases

Tagged releases publish a signed image to GHCR with a CycloneDX SBOM
attestation. Verify a pulled image:

```bash
cosign verify ghcr.io/wu-sheng/vantage-studio:0.1.0 \
  --certificate-identity-regexp 'https://github.com/wu-sheng/vantage-studio/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Apache, Apache SkyWalking, and SkyWalking are trademarks of The
Apache Software Foundation. Vantage Studio is an independent
extension and is not endorsed by the ASF.
