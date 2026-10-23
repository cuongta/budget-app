# Database migrations

The Rust backend owns the SQLite database. The frontend never runs SQL; it only
calls Tauri commands (`import_csv`, `get_transactions`, `delete_transaction`).

## Where things live

| What | Where |
|---|---|
| Migration files | `src-tauri/migrations/` |
| Opening the database and running migrations | `db::open` in `src-tauri/src/db.rs` |
| Database file (macOS) | `~/Library/Application Support/com.cuongta.budget-app/budget.db` |

## How migrations run

At startup, `run()` in `src-tauri/src/lib.rs` calls `db::open`, which:

1. opens `budget.db`, creating it if it doesn't exist
2. runs `sqlx::migrate!("./migrations")` against it

`sqlx` records each applied migration in a `_sqlx_migrations` table, so every
migration runs exactly once, in version order.

## Adding a migration

Create a new file in `src-tauri/migrations/`, numbered after the last one:

```
src-tauri/migrations/
  001_init.sql
  002_something_new.sql   <- new
```

- The number before the first `_` is the version. Never reuse or renumber one.
- Don't edit a migration that has already run. `sqlx` stores a checksum of each
  applied file and refuses to start if it changed. Add a new migration instead.

Then restart the app (`make dev`). The new migration runs on the next startup.

## Why `build.rs` watches `migrations/`

`src-tauri/build.rs` contains:

```rust
println!("cargo:rerun-if-changed=migrations");
```

**The problem it solves.** `sqlx::migrate!` is a macro, so it runs at compile
time: it reads the `.sql` files and embeds their contents in the binary. The
app doesn't need the files at runtime. But Cargo doesn't know the macro read
them. Cargo decides whether to rebuild by looking at `.rs` files and
dependencies, so adding `002_*.sql` alone may not trigger a rebuild. The app
would then start with the old set of migrations, and nothing would say why.

**What the line does.** `build.rs` is a build script: Cargo compiles and runs
it before compiling the crate, and the script talks back to Cargo by printing
`cargo:` lines. `cargo:rerun-if-changed=migrations` tells Cargo to rerun the
script, and rebuild the crate, whenever anything in `migrations/` changes.

**Why it has to be explicit.** If a build script prints no `rerun-if-changed`
lines, Cargo reruns it when *any* file in the package changes, which would cover
`migrations/`. But `tauri_build::build()` already prints its own
`rerun-if-changed` lines for Tauri's config files. Once any such line exists,
Cargo watches *only* the listed paths, so `migrations/` must be added to the
list.

The [`sqlx` documentation for `migrate!`](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)
recommends this same line.

## Testing

`db.rs` has tests that run against an in-memory database with the real
migrations applied:

```sh
make test
```

The test pool uses a single connection on purpose: each connection to
`sqlite::memory:` gets its own empty database, so a multi-connection pool would
see tables disappear between queries.
