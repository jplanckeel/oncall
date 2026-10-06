# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Grafana OnCall (OSS) entered maintenance mode on 2025-03-11 and was archived on 2026-03-24. The repo is still
buildable and testable, but upstream is no longer actively developed.

## Repository layout

Two independently deployed artifacts plus supporting infra:

- `engine/` — the OnCall backend: Django 4 + DRF + Celery (Python 3.12).
- `grafana-plugin/` — the Grafana app plugin: React/MobX frontend (`src/`) **and** a Go backend plugin
  (`pkg/`) that proxies/authenticates requests from Grafana to the engine.
- `helm/oncall` — Helm chart (has its own unit tests), `Tiltfile` + `dev/` — local k8s dev env,
  `tools/migrators` — importers from PagerDuty/Splunk OnCall (separate Python project with its own lint config
  and `requirements.txt`), `docs/sources` — published documentation.

## Commands

### Local environment

Two options. Tilt/k8s is the supported one; docker-compose is deprecated but the `make` targets still work.

```bash
make cluster/up && tilt up     # k8s + tilt (hot reload), Grafana at localhost:3000 (oncall/oncall)
ONCALL_PROFILES=grafana,plugin,backend tilt up   # subset of resources
make cluster/down

make init start                # docker-compose path (builds frontend, then starts containers)
make start / stop / restart / cleanup
```

Running the backend outside Docker (needed for a fast test/debug loop): `make backend-bootstrap` creates `./venv`
from `engine/requirements*.txt`, then `make backend-migrate`, `make run-backend-server`, `make run-backend-celery`.
Those targets source `dev/.env.dev` (auto-created from `dev/.env.dev.example`).

### Backend tests

Always run with `settings.ci_test`; `settings.dev` will make unrelated tests fail.

```bash
make test                      # all backend tests, in docker
make test-dev ARGS="--last-failed --pdb"
cd engine && pytest -x                          # outside docker (DJANGO_SETTINGS_MODULE=settings.ci_test)
cd engine && pytest apps/alerts/tests/test_alert_group.py::test_name
```

`engine/tox.ini` sets `--no-migrations` and `--dist no` (xdist disabled — it caused flakes). CI runs the whole
suite across MySQL+RabbitMQ, PostgreSQL+RabbitMQ and SQLite+Redis, each with `ONCALL_TESTING_RBAC_ENABLED`
both True and False — a change that touches permissions or DB-specific SQL should be checked under both.

### Other test suites

```bash
cd grafana-plugin && pnpm test          # jest; runs twice (TZ=UTC, then TZ=Europe/London for @london-tz tests)
cd grafana-plugin && go test ./pkg/...  # Go plugin backend
make test-e2e                           # Playwright, needs the env running; test-e2e-watch / test-e2e-show-report
make test-helm                          # helm unittest
```

### Lint / typecheck

```bash
make lint                               # pre-commit over the whole repo (isort, black, flake8, eslint, stylelint, markdownlint, yamllint)
make install-precommit-hook
cd engine && mypy .
cd grafana-plugin && pnpm lint && pnpm type-check
```

### Django management

```bash
make engine-manage CMD="makemigrations"        # in docker
make backend-manage-command CMD="migrate"      # outside docker (venv)
make shell / make dbshell / make exec-engine
make backend-debug-enable                      # DEBUG + django-silk profiling at /silk/
```

### Dependencies

Backend deps are pip-tools managed: edit `engine/requirements.in` (or `requirements-dev.in`), then
`make backend-compile-deps`. Never hand-edit `requirements.txt`.

## Backend architecture

### API surfaces

`engine/engine/urls.py` is the map. Four distinct surfaces with different auth and stability guarantees:

- `/integrations/v1/` (`apps.integrations`) — **alert ingestion**. Unauthenticated-by-token-in-URL endpoints,
  heavily rate limited, and the only routes that stay up during maintenance mode. Can be split into a separate
  deployment via `DETACHED_INTEGRATIONS_SERVER` (`engine/engine/integrations_urls.py`).
- `/api/internal/v1/` (`apps.api`) — the plugin UI's API. Not a stability contract; changes freely with the frontend.
- `/api/v1/` (`apps.public_api`) — the documented public API, also consumed by the Terraform provider. Breaking
  changes here are breaking changes for users.
- `/mobile_app/v1/`, `/api/internal/v1/plugin/` (`apps.grafana_plugin`: install/sync/status handshake with the
  Grafana plugin), plus per-chatops webhook routes (`/slack/`, `/telegram/`, `/twilioapp/`, …).

Large parts of the URL conf are conditional on `FEATURE_*` env vars and on `IS_OPEN_SOURCE`
(`ONCALL_LICENSE` = `OpenSource` vs `Cloud`) — `apps.oss_installation`, `apps.zvonok`, `apps.exotel` are
OSS-only. Adding a route usually means adding it under the right flag.

### Multi-tenancy and IDs

`apps.user_management.Organization` is the tenant, mapped 1:1 to a Grafana org/stack; `User` and `Team` are
synced from Grafana. Virtually every model hangs off an organization and every queryset must be scoped by it.

Models expose a `public_primary_key` (prefixed random string, e.g. `C…` for channels) instead of the numeric PK —
see `engine/common/public_primary_keys.py`. API URLs and serializers use `public_primary_key`; never leak `id`.

### Alert pipeline

This is the core flow and it spans several apps:

1. `apps.integrations.views` receives the payload; `AlertChannelDefiningMixin` resolves the URL token to an
   `AlertReceiveChannel` (cached).
2. `Alert.create()` (`apps/alerts/models/alert.py`) renders the integration's Jinja templates to compute grouping
   id / title / message, and attaches the alert to a new or existing `AlertGroup`.
3. A `ChannelFilter` (route) on the channel selects the `EscalationChain`.
4. On escalation start the chain's `EscalationPolicy` list is **frozen** into `AlertGroup.raw_escalation_snapshot`
   (JSON). See `apps/alerts/escalation_snapshot/` — running escalations execute against the snapshot, not the live
   chain, so editing a chain does not retroactively change in-flight escalations.
5. Celery tasks in `apps/alerts/tasks/` drive it: `escalate_alert_group`, `notify_user`, `notify_group`,
   `acknowledge_reminder`, `unsilence`, `resolve_by_last_step`, and `check_escalation_finished` (a watchdog).
6. Delivery goes through the chatops/notification apps: `apps.slack`, `apps.telegram`, `apps.mattermost`,
   `apps.twilioapp` / `apps.zvonok` / `apps.exotel` (`apps.phone_notifications` abstracts the provider),
   `apps.mobile_app`, `apps.email`, `apps.webhooks`.

`apps.schedules` (iCal-based on-call calendars, final schedule refresh tasks, shift swaps) feeds
the `STEP_NOTIFY_SCHEDULE` escalation step.

### Celery

Every task must have an explicit queue entry in `engine/settings/celery_task_routes.py`; a task missing from that
dict will not be routed correctly. Broker is RabbitMQ or Redis (`BROKER_TYPE`). Custom task base classes live in
`common/custom_celery_tasks/` (e.g. dedicated-queue and "don't retry on DB error" variants).

### Settings

`engine/settings/base.py` holds everything; `dev.py`, `ci_test.py`, `prod_without_db.py`, `hobby.py`, `helm.py`
layer on top. Nearly all configuration is env-var driven via the `getenv_*` helpers in `base.py`.

### Adding an integration

Per `engine/config_integrations/README.md`: add `config_integrations/<name>.py` (default templates + example
payload + expected rendering used as tests), register it in `INSTALLED_ONCALL_INTEGRATIONS` in
`settings/base.py`, and add `engine/apps/integrations/html/integration_<name>.html` for the "how to connect"
instructions. `grafana.py` is the reference implementation.

## Backend conventions

- **Jinja**: never `from jinja2 import Template` — flake8 bans it. Use `common.jinja_templater.apply_jinja_template`
  (sandboxed env, custom filters). `django.apps.apps` is likewise banned; import models directly.
- **Imports**: relative imports from parent packages are banned (`flake8-tidy-imports`). isort/black at line
  length 120; flake8 allows 180.
- **Migrations must be backwards compatible** — `django-migration-linter` runs in CI (`manage.py lintmigrations`),
  and CI hard-fails on any `migrations.RemoveField` in a PR. To drop a *nullable* field, use
  `python manage.py remove_field <app> <Model> <field>`, which emits two migrations that must ship in
  **two separate releases** (state removal first, DB removal later). Full procedure in `dev/README.md`.
  CI also runs `makemigrations --check`, so model changes need their migration committed.
- mypy runs with a large `disable_error_code` list and per-module `ignore_missing_imports` — it is a guardrail,
  not a strict gate; don't add `type: ignore` noise chasing errors that are globally disabled.

## Testing conventions (backend)

`engine/conftest.py` (~1200 lines) is the fixture hub. Tests compose `make_*` factory fixtures rather than
constructing models directly: `make_organization_and_user_with_plugin_token`, `make_alert_receive_channel`,
`make_alert_group`, `make_escalation_chain`, `make_user_auth_headers`, etc. Autouse fixtures isolate the cache and
stub out Slack/Telegram/phone providers and `Task.apply_async`, so Celery tasks do **not** run implicitly — call
them directly when a test needs their effect. Test files must match `tests.py`, `test_*.py`, or `*_tests.py`.

## Frontend architecture (`grafana-plugin/`)

- Grafana app plugin. `src/plugin/` + `module.ts` wire it into Grafana; `pkg/` is the Go backend plugin that
  handles the Grafana↔engine handshake, permissions, and proxying (`pkg/plugin/proxy.go`, `permissions.go`, `sync.go`).
- State is MobX: `src/state/rootStore.ts` composes per-domain stores under `src/models/<domain>/`. Follow
  `dev/frontend_guidelines.md` — it is the team's binding style guide. Highlights: never consume the return value
  of a MobX action (mutate observables, read them from components); prefer many small stores over prop-drilling;
  components never talk to the network directly; use the shared decorators/hooks (`@WithGlobalNotification`,
  `@AutoLoadingState`, `useIsLoading`, `useDrawer`, `useConfirmModal`); emotion via `useStyles2` with `getStyles`
  at the end of the file or in `X.styles.ts`; no implicit/explicit `any` or `@ts-ignore`.
- **Typed API client**: the engine exposes an OpenAPI schema at `/internal/schema/` (`DRF_SPECTACULAR_ENABLED`).
  Run `pnpm generate-types` from `grafana-plugin/` (engine must be running on :8080) to regenerate
  `src/network/oncall-api/autogenerated-api.types.d.ts`, then use `onCallApi().GET('/alertgroups/')` and
  `ApiSchemas['AlertGroup']`. For fields not yet in the schema, add them to
  `types-generator/custom-schemas.ts` and list the schema name in `CUSTOMIZED_SCHEMAS` in `generate-types.ts`.
  Migration to this client is partial — older code uses the axios-based `src/network/network.ts` and legacy types.
- Jest tests are split by timezone: tests tagged `@london-tz` in their name run under `TZ=Europe/London`, all
  others under `TZ=UTC`. `pnpm test` runs both passes.
