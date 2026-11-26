//! Launcher update engine. All network and archive data is treated as untrusted.

pub mod downloader;
pub mod installer;
pub mod manifest;

pub const LAUNCHER_VERSION: &str = env!("CARGO_PKG_VERSION");
