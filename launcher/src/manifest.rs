use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fmt,
    path::{Component, Path},
};
use thiserror::Error;
use url::Url;

pub const MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error(
        "unsupported manifest schema {0}; this launcher supports schema {MANIFEST_SCHEMA_VERSION}"
    )]
    UnsupportedSchema(u32),
    #[error("manifest has no game version")]
    MissingVersion,
    #[error("manifest has an invalid version, date, target list or file inventory")]
    InvalidMetadata,
    #[error("artifact {0} is not served over HTTPS")]
    InsecureUrl(String),
    #[error("artifact {0} has an invalid URL")]
    InvalidUrl(String),
    #[error("artifact {0} has an invalid SHA-256 checksum")]
    InvalidChecksum(String),
    #[error("artifact {0} has an invalid size")]
    InvalidSize(String),
    #[error("artifact {0} has an unsafe entrypoint")]
    UnsafeEntrypoint(String),
    #[error("artifact {0} has an unsafe file path")]
    UnsafeFilePath(String),
    #[error("no artifact supports {0}")]
    UnsupportedTarget(Target),
    #[error("unsupported operating system or architecture: {0}")]
    UnsupportedHost(&'static str),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseManifest {
    pub schema_version: u32,
    pub game_version: String,
    pub published_at: String,
    #[serde(default)]
    pub release_notes_url: Option<String>,
    #[serde(default)]
    pub minimum_launcher_version: Option<String>,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub target: Target,
    pub url: String,
    pub format: ArtifactFormat,
    pub size: u64,
    pub sha256: String,
    /// Relative executable path after extraction. It is never passed through a shell.
    pub entrypoint: String,
    /// Exact replaceable files used by repair and post-extraction verification.
    pub files: Vec<ArtifactFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub os: OperatingSystem,
    pub arch: Architecture,
}

impl fmt::Display for Target {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}-{}", self.os, self.arch)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatingSystem {
    Linux,
    Windows,
    Macos,
}

impl fmt::Display for OperatingSystem {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Linux => "linux",
            Self::Windows => "windows",
            Self::Macos => "macos",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Architecture {
    X86_64,
    Aarch64,
}

impl fmt::Display for Architecture {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::X86_64 => "x86_64",
            Self::Aarch64 => "aarch64",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactFormat {
    Zip,
}

impl ReleaseManifest {
    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.schema_version != MANIFEST_SCHEMA_VERSION {
            return Err(ManifestError::UnsupportedSchema(self.schema_version));
        }
        if self.game_version.trim().is_empty() {
            return Err(ManifestError::MissingVersion);
        }
        if semver::Version::parse(&self.game_version).is_err()
            || self
                .minimum_launcher_version
                .as_deref()
                .is_some_and(|v| semver::Version::parse(v).is_err())
            || self.published_at.trim().is_empty()
            || self.artifacts.is_empty()
        {
            return Err(ManifestError::InvalidMetadata);
        }
        if let Some(url) = &self.release_notes_url {
            https_url(url)?;
        }
        let mut targets = HashSet::new();
        for artifact in &self.artifacts {
            validate_artifact(artifact)?;
            if !targets.insert(&artifact.target) {
                return Err(ManifestError::InvalidMetadata);
            }
        }
        Ok(())
    }

    pub fn artifact_for(&self, target: &Target) -> Result<&Artifact, ManifestError> {
        self.validate()?;
        self.artifacts
            .iter()
            .find(|artifact| artifact.target == *target)
            .ok_or_else(|| ManifestError::UnsupportedTarget(target.clone()))
    }
}

impl Target {
    pub fn current() -> Result<Self, ManifestError> {
        let os = match std::env::consts::OS {
            "linux" => OperatingSystem::Linux,
            "windows" => OperatingSystem::Windows,
            "macos" => OperatingSystem::Macos,
            other => return Err(ManifestError::UnsupportedHost(other)),
        };
        let arch = match std::env::consts::ARCH {
            "x86_64" => Architecture::X86_64,
            "aarch64" => Architecture::Aarch64,
            other => return Err(ManifestError::UnsupportedHost(other)),
        };
        Ok(Self { os, arch })
    }
}

pub fn https_url(value: &str) -> Result<Url, ManifestError> {
    let url = Url::parse(value).map_err(|_| ManifestError::InvalidUrl("remote resource".into()))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(ManifestError::InsecureUrl("remote resource".into()));
    }
    Ok(url)
}

pub fn validate_artifact(artifact: &Artifact) -> Result<(), ManifestError> {
    https_url(&artifact.url)?;
    if artifact.size == 0 || artifact.size > 2_000_000_000 {
        return Err(ManifestError::InvalidSize(artifact.url.clone()));
    }
    if !valid_sha256(&artifact.sha256) {
        return Err(ManifestError::InvalidChecksum(artifact.url.clone()));
    }
    if !is_safe_relative(Path::new(&artifact.entrypoint)) {
        return Err(ManifestError::UnsafeEntrypoint(artifact.url.clone()));
    }
    let mut filenames = HashSet::new();
    let mut total = 0u64;
    for file in &artifact.files {
        total = total.saturating_add(file.size);
        if total > 4_000_000_000 || !filenames.insert(file.path.to_ascii_lowercase()) {
            return Err(ManifestError::InvalidMetadata);
        }
        if !valid_sha256(&file.sha256) {
            return Err(ManifestError::InvalidChecksum(file.path.clone()));
        }
        if !is_safe_relative(Path::new(&file.path)) {
            return Err(ManifestError::UnsafeFilePath(file.path.clone()));
        }
    }
    if artifact.files.len() > 10_000
        || !artifact
            .files
            .iter()
            .any(|file| file.path == artifact.entrypoint && file.size > 0)
    {
        return Err(ManifestError::InvalidMetadata);
    }
    Ok(())
}

pub fn is_safe_relative(path: &Path) -> bool {
    path.to_str().is_some_and(|value| {
        value.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with([' ', '.'])
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                && !matches!(
                    base.as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
    }) && path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

pub fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact(url: &str) -> Artifact {
        Artifact {
            target: Target {
                os: OperatingSystem::Linux,
                arch: Architecture::X86_64,
            },
            url: url.into(),
            format: ArtifactFormat::Zip,
            size: 42,
            sha256: "a".repeat(64),
            entrypoint: "game/russian-roulette".into(),
            files: vec![ArtifactFile {
                path: "game/russian-roulette".into(),
                sha256: "b".repeat(64),
                size: 1,
            }],
        }
    }

    #[test]
    fn rejects_insecure_and_path_traversal_manifest_data() {
        let insecure = ReleaseManifest {
            schema_version: 1,
            game_version: "1.0.0".into(),
            published_at: "2026-01-01".into(),
            release_notes_url: None,
            minimum_launcher_version: None,
            artifacts: vec![artifact("http://example.test/game.tar.gz")],
        };
        assert!(matches!(
            insecure.validate(),
            Err(ManifestError::InsecureUrl(_))
        ));

        let mut unsafe_path = artifact("https://example.test/game.tar.gz");
        unsafe_path.entrypoint = "../game".into();
        let manifest = ReleaseManifest {
            schema_version: 1,
            game_version: "1.0.0".into(),
            published_at: "2026-01-01".into(),
            release_notes_url: None,
            minimum_launcher_version: None,
            artifacts: vec![unsafe_path],
        };
        assert!(matches!(
            manifest.validate(),
            Err(ManifestError::UnsafeEntrypoint(_))
        ));
    }
}
