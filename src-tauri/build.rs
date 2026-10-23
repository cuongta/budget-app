fn main() {
    // sqlx::migrate! embeds migrations at compile time; rebuild when one is added.
    println!("cargo:rerun-if-changed=migrations");
    tauri_build::build()
}
