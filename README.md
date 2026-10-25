# Budget App

A desktop budget app built with Tauri, Rust and React. Import your bank's CSV
exports, categorize merchants, and see your spending month by month. Your data stays
on your machine in a local SQLite database.

Currently supports Bank of America CSV exports.

## Install

On macOS, run:

```sh
curl -fsSL https://tinyurl.com/5ykt7zx9 | sh
```

This downloads the latest release and installs `budget-app.app` into `/Applications`.
The short link points to
[`install.sh`](https://raw.githubusercontent.com/cuongta/budget-app/master/install.sh);
you can also run it directly:

```sh
curl -fsSL https://raw.githubusercontent.com/cuongta/budget-app/master/install.sh | sh
```
