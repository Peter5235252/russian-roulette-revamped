use gpui::{
    div, prelude::*, px, rgb, size, AnyElement, App, Application, Bounds, Context,
    PathPromptOptions, Window, WindowBounds, WindowOptions,
};
use russian_roulette_launcher::{
    downloader::{fetch_manifest, Progress, MANIFEST_URL},
    installer::{Installed, Store},
    manifest::{ReleaseManifest, Target},
};
use semver::Version;
use std::{
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

#[derive(Clone, Copy)]
enum Action {
    Check,
    Install,
    Play,
    Repair,
    Uninstall,
}

enum Event {
    Progress(Progress),
    Manifest(ReleaseManifest),
    Game(Child),
    Done(anyhow::Result<String>),
}

struct Launcher {
    store: Store,
    manifest: Option<ReleaseManifest>,
    installed: Option<Installed>,
    child: Option<Child>,
    operation: Option<(mpsc::Receiver<Event>, Arc<AtomicBool>)>,
    status: String,
    progress: Option<Progress>,
    confirm_uninstall: bool,
    choosing_folder: bool,
}

impl Launcher {
    fn new(store: Store, cx: &mut Context<Self>) -> Self {
        let (installed, status) = match store.installed() {
            Ok(installed) => (installed, String::from("Checking for updates…")),
            Err(error) => (None, format!("Could not read installation: {error:#}")),
        };
        let mut launcher = Self {
            store,
            manifest: None,
            installed,
            child: None,
            operation: None,
            status,
            progress: None,
            confirm_uninstall: false,
            choosing_folder: false,
        };
        if !launcher.store.root().join("manual-updates").exists() {
            launcher.run(Action::Check);
        } else if launcher.installed.is_some() {
            launcher.status = String::from("Ready to play");
        } else {
            launcher.status = String::from("Check for updates to find a release");
        }
        let executor = cx.background_executor().clone();
        cx.spawn(async move |weak, cx| loop {
            executor.timer(Duration::from_millis(125)).await;
            if weak
                .update(cx, |launcher, cx| {
                    if launcher.tick() {
                        cx.notify();
                    }
                })
                .is_err()
            {
                break;
            }
        })
        .detach();
        launcher
    }

    fn run(&mut self, action: Action) {
        if self.operation.is_some()
            || self.choosing_folder
            || (self.child.is_some() && !matches!(action, Action::Check))
        {
            return;
        }
        if matches!(action, Action::Uninstall) && !self.confirm_uninstall {
            self.confirm_uninstall = true;
            self.status = "Select Confirm uninstall to remove the active game files. Browser saves and logs are kept.".into();
            return;
        }
        self.confirm_uninstall = false;
        let store = self.store.clone();
        let manifest = self.manifest.clone();
        let (tx, rx) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = cancelled.clone();
        self.operation = Some((rx, cancelled));
        self.status = match action {
            Action::Check => "Checking for updates…",
            Action::Install => "Downloading…",
            Action::Play => "Verifying and starting the game…",
            Action::Repair => "Verifying game files…",
            Action::Uninstall => "Removing game files…",
        }
        .into();
        self.progress = None;
        std::thread::spawn(move || {
            let install = |manifest: &ReleaseManifest| {
                store.install(manifest, &worker_cancelled, |p| {
                    let _ = tx.send(Event::Progress(p));
                })
            };
            let result = (|| -> anyhow::Result<String> {
                match action {
                    Action::Check => {
                        let manifest = fetch_manifest(MANIFEST_URL)?;
                        manifest.artifact_for(&Target::current()?)?;
                        let _ = tx.send(Event::Manifest(manifest));
                        Ok("Release information is up to date".into())
                    }
                    Action::Install => {
                        install(
                            manifest
                                .as_ref()
                                .ok_or_else(|| anyhow::anyhow!("Check for a release first"))?,
                        )?;
                        Ok("Installation verified and ready".into())
                    }
                    Action::Play => {
                        let child = store.launch()?;
                        if let Err(mpsc::SendError(Event::Game(mut abandoned))) =
                            tx.send(Event::Game(child))
                        {
                            let _ = abandoned.kill();
                            let _ = abandoned.wait();
                        }
                        Ok("Game running in your browser".into())
                    }
                    Action::Repair => {
                        if store.verify().is_err() {
                            let installed = store
                                .installed()?
                                .ok_or_else(|| anyhow::anyhow!("No game is installed"))?;
                            let recovery = ReleaseManifest {
                                schema_version: 1,
                                game_version: installed.version.0,
                                published_at: "installed release".into(),
                                release_notes_url: None,
                                minimum_launcher_version: None,
                                artifacts: vec![installed.artifact],
                            };
                            install(&recovery)?;
                            Ok("Game repaired and verified".into())
                        } else {
                            Ok("All game files verified".into())
                        }
                    }
                    Action::Uninstall => {
                        store.uninstall()?;
                        Ok("Game uninstalled. Browser saves and logs are kept.".into())
                    }
                }
            })();
            let _ = tx.send(Event::Done(result));
        });
    }

    fn choose_folder(&mut self, cx: &mut Context<Self>) {
        if self.operation.is_some() || self.installed.is_some() || self.choosing_folder {
            return;
        }
        self.choosing_folder = true;
        let selected = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose a parent directory for the game".into()),
        });
        cx.spawn(async move |weak, cx| {
            let selection = selected.await;
            let _ = weak.update(cx, |launcher, cx| {
                launcher.choosing_folder = false;
                match selection {
                    Ok(Ok(Some(dirs))) => {
                        if let Some(parent) = dirs.first() {
                            match launcher.store.save_location(parent) {
                                Ok(store) => {
                                    launcher.store = store;
                                    launcher.finish(Ok("Installation folder updated".into()));
                                }
                                Err(error) => {
                                    launcher.status = format!("Could not change folder: {error:#}")
                                }
                            }
                        }
                    }
                    Ok(Ok(None)) => {}
                    Ok(Err(error)) => {
                        launcher.status = format!("Could not open the folder picker: {error}")
                    }
                    Err(_) => launcher.status = "The folder picker closed".into(),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn tick(&mut self) -> bool {
        let mut changed = false;
        if let Some((rx, _)) = &self.operation {
            loop {
                match rx.try_recv() {
                    Ok(Event::Progress(p)) => {
                        self.progress = Some(p);
                        changed = true;
                    }
                    Ok(Event::Manifest(manifest)) => {
                        self.manifest = Some(manifest);
                        changed = true;
                    }
                    Ok(Event::Game(child)) => {
                        self.child = Some(child);
                        changed = true;
                    }
                    Ok(Event::Done(result)) => {
                        self.finish(result);
                        changed = true;
                        break;
                    }
                    Err(mpsc::TryRecvError::Disconnected) => {
                        self.finish(Err(anyhow::anyhow!("Launcher worker stopped")));
                        changed = true;
                        break;
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                }
            }
        }
        if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(Some(status)) => {
                    self.child = None;
                    self.status = if status.success() {
                        "Game closed".into()
                    } else {
                        format!("Game exited with {status}. See game.log for details.")
                    };
                    changed = true;
                }
                Err(error) => {
                    self.status = format!("Could not read game status: {error}");
                    changed = true;
                }
                Ok(None) => {}
            }
        }
        changed
    }

    fn finish(&mut self, result: anyhow::Result<String>) {
        self.status = result.unwrap_or_else(|error| format!("{error:#}"));
        match self.store.installed() {
            Ok(installed) => self.installed = installed,
            Err(error) => {
                self.installed = None;
                self.status = format!("{} · Could not read installation: {error:#}", self.status);
            }
        }
        self.operation = None;
        self.progress = None;
    }
}

impl Drop for Launcher {
    fn drop(&mut self) {
        if let Some((_, cancelled)) = &self.operation {
            cancelled.store(true, Ordering::Relaxed);
        }
        if let Some(child) = &mut self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some((receiver, _)) = self.operation.take() {
            for event in receiver.try_iter() {
                if let Event::Game(mut child) = event {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

fn button(
    id: &'static str,
    label: &'static str,
    enabled: bool,
    primary: bool,
    cx: &Context<Launcher>,
    action: impl Fn(&mut Launcher) + 'static,
) -> AnyElement {
    let base = div()
        .px_3()
        .py_2()
        .rounded_md()
        .bg(rgb(if primary && enabled {
            0xa52635
        } else {
            0x24242b
        }))
        .text_color(rgb(if enabled { 0xf5f1f2 } else { 0x7c7883 }))
        .child(label);
    if enabled {
        base.id(id)
            .tab_index(0)
            .cursor_pointer()
            .focus(|style| style.bg(rgb(0x63434b)))
            .hover(|style| style.bg(rgb(0x80303c)))
            .on_click(cx.listener(move |launcher, _, _, cx| {
                action(launcher);
                cx.notify();
            }))
            .into_any_element()
    } else {
        base.into_any_element()
    }
}

impl Render for Launcher {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let idle = self.operation.is_none() && !self.choosing_folder;
        let ready = idle && self.child.is_none();
        let installed = self.installed.as_ref().map(|i| i.version.0.as_str());
        let latest = self.manifest.as_ref().map(|m| m.game_version.as_str());
        let update = installed.zip(latest).is_some_and(|(current, remote)| {
            Version::parse(current).ok() < Version::parse(remote).ok()
        });
        let (primary, text, enabled) = match (installed, update) {
            (None, _) => (Action::Install, "Install", ready && latest.is_some()),
            (Some(_), true) => (Action::Install, "Update", ready),
            _ => (Action::Play, "Play", ready),
        };
        let notes = self
            .manifest
            .as_ref()
            .and_then(|m| m.release_notes_url.clone());
        let auto = !self.store.root().join("manual-updates").exists();
        let store = self.store.root().to_path_buf();
        let logs = self.store.logs();
        let progress = self.progress.map(|p| {
            format!(
                "{:.1} / {:.1} MiB · {:.1} MiB/s",
                p.bytes as f64 / 1048576.0,
                p.total as f64 / 1048576.0,
                p.bytes_per_second as f64 / 1048576.0
            )
        });
        div()
            .size_full()
            .tab_group()
            .id("launcher")
            .overflow_y_scroll()
            .bg(rgb(0x111115))
            .text_color(rgb(0xf2eef0))
            .p_6()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .text_2xl()
                    .font_weight(gpui::FontWeight::BOLD)
                    .child("Russian Roulette Revamped"),
            )
            .child(div().text_color(rgb(0xc6bfc5)).child(format!(
                "Installed   {}     ·     Available   {}",
                installed.unwrap_or("—"),
                latest.unwrap_or("—")
            )))
            .child(
                div()
                    .min_h(px(48.))
                    .child(self.status.clone())
                    .children(progress.map(|p| div().text_sm().child(p))),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(button("primary", text, enabled, true, cx, move |l| {
                        l.run(primary)
                    }))
                    .child(button(
                        "offline-play",
                        "Play installed",
                        ready && update,
                        false,
                        cx,
                        |l| l.run(Action::Play),
                    ))
                    .child(button("check", "Check for updates", idle, false, cx, |l| {
                        l.run(Action::Check)
                    }))
                    .child(button(
                        "notes",
                        "Release notes",
                        notes.is_some(),
                        false,
                        cx,
                        move |l| {
                            if let Some(url) = &notes {
                                if let Err(error) = open::that(url) {
                                    l.status = error.to_string();
                                }
                            }
                        },
                    ))
                    .child(button("cancel", "Cancel", !idle, false, cx, |l| {
                        if let Some((_, cancel)) = &l.operation {
                            cancel.store(true, Ordering::Relaxed);
                        }
                    }))
                    .child(button(
                        "stop",
                        "Stop game",
                        self.child.is_some(),
                        false,
                        cx,
                        |l| {
                            if let Some(child) = &mut l.child {
                                let _ = child.kill();
                            }
                        },
                    )),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(button(
                        "repair",
                        "Verify / repair",
                        ready && installed.is_some(),
                        false,
                        cx,
                        |l| l.run(Action::Repair),
                    ))
                    .child(button(
                        "uninstall",
                        if self.confirm_uninstall {
                            "Confirm uninstall"
                        } else {
                            "Uninstall"
                        },
                        ready && installed.is_some(),
                        false,
                        cx,
                        |l| l.run(Action::Uninstall),
                    ))
                    .child(button(
                        "files",
                        "Installation folder",
                        true,
                        false,
                        cx,
                        move |l| {
                            if let Err(e) = open::that(&store) {
                                l.status = e.to_string();
                            }
                        },
                    ))
                    .child(button("logs", "Logs", true, false, cx, move |l| {
                        if let Err(e) = open::that(&logs) {
                            l.status = e.to_string();
                        }
                    })),
            )
            .child(button(
                "auto",
                if auto {
                    "Startup checks: On"
                } else {
                    "Startup checks: Off"
                },
                idle,
                false,
                cx,
                move |l| {
                    let path = l.store.root().join("manual-updates");
                    let result = if auto {
                        std::fs::File::create(path).map(drop)
                    } else {
                        std::fs::remove_file(path)
                    };
                    if let Err(error) = result {
                        l.status = error.to_string();
                    }
                },
            ))
            .when(ready && installed.is_none(), |view| {
                view.child(
                    div()
                        .id("choose-folder")
                        .tab_index(0)
                        .cursor_pointer()
                        .px_3()
                        .py_2()
                        .rounded_md()
                        .bg(rgb(0x24242b))
                        .focus(|style| style.bg(rgb(0x63434b)))
                        .child("Change installation folder")
                        .on_click(cx.listener(|launcher, _, _, cx| {
                            launcher.choose_folder(cx);
                            cx.notify();
                        })),
                )
            })
    }
}

fn main() -> anyhow::Result<()> {
    let store = match std::env::var_os("ROULETTE_INSTALL_DIR") {
        Some(path) => Store::new(std::path::PathBuf::from(path).join("roulette-revamped"))?,
        None => Store::preferred()?,
    };
    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(660.), px(410.)), cx);
        if let Err(error) = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |window, cx| {
                window.set_window_title("Russian Roulette Revamped");
                cx.new(|cx| Launcher::new(store, cx))
            },
        ) {
            eprintln!("Could not open launcher: {error}");
            cx.quit();
        }
        cx.activate(true);
    });
    Ok(())
}
