# Desktop launcher

The GPUI launcher manages platform packages independently of the development server. Each package contains a small native executable and the same version of the WASM game that Pages builds. **Play** verifies the installed files, starts that executable with its install folder as the working directory, and opens the static game in the default browser at `http://127.0.0.1:53483/`. The stable local origin keeps browser preferences across updates. **Stop game** or closing the launcher stops the server. A browser with WebGL 2 or WebGPU is required. The original audio samples and preferred fonts are fetched from their existing CDNs when connected.

## Build targets

| Native target | Build requirements and runtime |
| --- | --- |
| Linux x86_64 GNU | Stable Rust, C compiler, pkg-config and the packages listed in the release workflow. Runtime requires an X11 or Wayland desktop, Vulkan and a browser. The release binary uses the runner's glibc baseline. |
| Windows x86_64 MSVC | Stable MSVC Rust, Visual Studio C++ build tools and Windows SDK. Runtime requires a DirectX 11-capable display driver and a browser. |
| macOS arm64 and x86_64 | Stable Rust, Xcode and its command-line tools with Metal support. Apple Silicon and Intel are built separately. |

Build with `cargo build --locked --release -p russian-roulette-launcher --features gpui-ui`. This produces `roulette-launcher` and `roulette-game`, with `.exe` extensions on Windows. The release launcher and its game server run without extra console windows on Windows. The macOS launcher ZIP contains a Finder-ready **Russian Roulette Revamped.app**, ad-hoc signed and verified during packaging. Developer ID signing and notarization are unavailable. On Linux a downloaded raw launcher may need its execute permission set. Use the NixOS procedure below for a native build against Nix libraries.

## Test on NixOS

From the repository in a graphical Wayland or X11 session, run:

```bash
nix develop -c bash scripts/nixos-test.sh launcher
```

The pinned Nix shell supplies the Rust/WASM toolchain, Node, and GPUI's native graphics libraries for x86_64 NixOS. The command builds the game and launcher and opens **Local preview**. Select **Install game**, then **Play game**. The launcher opens the installed WASM build in your default browser. **Settings & files** exposes the local installation, logs, verify/repair, and uninstall. This preview needs no published desktop release and makes no changes to your system configuration.

To exercise an update, close the launcher and restart with a higher preview version:

```bash
nix develop -c bash scripts/nixos-test.sh launcher 0.1.1
```

Select **Install update**. The preview keeps its install state under `target/local-launcher/installation/` and uses `http://127.0.0.1:53484/` for its browser preferences. The regular launcher uses port `53483` and the user's usual application-data directory. If your shell has flakes disabled, prefix `develop` with `--extra-experimental-features 'nix-command flakes'`.

Run the repeatable headless checks with:

```bash
nix develop -c bash scripts/nixos-test.sh check
```

This builds the native launcher and WASM package, runs Rust and TypeScript checks, and exercises a valid install, a rejected corrupt update, a successful update, WASM serving, and uninstall. For a browser-only development session, enter `nix develop`, then run `npm ci` and `npm run dev`.

## Install and update

The launcher checks the GitHub Releases manifest on startup. You can turn startup checks off, check manually, open release notes, and play the installed copy offline. The launcher shows installed and available versions and reports download progress, size, and speed. While the game server runs you can reopen the browser or stop the server. Use Tab or Shift+Tab to move between controls and Enter or Space to activate one. Choose a parent installation folder in **Settings & files** before installing. The launcher uses a dedicated `roulette-revamped` subdirectory and saves the selection in its default application-data folder. Choose a new folder after uninstalling the active game.

The installer compares semantic versions, verifies archive size and SHA-256, and checks all extracted files against the manifest. It extracts only listed regular files into a private directory. Updating switches the installation record after verification. Previous versions remain on disk. **Verify / repair** checks the active version and downloads its matching archive if repair is needed. **Uninstall** removes the active copy and leaves browser preferences and logs intact. Transfer retries resume when the server provides a matching strong ETag and byte range. Cancelling removes partial downloads.

## Release

Create a `vMAJOR.MINOR.PATCH` tag, then push the tag or run the release workflow for it. The workflow builds the browser site once and packages it with each native launcher and game server. Each native job smoke-tests a local install, version update, game-server launch, WASM fetch, and uninstall using its packaged archive. The workflow assembles checksums and `manifest.json` after all targets succeed. Artifacts upload to a draft before the release becomes visible. The launcher reads the manifest from the latest published release and downloads the selected target ZIP.

The manifest includes schema version, game version, publication date, release notes URL, minimum launcher version, and platform archives with their HTTPS URLs, sizes, SHA-256 hashes, entrypoints, and file inventories. The launcher trusts the project's HTTPS GitHub release metadata as the source of checksums.
