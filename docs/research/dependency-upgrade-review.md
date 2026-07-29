# Dependency upgrade review (excluding PostgreSQL)

Research date: 2026-07-30

Implementation status: the recommended upgrade batches were applied on
2026-07-30. The inventory below describes the repository before those changes.

## Conclusion

The stack is generally current, but one frontend patch batch should be treated
as urgent because it closes known vulnerabilities. The backend has a
straightforward low-risk refresh available. The major upgrades to ESLint 10 and
TypeScript 7 should wait for the Next.js lint stack to catch up.

Recommended order:

1. **Upgrade the production frontend now:** Next.js 16.2.12, React/React DOM
   19.2.8, Tailwind packages 4.3.3, PostCSS 8.5.25, Autoprefixer 10.5.4, and
   Sharp 0.35.3 via an override. Keep Next.js and `eslint-config-next` on the
   same version.
2. **Refresh the backend:** FastAPI 0.141.1, Uvicorn 0.52.0, Alembic 1.18.5,
   httpx2 2.9.1, websockets 17.0, and pip 26.2.
3. **Move the web image from Node 22 to Node 24 LTS** and align
   `@types/node` to the Node 24 line.
4. **Defer ESLint 10 and TypeScript 7** until `eslint-config-next`'s plugins
   support them without peer conflicts.
5. **Do not spend upgrade effort on Redis yet.** There is no Redis client or
   Redis usage in application code; remove the service if it is not part of the
   near-term plan, or upgrade it separately when a real use case lands.

PostgreSQL, its image/volume migration, and psycopg-specific upgrade work are
outside this review.

## What the repository pins

- `apps/web/package.json` exactly pins five frontend runtime packages and ten
  development packages. `package-lock.json` fully locks the npm graph.
- `apps/api/requirements.txt` exactly pins eleven direct Python packages, but
  there is no Python lockfile or hash-pinned transitive graph. Runtime and test
  tooling are mixed in the same file.
- The API uses CPython 3.14.6 in `.python-version` and
  `python:3.14.6-slim` in its Dockerfile. That is the current stable Python
  3.14 patch and current official image tag
  ([Python 3.14.6 release](https://www.python.org/downloads/release/python-3146/),
  [official image tags](https://hub.docker.com/_/python/)).
- The web Dockerfile uses `node:22-alpine`; Compose uses `redis:7`. Both are
  mutable major-line tags.

No other application dependency manifests, CI dependency pins, or
Dependabot/Renovate configuration were found. `skills-lock.json` describes
Codex agent skills, not the application stack, and is not included below.

## Immediate frontend security update

The current lock graph is not clean:

- `npm audit --omit=dev` reports two high-severity vulnerable production
  packages: direct Next.js and transitive Sharp.
- The full audit also reports development-tool findings through PostCSS,
  ESLint, minimatch, brace-expansion, and js-yaml.

### Next.js

Next.js 16.2.9 is below the patched range from Vercel's July 2026 security
release. Vercel says to upgrade the active LTS line to at least 16.2.11 to
address four high- and five medium-severity vulnerabilities
([Vercel security release](https://nextjs.org/blog/july-2026-security-release)).
The current registry release is 16.2.12
([npm registry](https://registry.npmjs.org/next/latest)), so use 16.2.12 for
both `next` and `eslint-config-next`.

This repository has an external rewrite, but its destination hostname comes
from the server-side `API_INTERNAL_BASE_URL`, not a request-controlled route
segment. That reduces exposure to the published rewrite SSRF scenario, but it
does not justify keeping a framework version with several other patched
vulnerabilities.

### PostCSS and Tailwind

The explicit `postcss` pin and override are 8.5.15. Versions through 8.5.17
are affected by a high-severity previous-source-map path traversal; 8.5.18 is
the first patched version
([PostCSS advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849)).
The current registry release is 8.5.25
([npm registry](https://registry.npmjs.org/postcss/latest)).

Upgrade the direct pin and override together. Also update Tailwind and
`@tailwindcss/postcss` from 4.3.1 to 4.3.3 and Autoprefixer from 10.5.1 to
10.5.4 so the CSS toolchain is resolved as one tested unit
([Tailwind](https://registry.npmjs.org/tailwindcss/latest),
[`@tailwindcss/postcss`](https://registry.npmjs.org/@tailwindcss%2fpostcss/latest),
[Autoprefixer](https://registry.npmjs.org/autoprefixer/latest)).

### Sharp

The lock currently resolves Sharp 0.34.5 through Next.js. Sharp versions below
0.35.0 include vulnerable libvips components; the maintainer recommends the
latest 0.35.x, currently 0.35.3
([Sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
[npm registry](https://registry.npmjs.org/sharp/latest)).

Next.js 16.2.12 still declares `sharp: ^0.34.5`
([published package metadata](https://registry.npmjs.org/next/16.2.12)), so
updating Next alone does not lift Sharp across the 0.35 boundary. Add an npm
override for `sharp: 0.35.3` and keep it until Next.js widens its declared
range. This is outside Next's declared semver range, so retain the build smoke
test. The repository does not import `next/image`, which lowers current runtime
exposure, but the vulnerable native library is still present in the production
dependency graph without the override.

### Validated patch set

In a disposable copy, the following set passed `npm run typecheck`,
`npm run lint`, and `npm run build`:

| Package | Current | Validated target |
| --- | ---: | ---: |
| `next`, `eslint-config-next` | 16.2.9 | 16.2.12 |
| `react`, `react-dom` | 19.2.7 | 19.2.8 |
| `lucide-react` | 1.21.0 | 1.27.0 |
| `@tailwindcss/postcss`, `tailwindcss` | 4.3.1 | 4.3.3 |
| `postcss` direct pin and override | 8.5.15 | 8.5.25 |
| `autoprefixer` | 10.5.1 | 10.5.4 |
| `eslint` | 9.39.4 | 9.39.5 |
| `sharp` override | none (0.34.5 transitive) | 0.35.3 |

The resulting `npm audit --omit=dev` reported zero vulnerabilities. This
validation did not modify the repository manifest or lockfile.

`lightweight-charts` 5.2.0, `@types/react` 19.2.17, and
`@types/react-dom` 19.2.3 are already current
([Lightweight Charts](https://registry.npmjs.org/lightweight-charts/latest),
[`@types/react`](https://registry.npmjs.org/@types%2freact/latest),
[`@types/react-dom`](https://registry.npmjs.org/@types%2freact-dom/latest)).

## Frontend majors to defer

### ESLint 10

ESLint 10.8.0 is current, while the repository uses 9.39.4
([npm registry](https://registry.npmjs.org/eslint/latest)). ESLint 10 drops
older Node versions, changes config lookup, removes the old config format, and
changes several lint rules and APIs
([official migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0)).
The repository already uses flat config and a compatible Node version, but the
plugins pulled by `eslint-config-next` 16.2.12 still declare peer support only
through ESLint 9. A disposable ESLint 10 install produced peer conflicts for
`eslint-plugin-import`, `eslint-plugin-jsx-a11y`, and
`eslint-plugin-react`.

Stay on the current ESLint 9 line (9.39.5) until Vercel publishes a compatible
lint stack. The remaining audit findings are in development-only glob/lint
dependencies. Do not use `npm audit fix --force`: its suggested dependency
downgrades do not form a sensible Next.js 16 toolchain.

### TypeScript 7

TypeScript 7.0.2 is a stable native Go port and can be about ten times faster,
but it intentionally ships without the old programmatic compiler API. The
TypeScript team specifically recommends keeping a TypeScript 6 compatibility
package for tools such as `typescript-eslint`
([official TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).

This project gets `typescript-eslint` through `eslint-config-next`. A
disposable TypeScript 7 + ESLint 10 attempt produced peer conflicts and lint
failed because the current lint stack does not support TypeScript 7. Keep
TypeScript 6.0.3 for now. Revisit TypeScript 7 when the Next lint stack supports
it, or evaluate the official side-by-side TypeScript 6 compatibility setup as
a separate change.

## Backend refresh

The following current releases are available from PyPI:

| Package | Current | Target | Assessment |
| --- | ---: | ---: | --- |
| [FastAPI](https://pypi.org/project/fastapi/) | 0.139.0 | 0.141.1 | Upgrade; primarily dependency-memory refactors and fixes since 0.139. |
| [Uvicorn](https://pypi.org/project/uvicorn/) | 0.51.0 | 0.52.0 | Upgrade; small release, existing CLI use is unaffected. |
| [SQLAlchemy](https://pypi.org/project/SQLAlchemy/) | 2.0.51 | 2.0.51 | Current. |
| [Alembic](https://pypi.org/project/alembic/) | 1.16.5 | 1.18.5 | Upgrade; Python 3.14 and SQLAlchemy 2.0 satisfy its requirements. |
| [pydantic-settings](https://pypi.org/project/pydantic-settings/) | 2.14.2 | 2.14.2 | Current. |
| [python-multipart](https://pypi.org/project/python-multipart/) | 0.0.32 | 0.0.32 | Current. |
| [httpx](https://pypi.org/project/httpx/) | 0.28.1 | 0.28.1 | Current. |
| [httpx2](https://pypi.org/project/httpx2/) | 2.5.0 | 2.9.1 | Upgrade; no application imports, but keeping the latest version avoids a current Starlette test-client deprecation. |
| [pytest](https://pypi.org/project/pytest/) | 9.1.1 | 9.1.1 | Current. |
| [websockets](https://pypi.org/project/websockets/) | 16.1 | 17.0 | Upgrade after stream tests; the application's modern asyncio import remains available. |
| [pip](https://pypi.org/project/pip/) | 26.1.2 | 26.2 | Upgrade in the API image. |

FastAPI's release notes show 0.140 as dependency-memory/performance refactoring
and 0.141 as a new optional frontend-development helper, neither of which
changes the APIs used here
([FastAPI release notes](https://fastapi.tiangolo.com/release-notes/)).
Uvicorn 0.52 adds an experimental HTTP implementation but does not make it the
repository's default
([Uvicorn release notes](https://uvicorn.dev/release-notes/)).

Alembic 1.17 raises the minimum Python version to 3.10 and 1.18 adds a plugin
system plus batched reflection. The project runs Python 3.14 and uses ordinary
Alembic public APIs, so no migration-script change was identified
([Alembic changelog](https://alembic.sqlalchemy.org/en/latest/changelog.html)).

websockets 17 requires Python 3.11 and removes aliases deprecated since 9.0.
It also makes a few unrelated arguments keyword-only. The repository uses
`websockets.asyncio.client.connect`, which is the modern public path, and
Python 3.14 satisfies the new floor
([websockets 17 changelog](https://websockets.readthedocs.io/en/stable/project/changelog.html#id1)).

httpx2 2.9.1 contains additive WebSocket/SSE work and fixes since 2.5.0. The
notable behavioral change is that 2.3 switched default TLS verification from
certifi to the operating-system trust store
([httpx2 changelog](https://github.com/pydantic/httpx2/blob/main/src/httpx2/CHANGELOG.md)).
The application imports `httpx`, not `httpx2`; the long-term reason for carrying
both packages should be documented or simplified once Starlette's transition
is settled.

A disposable Python 3.14 environment with the proposed backend versions
introduced no test regression: all 105 tests passed.

## Runtime images and services

### Node.js

Node 22 remains supported, but it is in Maintenance LTS. Node 24 is the current
Active LTS line through October 2026 and is supported until April 2028
([Node.js release schedule](https://github.com/nodejs/Release#release-schedule)).
Next.js 16.2 requires Node 20.9 or newer, so Node 24 is within its supported
engine range
([published Next.js metadata](https://registry.npmjs.org/next/16.2.12)).

Move all three web Docker stages together from `node:22-alpine` to
`node:24-alpine` (currently Node 24.18.0 in the official image)
([official image tags](https://hub.docker.com/_/node/)). Then replace the
current Node 26 type definitions with the latest Node 24 type line
(`@types/node` 24.13.3 as of this review). Matching types to the runtime prevents
TypeScript from accepting APIs that do not exist in production.

Node 26 is Current, not LTS, and is not the right default for this application
yet.

### Redis

The `redis:7` tag currently tracks Redis 7.4.10, while Redis 8.8 is the latest
GA feature line
([Redis 8.8 release notes](https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.8-release-notes/)).
Redis documents a supported 7.x-to-8 upgrade path
([official upgrade guide](https://redis.io/docs/latest/operate/oss_and_stack/install/upgrade/)).

However, the repository has no Redis client dependency, import, or command use.
It only has a dormant `redis_url` setting plus the Compose service and
dependency ordering. Upgrading an unused service adds validation and licensing
work without product value. Redis 8 is offered under a choice of RSALv2,
SSPLv1, or AGPLv3
([upstream license statement](https://github.com/redis/redis)).

Recommendation: remove Redis from Compose if it is not needed soon. Otherwise,
keep 7 for now and upgrade to 8.8 only alongside the first implemented cache or
queue use case, when persistence, client protocol, and license choices can be
tested deliberately.

## Dependency-management gaps

These are more important than chasing every one-day-old patch:

1. **Lock Python transitives.** Exact direct requirements do not make builds
   reproducible. Generate a reviewed lock with hashes and separate runtime from
   test dependencies.
2. **Declare Node/npm expectations.** Add `engines` and `packageManager` (or an
   equivalent checked-in runtime-version file) so host development matches the
   Docker build.
3. **Choose an image update policy.** `node:24-alpine`, `redis:7`, and even
   `python:3.14.6-slim` can change underneath a build. Pin the distribution
   variant and, where reproducibility matters, a digest; update it
   deliberately for security patches.
4. **Automate update visibility.** Add Dependabot or Renovate after the first
   manual batch. Keep framework/runtime majors as separate pull requests from
   routine patch updates.

## Suggested batches

1. **Security batch:** Next.js/React, PostCSS/Tailwind/Autoprefixer, Sharp
   override, lockfile regeneration, typecheck, lint, build, and both full and
   production-only npm audits.
2. **Backend batch:** the six Python package updates plus pip; run the API
   suite and an API/worker smoke test.
3. **Runtime batch:** Node 24 image and Node 24 types; rebuild the standalone
   image and run it under Compose.
4. **Tooling follow-up:** ESLint 10 and TypeScript 7 only after the peer graph
   is clean.
5. **Redis decision:** remove the unused service or create a separately scoped
   Redis 8 adoption task when the application actually consumes it.
