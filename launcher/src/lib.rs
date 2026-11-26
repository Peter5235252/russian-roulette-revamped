//! Launcher update engine. All network and archive data is treated as untrusted.

pub mod downloader;
pub mod installer;
pub mod manifest;

pub const LAUNCHER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const GAME_ADDRESS: &str = "127.0.0.1:53483";
pub const PREVIEW_ADDRESS: &str = "127.0.0.1:53484";
