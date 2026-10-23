.PHONY: all dev release install build-rust test lint clean distclean version

all: release

dev:
	yarn
	yarn tauri dev

release:
	yarn tauri build

# install/update the latest GitHub release into /Applications (see install.sh)
install:
	./install.sh

# release version from the nearest RELEASE-v* tag (used by CI)
version:
	@python ./tools/version.py

# debug build of the Rust backend only
build-rust:
	cd src-tauri && cargo build

test:
	cd src-tauri && cargo test

lint:
	cd src-tauri && cargo clippy

# build outputs only
clean:
	rm -rf dist
	cd src-tauri && cargo clean

# build outputs + installed dependencies
distclean: clean
	rm -rf node_modules
