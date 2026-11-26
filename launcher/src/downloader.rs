use crate::manifest::{https_url, Artifact, ReleaseManifest};
use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;

pub const MANIFEST_URL: &str =
    "https://github.com/Peter5235252/russian-roulette-revamped/releases/latest/download/manifest.json";

#[derive(Debug, thiserror::Error)]
#[error("Release server returned HTTP {0}")]
pub struct ReleaseHttpStatus(pub u16);

fn response(url: &str, resume: Option<(u64, &str)>) -> Result<ureq::Response> {
    let mut url = https_url(url)?;
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(15))
        .build();
    for _ in 0..=5 {
        let mut request = agent.get(url.as_str()).set("Accept-Encoding", "identity");
        if let Some((offset, validator)) = resume {
            request = request
                .set("Range", &format!("bytes={offset}-"))
                .set("If-Range", validator);
        }
        let response = request.call().map_err(|error| match error {
            ureq::Error::Status(code, _) => ReleaseHttpStatus(code).into(),
            ureq::Error::Transport(_) => {
                anyhow::anyhow!("Could not connect to the release server")
            }
        })?;
        if response.status() == 200 || (resume.is_some() && response.status() == 206) {
            return Ok(response);
        }
        if !matches!(response.status(), 301 | 302 | 303 | 307 | 308) {
            bail!("Unexpected release server response: {}", response.status());
        }
        let location = response
            .header("Location")
            .context("Redirect has no destination")?;
        url = https_url(url.join(location)?.as_str())?;
    }
    bail!("Too many release server redirects")
}

pub fn fetch_manifest(url: &str) -> Result<ReleaseManifest> {
    const LIMIT: u64 = 1_048_576;
    let mut bytes = Vec::new();
    response(url, None)?
        .into_reader()
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        bail!("Release manifest exceeds the size limit");
    }
    let manifest: ReleaseManifest =
        serde_json::from_slice(&bytes).context("Invalid release manifest")?;
    manifest.validate()?;
    Ok(manifest)
}

#[derive(Clone, Copy)]
pub struct Progress {
    pub bytes: u64,
    pub total: u64,
    pub bytes_per_second: u64,
}

pub fn download(
    artifact: &Artifact,
    directory: &std::path::Path,
    cancelled: &AtomicBool,
    mut progress: impl FnMut(Progress),
) -> Result<NamedTempFile> {
    crate::manifest::validate_artifact(artifact)?;
    let mut file = NamedTempFile::new_in(directory)?;
    let started = Instant::now();
    let mut report = started;
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0; 65536];
    let mut validator: Option<String> = None;
    let mut last_error = None;
    for attempt in 0..3 {
        check_download(cancelled, started)?;
        let resume = validator
            .as_deref()
            .filter(|_| bytes > 0)
            .map(|tag| (bytes, tag));
        let reply = match response(&artifact.url, resume) {
            Ok(reply) => reply,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        if reply.status() == 206 {
            let expected_range = format!("bytes {}-{}/{}", bytes, artifact.size - 1, artifact.size);
            if reply.header("Content-Range") != Some(expected_range.as_str())
                || reply.header("ETag") != validator.as_deref()
            {
                validator = None;
                last_error = Some(anyhow::anyhow!(
                    "Server returned an unexpected resumed range"
                ));
                continue;
            }
        } else {
            bytes = 0;
            file.as_file_mut().set_len(0)?;
            file.as_file_mut().seek(SeekFrom::Start(0))?;
            hash = Sha256::new();
            validator = reply
                .header("ETag")
                .filter(|tag| tag.starts_with('"') && tag.ends_with('"'))
                .map(str::to_owned);
        }
        let mut reader = reply.into_reader();
        loop {
            check_download(cancelled, started)?;
            let count = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => count,
                Err(error) => {
                    last_error = Some(anyhow::Error::new(error).context("Download interrupted"));
                    break;
                }
            };
            bytes += count as u64;
            if bytes > artifact.size {
                bail!("Download exceeds the expected size");
            }
            hash.update(&buffer[..count]);
            file.write_all(&buffer[..count])?;
            if report.elapsed() >= Duration::from_millis(100) || bytes == artifact.size {
                progress(Progress {
                    bytes,
                    total: artifact.size,
                    bytes_per_second: (bytes as f64 / started.elapsed().as_secs_f64().max(0.01))
                        as u64,
                });
                report = Instant::now();
            }
        }
        if bytes == artifact.size {
            break;
        }
        if attempt < 2 {
            std::thread::sleep(Duration::from_millis(400));
        }
    }
    if bytes != artifact.size {
        return Err(last_error
            .unwrap_or_else(|| anyhow::anyhow!("Download ended before the expected size")));
    }
    if !hex::encode(hash.finalize()).eq_ignore_ascii_case(&artifact.sha256) {
        bail!("Download failed SHA-256 verification");
    }
    file.flush()?;
    Ok(file)
}

fn check_download(cancelled: &AtomicBool, started: Instant) -> Result<()> {
    if cancelled.load(Ordering::Relaxed) {
        bail!("Download cancelled");
    }
    if started.elapsed() > Duration::from_secs(3600) {
        bail!("Download timed out");
    }
    Ok(())
}
