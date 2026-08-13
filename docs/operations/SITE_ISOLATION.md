# Site Isolation Runbook

BRASH Fleet Control runs one Fleet Core instance per factory site. Every
instance has two matching isolation boundaries:

1. `FLEET_SITE_ID` is the canonical API and authorization scope, for example
   `plant-a`.
2. `DATABASE_SCHEMA` is the PostgreSQL namespace for that site, for example
   `brash_plant_a`.

Every authenticated request must include `X-Fleet-Site`. Requests without the
header fail with `SITE_ID_REQUIRED`; requests for a different instance fail
with `SITE_NOT_SERVED`. The authenticated identity must also list the site in
its `siteIds` claim (or use the administrator wildcard).

PostgreSQL connections set `search_path` to the configured schema followed by
`public`. Startup creates the validated schema if it does not exist, then runs
the complete migration chain inside it. Consequently robots, missions,
workflows, audit records, outboxes, and traffic reservations from two sites
cannot be returned by each other's repositories even when both schemas share a
database server.

Each schema also contains a singleton `fleet_site_binding`. Startup and the
migration command fail closed if the schema was previously bound to a different
`FLEET_SITE_ID`, preventing two site deployments from accidentally sharing a
namespace.

## Provision another site

Use a different process/deployment and schema for each site:

```bash
export FLEET_SITE_ID=plant-b
export DATABASE_SCHEMA=brash_plant_b
export DATABASE_URL=postgresql://brash:brash@127.0.0.1:5432/brash_fleet
npm run db:migrate
npm run dev:core:postgres
```

Do not point two different `FLEET_SITE_ID` values at the same
`DATABASE_SCHEMA`. Production database roles should additionally be granted
access only to their own schema; the application boundary is defense in depth,
not a replacement for PostgreSQL grants.

## Verification

Before go-live, authenticate as a site-scoped identity and verify all three:

- the correct site header succeeds;
- a missing header returns HTTP 400;
- another site header returns HTTP 404 and creates no entity.

The PostgreSQL integration suite also migrates two fixed schemas, writes a map
into only one, and proves that the other repository cannot read it.
