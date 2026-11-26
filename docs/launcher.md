# Desktop launcher

The GPUI launcher manages platform packages independently of the development server. Each package contains a small native executable and the same version of the WASM game that Pages builds. **Play** verifies the installed files, starts that executable with its install folder as the working directory, and opens the static game in the default browser at `http://127.0.0.1:53483/`. The stable local origin keeps browser preferences across updates. **Stop game** or closing the launcher stops the server. A browser with WebGL 2 or WebGPU is required. The original audio samples and preferred fonts are fetched from their existing CDNs when connected.

## Build targets

| Native target | Build requirements and runtime |
| --- | --- |
| Linux x86_64 GNU | Stable Rust, C compiler, pkg-config and the packages listed in the release workflow. Runtime requires an X11 or Wayland desktop, Vulkan and a browser. The release binary uses the runner's glibc baseline. |
| Windows x86_64 MSVC | Stable MSVC Rust, Visual Studio C++ build tools and Windows SDK. Runtime requires a DirectX 11-capable display driver and a browser. |
| macOS arm64 and x86_64 | Stable Rust, Xcode and its command-line tools with Metal support. Apple Silicon and Intel are built separately. |

Build with `cargo build --locked --release -p russian-roulette-launcher --features gpui-ui`. This produces `roulette-launcher` and `roulette-game` with `.exe` extensions on Windows. Run the launcher binary. On Unix a downloaded raw launcher may need its execute permission set. Releases are unsigned and macOS artifacts are not notarized. Platform support requires a successful native build and an install, update, and launch check on that platform.

## Install and update

The launcher checks the GitHub Releases manifest on startup. You can turn startup checks off, check manually, open release notes, and play the installed copy offline. Choose a parent installation folder before installing. The launcher uses a dedicated `roulette-revamped` subdirectory and saves the selection in its default application-data folder. Choose a new folder after uninstalling the active game.

The installer compares semantic versions, verifies archive size and SHA-256, and checks all extracted files against the manifest. It extracts only listed regular files into a private directory. Updating switches the installation record after verification. Previous versions remain on disk. **Verify / repair** checks the active version and downloads its matching archive if repair is needed. **Uninstall** removes the active copy and leaves browser preferences and logs intact. Transfer retries resume when the server provides a matching strong ETag and byte range. Cancelling removes partial downloads.

## Release

Create a `vMAJOR.MINOR.PATCH` tag, then push the tag or run the release workflow for it. The workflow builds the browser site once and packages it with each native launcher and game server. Each native job smoke-tests a local install, version update, game-server launch, WASM fetch, and uninstall using its packaged archive. The workflow assembles checksums and `manifest.json` after all targets succeed. Artifacts upload to a draft before the release becomes visible. The launcher reads the manifest from the latest published release and downloads the selected target ZIP.

The manifest includes schema version, game version, publication date, release notes URL, minimum launcher version, and platform archives with their HTTPS URLs, sizes, SHA-256 hashes, entrypoints, and file inventories. The launcher trusts the project's HTTPS GitHub release metadata as the source of checksums.
