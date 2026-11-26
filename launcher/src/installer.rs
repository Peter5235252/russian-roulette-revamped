use crate::{
    downloader::{download, Progress},
    manifest::{validate_artifact, Artifact, ArtifactFile, Target},
    LAUNCHER_VERSION,
};
use anyhow::{bail, Context, Result};
use directories_next::ProjectDirs;
use fs2::FileExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
};
use tempfile::{NamedTempFile, TempDir};

#[derive(Clone, Serialize, Deserialize)]
pub struct Installed {
    pub version: VersionInfo,
    pub artifact: Artifact,
    directory: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct VersionInfo(pub String);

#[derive(Clone)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn default_store() -> Result<Self> {
        let dirs = ProjectDirs::from("io.github", "Peter5235252", "RouletteRevamped")
            .context("No application data directory is available")?;
        Self::new(dirs.data_local_dir().to_path_buf())
    }

    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("versions"))?;
        fs::create_dir_all(root.join("logs"))?;
        Ok(Self {
            root: root.canonicalize()?,
        })
    }

    pub fn save_location(&self, parent: &Path) -> Result<Store> {
        let _lock = self.lock()?;
        if self.installed()?.is_some() {
            bail!("Uninstall the active game before changing the installation folder");
        }
        let selected = Self::new(parent.join("roulette-revamped"))?;
        selected.installed()?;
        let config = Self::default_store()?;
        let mut location = NamedTempFile::new_in(config.root())?;
        serde_json::to_writer(&mut location, selected.root())?;
        location.as_file().sync_all()?;
        location.persist(config.root().join("install-location.json"))?;
        Ok(selected)
    }

    pub fn preferred() -> Result<Self> {
        let default = Self::default_store()?;
        match File::open(default.root().join("install-location.json")) {
            Ok(file) => Self::new(serde_json::from_reader(file.take(16_384))?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(default),
            Err(error) => Err(error.into()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }
    fn metadata(&self) -> PathBuf {
        self.root.join("installed.json")
    }

    fn lock(&self) -> Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.root.join("operation.lock"))?;
        FileExt::try_lock_exclusive(&file).context("Another launcher operation is running")?;
        Ok(file)
    }

    fn game_dir(&self, installed: &Installed) -> Result<PathBuf> {
        if !installed.directory.starts_with("game-")
            || !installed
                .directory
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            bail!("Installation record has an invalid directory");
        }
        let dir = self.root.join("versions").join(&installed.directory);
        let versions = self.root.join("versions").canonicalize()?;
        if dir.canonicalize()?.parent() != Some(versions.as_path())
            || !fs::symlink_metadata(&dir)?.is_dir()
        {
            bail!("Installation record points outside the managed directory");
        }
        Ok(dir)
    }

    pub fn installed(&self) -> Result<Option<Installed>> {
        let file = match File::open(self.metadata()) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let installed: Installed = serde_json::from_reader(file.take(2_000_000))?;
        Version::parse(&installed.version.0)?;
        validate_artifact(&installed.artifact)?;
        if installed.artifact.target != Target::current()? {
            bail!("Installation is for a different platform");
        }
        Ok(Some(installed))
    }

    pub fn install(
        &self,
        manifest: &crate::manifest::ReleaseManifest,
        cancelled: &AtomicBool,
        progress: impl FnMut(Progress),
    ) -> Result<()> {
        let _lock = self.lock()?;
        let artifact = manifest.artifact_for(&Target::current()?)?;
        let version = Version::parse(&manifest.game_version)?;
        if let Some(minimum) = &manifest.minimum_launcher_version {
            if Version::parse(LAUNCHER_VERSION)? < Version::parse(minimum)? {
                bail!("Update the launcher to {minimum} before installing this release");
            }
        }
        if let Some(current) = self.installed()? {
            if Version::parse(&current.version.0)? > version {
                bail!("The installed version is newer than the manifest");
            }
        }
        let mut archive = download(artifact, &self.root, cancelled, progress)?;
        archive.as_file_mut().seek(SeekFrom::Start(0))?;
        let stage = tempfile::Builder::new()
            .prefix("game-")
            .tempdir_in(self.root.join("versions"))?;
        extract(archive.as_file_mut(), stage.path(), artifact, cancelled)?;
        self.activate(stage, manifest, artifact, cancelled)
    }

    fn activate(
        &self,
        stage: TempDir,
        manifest: &crate::manifest::ReleaseManifest,
        artifact: &Artifact,
        cancelled: &AtomicBool,
    ) -> Result<()> {
        if cancelled.load(Ordering::Relaxed) {
            bail!("Installation cancelled");
        }
        let directory = stage
            .path()
            .file_name()
            .and_then(|s| s.to_str())
            .context("Invalid staging directory")?
            .to_owned();
        let installed = Installed {
            version: VersionInfo(manifest.game_version.clone()),
            artifact: artifact.clone(),
            directory,
        };
        let mut metadata = NamedTempFile::new_in(&self.root)?;
        serde_json::to_writer(&mut metadata, &installed)?;
        metadata.as_file().sync_all()?;
        // Keep the complete staging directory before moving the metadata pointer.
        // A failed persist removes this private directory and leaves the old pointer intact.
        let path = stage.keep();
        if let Err(error) = metadata.persist(self.metadata()) {
            let _ = fs::remove_dir_all(path);
            return Err(error.error.into());
        }
        Ok(())
    }

    pub fn verify(&self) -> Result<()> {
        let _lock = self.lock()?;
        let installed = self.installed()?.context("No installed game")?;
        verify_files(&self.game_dir(&installed)?, &installed.artifact)
    }

    pub fn uninstall(&self) -> Result<()> {
        let _lock = self.lock()?;
        let installed = self.installed()?.context("No installed game")?;
        let dir = self.game_dir(&installed)?;
        let tomb = tempfile::Builder::new()
            .prefix("removed-")
            .tempdir_in(self.root.join("versions"))?;
        let destination = tomb.path().join("game");
        fs::rename(&dir, &destination)?;
        if let Err(error) = fs::remove_file(self.metadata()) {
            if fs::rename(&destination, &dir).is_err() {
                let recovered = tomb.keep();
                bail!(
                    "Uninstall could not roll back. Game files are at {}",
                    recovered.display()
                );
            }
            return Err(error.into());
        }
        tomb.close()?;
        Ok(())
    }

    pub fn launch(&self) -> Result<Child> {
        let _lock = self.lock()?;
        let installed = self.installed()?.context("No installed game")?;
        let dir = self.game_dir(&installed)?;
        verify_files(&dir, &installed.artifact).context("Game files need repair")?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.logs().join("game.log"))?;
        Command::new(dir.join(&installed.artifact.entrypoint))
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .spawn()
            .context("Could not start the installed game")
    }
}

fn extract(
    file: &mut File,
    root: &Path,
    artifact: &Artifact,
    cancelled: &AtomicBool,
) -> Result<()> {
    let mut zip = zip::ZipArchive::new(file)?;
    let files: HashMap<_, _> = artifact
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    if zip.len() != files.len() {
        bail!("Archive inventory does not match the manifest");
    }
    let mut seen = HashSet::new();
    for index in 0..zip.len() {
        if cancelled.load(Ordering::Relaxed) {
            bail!("Installation cancelled");
        }
        let entry = zip.by_index(index)?;
        let name = entry.name().to_owned();
        let expected = files
            .get(name.as_str())
            .context("Archive contains an unlisted file")?;
        if !seen.insert(name.clone())
            || !entry.is_file()
            || entry.is_symlink()
            || entry
                .unix_mode()
                .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000))
            || entry.size() != expected.size
        {
            bail!("Archive entry has an unexpected type or size");
        }
        let path = root.join(&name);
        fs::create_dir_all(path.parent().context("Archive entry has no parent")?)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        if std::io::copy(&mut entry.take(expected.size + 1), &mut output)? != expected.size {
            bail!("Extracted file has an unexpected size");
        }
        if name == artifact.entrypoint {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                output.set_permissions(fs::Permissions::from_mode(0o755))?;
            }
        }
    }
    verify_files(root, artifact)
}

fn verify_files(root: &Path, artifact: &Artifact) -> Result<()> {
    for file in &artifact.files {
        verify_file(root, file)
            .with_context(|| format!("Verification failed for {}", file.path))?;
    }
    Ok(())
}

fn verify_file(root: &Path, expected: &ArtifactFile) -> Result<()> {
    let path = root.join(&expected.path);
    if !path.canonicalize()?.starts_with(root.canonicalize()?)
        || !fs::symlink_metadata(&path)?.is_file()
    {
        bail!("Expected a regular file inside the installation");
    }
    let file = File::open(path)?;
    if file.metadata()?.len() != expected.size {
        bail!("File size differs");
    }
    let mut hash = Sha256::new();
    std::io::copy(&mut file.take(expected.size + 1), &mut hash)?;
    if !hex::encode(hash.finalize()).eq_ignore_ascii_case(&expected.sha256) {
        bail!("SHA-256 differs");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::ArtifactFormat;
    use std::io::Write;

    fn fixture(entries: &[(&str, &[u8])]) -> NamedTempFile {
        let mut archive = NamedTempFile::new().unwrap();
        let mut zip = zip::ZipWriter::new(archive.as_file_mut());
        for (name, bytes) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        archive
    }

    fn artifact() -> Artifact {
        Artifact {
            target: Target::current().unwrap(),
            url: "https://example.test/game.zip".into(),
            format: ArtifactFormat::Zip,
            size: 256,
            sha256: "0".repeat(64),
            entrypoint: "game".into(),
            files: vec![ArtifactFile {
                path: "game".into(),
                size: 4,
                sha256: hex::encode(Sha256::digest(b"game")),
            }],
        }
    }

    #[test]
    fn extracts_only_manifest_files_and_detects_corruption() {
        let package = artifact();
        let dir = tempfile::tempdir().unwrap();
        let mut archive = fixture(&[("game", b"game")]);
        extract(
            archive.as_file_mut(),
            dir.path(),
            &package,
            &AtomicBool::new(false),
        )
        .unwrap();
        verify_files(dir.path(), &package).unwrap();
        fs::write(dir.path().join("game"), b"fail").unwrap();
        assert!(verify_files(dir.path(), &package).is_err());
    }

    #[test]
    fn rejects_unknown_files_and_respects_cancellation() {
        let package = artifact();
        let dir = tempfile::tempdir().unwrap();
        let mut archive = fixture(&[("unknown", b"game")]);
        assert!(extract(
            archive.as_file_mut(),
            dir.path(),
            &package,
            &AtomicBool::new(false)
        )
        .is_err());
        let mut archive = fixture(&[("game", b"game")]);
        assert!(extract(
            archive.as_file_mut(),
            dir.path(),
            &package,
            &AtomicBool::new(true)
        )
        .is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn cancellation_preserves_a_previous_installation_and_uninstall_keeps_logs() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::new(directory.path().to_path_buf()).unwrap();
        let package = artifact();
        let commit = |version: &str, cancelled: bool| {
            let stage = tempfile::Builder::new()
                .prefix("game-")
                .tempdir_in(store.root.join("versions"))
                .unwrap();
            fs::write(stage.path().join("game"), b"game").unwrap();
            let manifest = crate::manifest::ReleaseManifest {
                schema_version: 1,
                game_version: version.into(),
                published_at: "2026-11-26".into(),
                release_notes_url: None,
                minimum_launcher_version: None,
                artifacts: vec![package.clone()],
            };
            store.activate(stage, &manifest, &package, &AtomicBool::new(cancelled))
        };
        commit("1.0.0", false).unwrap();
        assert!(commit("1.1.0", true).is_err());
        assert_eq!(store.installed().unwrap().unwrap().version.0, "1.0.0");
        store.verify().unwrap();
        fs::write(store.logs().join("game.log"), b"preserve").unwrap();
        store.uninstall().unwrap();
        assert!(store.installed().unwrap().is_none());
        assert_eq!(
            fs::read(store.logs().join("game.log")).unwrap(),
            b"preserve"
        );
    }
}
