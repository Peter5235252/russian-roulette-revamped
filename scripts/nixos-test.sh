#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
mode=${1:-launcher}
version=${2:-0.1.0}

if [[ $# -gt 2 || ( $mode != launcher && $mode != check ) ]]; then
  echo 'Usage: bash scripts/nixos-test.sh [launcher|check] [preview-version]' >&2
  exit 2
fi
if [[ ! $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'The preview version must be MAJOR.MINOR.PATCH.' >&2
  exit 2
fi
if [[ -z ${ROULETTE_NIX_RUNTIME:-} ]]; then
  echo 'Run this script inside the Nix development shell.' >&2
  exit 2
fi
if [[ $mode == launcher && -z ${WAYLAND_DISPLAY:-} && -z ${DISPLAY:-} ]]; then
  echo 'Run launcher mode from a terminal in your graphical session. Use check mode for headless tests.' >&2
  exit 2
fi

export CARGO_TARGET_DIR="$PWD/target"
export CARGO_PROFILE_DEV_DEBUG=0
npm ci --prefer-offline
if [[ $mode == check ]]; then
  npm run lint
  cargo test --locked --workspace
fi
npm run build:pages
if [[ $mode == check ]]; then npm run test:wasm; fi

cargo build --locked -p russian-roulette-launcher --features gpui-ui
base="$PWD/target/local-launcher"
bundle="$base/bundles/$version"
python3 scripts/package-release.py package linux-x86_64 dist "$CARGO_TARGET_DIR/debug" "$bundle"

if [[ $mode == check ]]; then
  ROULETTE_TEST_PACKAGE="$bundle" cargo test --locked -p russian-roulette-launcher packaged_release_lifecycle -- --ignored
  exit
fi

export LD_LIBRARY_PATH="$ROULETTE_NIX_RUNTIME:/run/opengl-driver/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$CARGO_TARGET_DIR/debug/roulette-launcher" --local-package "$bundle" "$version" "$base/installation"
