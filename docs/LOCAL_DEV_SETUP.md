# Local development setup

**Superseded by [`HANDOVER.md`](HANDOVER.md).**

This file used to be the first-time setup guide.
It has been replaced rather than extended, because parts of it had gone wrong in ways that cost real time:

- It described `/ops/*` as having its own auth system with "nothing to do with Supabase". That is no longer true - the two were collapsed onto a single Supabase front door.
- Its migrate command did not work as written; it passed only the database URL, and the entrypoint also requires both secrets.
- It told you to create `control-service/.env.local`, which nothing in that service reads.
- It omitted `pnpm seed-ops-depots`, which is required before any depot-role account works.

[`HANDOVER.md`](HANDOVER.md) is the single, executed setup and operations guide: prerequisites, both databases, every environment variable, migrations, seeding the route network and its timing trap, accounts, running both services, what the consoles are for, the honest-data vocabulary, the command path, the verification baselines, and the known open issues.

This stub remains so existing links keep resolving.
Do not add setup instructions here; they will drift.
