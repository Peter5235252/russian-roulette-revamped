//! Serves the packaged game over a stable loopback origin for browser storage.
use anyhow::{bail, Result};
use std::{fs::File, path::Path};
use tiny_http::{Header, Method, Response, Server};

const ADDRESS: &str = "127.0.0.1:53483";

fn main() -> Result<()> {
    let site = std::env::current_dir()?.join("site").canonicalize()?;
    if !site.join("index.html").is_file() {
        bail!("The installed site has no entry point");
    }
    let server = Server::http(ADDRESS).map_err(|error| anyhow::anyhow!("{error}"))?;
    open::that(format!("http://{ADDRESS}/"))?;
    for request in server.incoming_requests() {
        let host_ok = request
            .headers()
            .iter()
            .any(|header| header.field.equiv("Host") && header.value.as_str() == ADDRESS);
        if !host_ok || request.method() != &Method::Get {
            let _ = request.respond(Response::empty(403));
            continue;
        }
        let raw = request.url().split('?').next().unwrap_or_default();
        let name = if raw == "/" {
            "index.html"
        } else {
            raw.strip_prefix('/').unwrap_or_default()
        };
        let relative = Path::new(name);
        if !russian_roulette_launcher::manifest::is_safe_relative(relative) {
            let _ = request.respond(Response::empty(404));
            continue;
        }
        let file = site
            .join(relative)
            .canonicalize()
            .ok()
            .filter(|path| path.starts_with(&site) && path.is_file())
            .and_then(|path| File::open(path).ok());
        let Some(file) = file else {
            let _ = request.respond(Response::empty(404));
            continue;
        };
        let mime = match relative.extension().and_then(|s| s.to_str()) {
            Some("html") => "text/html; charset=utf-8",
            Some("js") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("wasm") => "application/wasm",
            Some("png") => "image/png",
            Some("webp") => "image/webp",
            Some("svg") => "image/svg+xml",
            Some("woff2") => "font/woff2",
            _ => "application/octet-stream",
        };
        let response = Response::from_file(file)
            .with_header(Header::from_bytes("Content-Type", mime).unwrap())
            .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap())
            .with_header(Header::from_bytes("Cache-Control", "no-cache").unwrap());
        let _ = request.respond(response);
    }
    Ok(())
}
