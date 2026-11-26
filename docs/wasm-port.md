# Browser and WebAssembly

The browser build loads Rust-generated WebAssembly before enabling **Enter Chamber**. The Rust crate computes the seeded cylinder, shots, and inventory effects. React applies those results on the existing animation schedule. The versioned adapter passes typed objects through wasm-bindgen and checks API version 1 on initialization.

## Source audit

The reference is the TypeScript source at `8ad8622`. Treat the state transitions in `src/hooks/useGameState.ts` as behavioral evidence when the item descriptions in `src/gameData.ts` differ.

| Feature | Source and validation |
| --- | --- |
| Classic and Revamped, four difficulty levels | Initial health and inventories remain in the React hook. The compiled-module tests cover cylinder ranges in all eight combinations and check seed repeatability. |
| Shooting, damage and turn retention | Rust owns shell consumption, target selection, damage, temporary protection, currency, and blank-shot retaliation. The compiled-module tests compare 384 combinations to the previous formulas. |
| Item effects | Rust applies all 11 items. Compiled-module tests cover their ordinary effects, including the Classic mirror, the cigarette timer, and the Classic scalpel restriction. The browser layer keeps item messages and animation cues. |
| Match progression, rematches and shop | React keeps round/match transitions, inventory drops, shop purchases, and victory carry-over. Emptying the cylinder with pliers now reloads the round instead of allowing a spent chamber to be selected. |
| Dealer | Rust selects Classic dealer actions using the same item priorities, caps and probability thresholds as the reference. Rust and compiled-module tests exercise that policy. The Revamped decision engine remains in TypeScript. Both branches resolve dealer shots and items through the Rust rules. |
| HUD, menu, settings and rendering | The existing four HUD modes, Three.js arena, shader preloader, and WebGPU/WebGL 2 selection stay in the browser layer. |
| Controls, audio and persistence | The browser continues to handle mouse, keyboard, touch, gamepad, haptics and Web Audio. Local storage retains preferences. Match progress was transient in the source. |

The seeded RNG preserves the original ranges and random placements. It defines its own deterministic sequence because the original used an unseeded browser RNG.

## Build and verify

Install Node 22, stable Rust with the `wasm32-unknown-unknown` target, and wasm-bindgen CLI `0.2.130`.

```sh
cargo install wasm-bindgen-cli --version 0.2.130 --locked
npm ci
npm run lint
cargo test --locked --workspace
npm run build:pages
npm run test:wasm
```

The site artifact includes `dist/wasm/russian_roulette_wasm_bg.wasm`. In DevTools, filter the Network panel by `wasm`. At the project Pages URL, the browser should request the module under `/russian-roulette-revamped/wasm/` and enable **Enter Chamber** after initialization. The test script `scripts/test-wasm.mjs` instantiates and exercises the compiled bytes directly. With Playwright and its Chromium/Firefox browsers installed, `node scripts/test-browser.mjs` serves the artifact at a project subpath and verifies a played turn and reload in both browsers. The tested renderer depends on the available GPU and browser.

Pushes to `main` build and deploy through GitHub Actions. Pull requests build, type-check and test without publishing Pages.
