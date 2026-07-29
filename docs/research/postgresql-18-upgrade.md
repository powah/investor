# PostgreSQL 16 → 18 compatibility research

Research date: 2026-07-30

## Conclusion

The application has no identified code or dependency incompatibility with
PostgreSQL 18. Upgrading is reasonable and better matches a “latest stable”
policy, but changing only `image: postgres:16` to `image: postgres:18` would be
unsafe for two independent reasons:

1. PostgreSQL major versions cannot directly reuse each other's data
   directories. Existing data must be migrated with dump/restore,
   `pg_upgrade`, or logical replication.
2. The Docker Official Image changed its default `PGDATA` and volume mount
   layout in PostgreSQL 18. The Compose volume target must change as part of
   the upgrade.

For this small local database, a verified `pg_dump`/restore into a fresh
PostgreSQL 18 cluster is likely the simplest path. Preserve the PostgreSQL 16
volume until the PostgreSQL 18 database has been validated.

## Upgrade status

The upgrade was completed on 2026-07-30 using the recommended logical
dump/restore path:

- Compose now uses `postgres:18` with the 18+ mount target
  `/var/lib/postgresql`.
- The verified PostgreSQL 16 dump was restored transactionally into the fresh
  `postgres_data_v18` volume.
- Alembic, all 17 restored tables, the API health endpoint, the web endpoint,
  and the 105-test API suite passed validation.
- On the workstation where the upgrade was performed, the original
  `investor_postgres_data` volume and the git-ignored
  `.local-backups/postgresql-16-before-18-2026-07-30.dump` archive were retained
  for rollback.

## What the repository uses

- `docker-compose.yml` now uses the floating-major tag `postgres:18` and mounts
  the named volume `postgres_data_v18` at `/var/lib/postgresql`.
- The API uses SQLAlchemy 2.0.51, Alembic 1.16.5, and
  `psycopg[binary]` 3.3.4 (`apps/api/requirements.txt`).
- The ORM schema uses ordinary PostgreSQL-compatible scalar types, JSON,
  foreign keys, unique constraints, and indexes
  (`apps/api/app/models/*.py` and the baseline Alembic migration).
- The only direct PostgreSQL-specific application SQL found is
  `pg_advisory_xact_lock()` and `pg_try_advisory_xact_lock()` in
  `apps/api/app/services/automation.py`. Both functions remain documented in
  PostgreSQL 18's
  [advisory-lock function table](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
- No database extensions, generated columns, full-text indexes, partitioned
  tables, replication configuration, custom collations, C extensions, or
  direct system-catalog dependencies were found.

## Application and dependency compatibility

### SQLAlchemy and psycopg

SQLAlchemy 2.0.51 documents PostgreSQL 9.6 and newer as supported. Its
definition notes that most features should work, although not every database
version is necessarily exercised for every edge case:
[SQLAlchemy included-dialect support](https://docs.sqlalchemy.org/en/20/dialects/index.html#supported-versions-for-included-dialects).

Psycopg's current 3.3 documentation states that PostgreSQL 10 through 18 has
official, tested support, and currently supported PostgreSQL releases are
actively tested in CI:
[Psycopg supported systems](https://www.psycopg.org/psycopg3/docs/basic/install.html#supported-systems).
The repository's pinned psycopg 3.3.4 is the current published release listed
in the project's
[release notes](https://www.psycopg.org/psycopg3/docs/news.html#psycopg-3-3-4).

Nothing in the PostgreSQL 17 or 18 migration notes maps to a repository feature
that would require an application change:

- [PostgreSQL 17 migration notes](https://www.postgresql.org/docs/17/release-17.html#RELEASE-17-MIGRATION)
- [PostgreSQL 18 migration notes](https://www.postgresql.org/docs/18/release-18.html#RELEASE-18-MIGRATION)

In particular, the repository does not use the affected maintenance-function
search paths, interval text syntax, removed server settings/system-catalog
columns, unlogged partitioned tables, full-text/`pg_trgm` indexes, generated
columns, triggers, or database `COPY` handling.

### Local PostgreSQL 18 validation

On 2026-07-30, the current API image was connected to a disposable
`postgres:18` container (PostgreSQL 18.4) on the Compose network. Running
`alembic upgrade head` succeeded, created all 17 expected public tables, and
recorded revision `3a7a2c3f0c0c`. The disposable database used tmpfs and was
removed after the check; the live PostgreSQL 16 container and volume were not
changed.

This validates driver connectivity and a fresh schema migration. It does not
replace a permanent PostgreSQL integration test:

- `apps/api/tests/test_migrations.py` runs migrations against SQLite.
- Most service tests also use SQLite.
- The PostgreSQL advisory-lock branch is explicitly bypassed for non-PostgreSQL
  dialects.

Before adopting PostgreSQL 18, the project should run at least one disposable
PostgreSQL 18 smoke test that:

1. creates a fresh cluster;
2. runs `alembic upgrade head`;
3. starts the API and worker;
4. exercises the automation execution gate concurrently; and
5. verifies a dump/restore of representative PostgreSQL 16 data.

## Operational compatibility issues

### 1. The existing data directory cannot be reused

PostgreSQL treats 16 → 18 as a major-version upgrade. Major versions can change
the internal storage format, so the old data directory cannot simply be
started by the new server. PostgreSQL supports skipping intervening major
versions, but says to read all intervening release notes. Supported migration
methods are dump/restore, `pg_upgrade`, and logical replication:
[PostgreSQL versioning and upgrade policy](https://www.postgresql.org/support/versioning/)
and
[PostgreSQL 18 cluster upgrade guide](https://www.postgresql.org/docs/18/upgrading.html).

PostgreSQL 18 also enables data checksums by default for newly initialized
clusters. Its migration notes state that `pg_upgrade` requires the old and new
clusters to have matching checksum settings; `--no-data-checksums` is available
when initializing the new cluster if the old PostgreSQL 16 cluster has
checksums disabled:
[PostgreSQL 18 migration notes](https://www.postgresql.org/docs/18/release-18.html#RELEASE-18-MIGRATION).
This matters only to the `pg_upgrade` route; logical dump/restore creates a new
cluster normally.

### 2. PostgreSQL 18 changed the Docker data-volume layout

The current Compose mount is correct for PostgreSQL 16, but not for PostgreSQL
18. In the Docker Official Image:

- PostgreSQL 17 and below use `/var/lib/postgresql/data`.
- PostgreSQL 18 uses version-specific
  `PGDATA=/var/lib/postgresql/18/docker`.
- The declared image volume and recommended mount target for 18+ is
  `/var/lib/postgresql`.

The upstream image documentation explicitly says mounts for PostgreSQL 18+
should target the new parent path:
[Docker Official PostgreSQL image — `PGDATA`](https://hub.docker.com/_/postgres/#pgdata).

Therefore, an eventual Compose change needs both the PostgreSQL major tag and
the mount target changed. The old named volume's on-disk layout must be
migrated deliberately; pointing PostgreSQL 18 at the old PostgreSQL 16 files is
not a migration.

### 3. Authentication does not appear to block the upgrade

PostgreSQL 18 deprecates MD5 password authentication, but does not remove it.
The Docker Official Image defaults to `scram-sha-256` for host authentication
on PostgreSQL 14 and newer when `POSTGRES_HOST_AUTH_METHOD` is not set:
[Docker Official PostgreSQL image — authentication](https://hub.docker.com/_/postgres/#postgres-host-auth-method).
This repository does not override that variable, so a freshly initialized
PostgreSQL 18 cluster should already use the preferred mechanism.

## Why PostgreSQL 16 was chosen

No repository rationale was found.

`git blame docker-compose.yml` attributes `image: postgres:16` to the initial
`local MVP` commit, `2ce3f64f40e32b304e321972799696df7104f217`, dated
2026-06-24. The commit message and repository documentation do not explain the
choice. PostgreSQL 18 had already been generally available since 2025-09-25,
so 16 was not the latest stable major when it was added:
[PostgreSQL 18 release announcement](https://www.postgresql.org/about/news/postgresql-18-released-3142/).

PostgreSQL 16 is nevertheless a defensible supported baseline rather than an
obsolete or insecure selection. PostgreSQL supports each major for five years;
as of this research, 16.14 is supported until 2028-11-09, while 18.4 is
supported until 2030-11-14:
[PostgreSQL versioning policy and support table](https://www.postgresql.org/support/versioning/).
The floating-major tag `postgres:16` also follows current 16.x minor releases
when the image is pulled; it does not freeze the service at PostgreSQL 16.0.
The official image currently maps `16` to 16.14 and `18`/`latest` to 18.4:
[Docker Official PostgreSQL image tags](https://hub.docker.com/_/postgres/).

Thus the evidence supports only these conclusions:

- Pinning a database **major** while receiving its compatible minor updates is
  a sensible stability policy.
- There is no recorded technical reason this project specifically needs major
  16.
- Selecting 16 in June 2026 was inconsistent with a strict “latest stable
  major” policy and most likely reflects a conservative or stale initial
  scaffold choice; that last explanation is an inference, not documented
  project intent.

## PostgreSQL 19

As of 2026-07-30, PostgreSQL 19 Beta 2 is a preview, not the latest stable
release. The PostgreSQL project says details may still change, does not advise
running beta versions in production, and expects final release around
September/October 2026:
[PostgreSQL 19 Beta 2 announcement](https://www.postgresql.org/about/news/postgresql-19-beta-2-released-3350/).

For a “latest stable” policy, use PostgreSQL 18 now. PostgreSQL 19 can be added
to a non-production compatibility job, but should not replace the primary
database tag until general availability and dependency/application validation.

## Recommended decision

Upgrade the development stack to the current PostgreSQL 18 major rather than
waiting on PostgreSQL 19 beta, with these safeguards:

1. Add a PostgreSQL-backed migration/application smoke test.
2. Back up the PostgreSQL 16 database and retain the old volume.
3. Create a fresh PostgreSQL 18 cluster using the 18+ Docker volume layout.
4. Restore the logical dump, run Alembic, and exercise the PostgreSQL-specific
   concurrency path.
5. Validate row counts and important trading/automation state before removing
   the PostgreSQL 16 volume.

If reproducibility is more important than automatically receiving patch
releases, pin an exact image or digest and update it deliberately. If the
project's policy is “latest compatible patch within the selected stable
major,” a floating-major tag such as `postgres:18` matches the existing
approach.
