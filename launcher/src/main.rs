#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use gpui::{
    actions, div, prelude::*, px, rgb, size, AnyElement, App, Application, Bounds, Context,
    FocusHandle, KeyBinding, PathPromptOptions, Window, WindowBounds, WindowOptions,
};
use russian_roulette_launcher::{
    downloader::{fetch_manifest, Progress, ReleaseHttpStatus, MANIFEST_URL},
    installer::{Installed, LocalPackage, Store},
    manifest::{ReleaseManifest, Target},
    GAME_ADDRESS, LAUNCHER_VERSION, PREVIEW_ADDRESS,
};
use semver::Version;
use std::{
    path::{Path, PathBuf},
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

actions!(roulette_launcher, [FocusNext, FocusPrevious]);

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
    Manifest(Option<ReleaseManifest>),
    Game(GameProcess),
    Done(anyhow::Result<String>),
}

struct Operation {
    action: Action,
    events: mpsc::Receiver<Event>,
    cancelled: Arc<AtomicBool>,
}

struct GameProcess(Child);

impl Drop for GameProcess {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

struct Launcher {
    focus: FocusHandle,
    store: Store,
    local: Option<LocalPackage>,
    manifest: Option<ReleaseManifest>,
    installed: Option<Installed>,
    child: Option<GameProcess>,
    operation: Option<Operation>,
    status: String,
    status_error: bool,
    progress: Option<Progress>,
    confirm_uninstall: bool,
    choosing_folder: bool,
    show_settings: bool,
    stopping: bool,
}

impl Launcher {
    fn new(
        store: Store,
        local: Option<LocalPackage>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        window.focus(&focus);
        let (installed, status) = match store.installed() {
            Ok(installed) => (installed, String::from("Checking for updates…")),
            Err(error) => (None, format!("Could not read installation: {error:#}")),
        };
        let preview_status = if installed.is_some() {
            "Ready to play the installed preview."
        } else {
            "Install the local bundle to start testing."
        };
        let mut launcher = Self {
            focus,
            store,
            manifest: local.as_ref().map(|package| package.manifest.clone()),
            local,
            installed,
            child: None,
            operation: None,
            status,
            status_error: false,
            progress: None,
            confirm_uninstall: false,
            choosing_folder: false,
            show_settings: false,
            stopping: false,
        };
        if launcher.local.is_some() {
            launcher.status = preview_status.into();
        } else if !launcher.store.root().join("manual-updates").exists() {
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
        let local = self.local.clone();
        let (tx, rx) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = cancelled.clone();
        self.operation = Some(Operation {
            action,
            events: rx,
            cancelled,
        });
        self.status_error = false;
        self.status = match action {
            Action::Check => "Checking for updates…",
            Action::Install if local.is_some() => "Verifying the local package…",
            Action::Install => "Downloading the game…",
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
                        let manifest = match fetch_manifest(MANIFEST_URL) {
                            Ok(manifest) => manifest,
                            Err(error)
                                if error
                                    .downcast_ref::<ReleaseHttpStatus>()
                                    .is_some_and(|status| status.0 == 404) =>
                            {
                                let _ = tx.send(Event::Manifest(None));
                                return Ok("No public desktop release is available yet.".into());
                            }
                            Err(error) => return Err(error.context("Could not check for updates")),
                        };
                        manifest.artifact_for(&Target::current()?)?;
                        let up_to_date = store.installed()?.is_some_and(|installed| {
                            version_is_current(&installed.version.0, &manifest.game_version)
                        });
                        let _ = tx.send(Event::Manifest(Some(manifest)));
                        Ok(if up_to_date {
                            "You have the latest game version."
                        } else {
                            "A game release is available."
                        }
                        .into())
                    }
                    Action::Install => {
                        if let Some(package) = &local {
                            store.install_local(package, &worker_cancelled, |progress| {
                                let _ = tx.send(Event::Progress(progress));
                            })?;
                        } else {
                            install(
                                manifest
                                    .as_ref()
                                    .ok_or_else(|| anyhow::anyhow!("Check for a release first"))?,
                            )?;
                        }
                        Ok("Installation verified and ready".into())
                    }
                    Action::Play => {
                        let child = if local.is_some() {
                            store.launch_preview()?
                        } else {
                            store.launch()?
                        };
                        let _ = tx.send(Event::Game(GameProcess(child)));
                        Ok("Game running in your browser".into())
                    }
                    Action::Repair => {
                        if store.verify().is_err() {
                            let installed = store
                                .installed()?
                                .ok_or_else(|| anyhow::anyhow!("No game is installed"))?;
                            if let Some(package) = &local {
                                if package.manifest.game_version != installed.version.0 {
                                    anyhow::bail!("Repair requires local package {}. Use Update to install the newer package.", installed.version.0);
                                }
                                store.install_local(package, &worker_cancelled, |progress| {
                                    let _ = tx.send(Event::Progress(progress));
                                })?;
                                return Ok("Game repaired and verified".into());
                            }
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
        if let Some(operation) = &self.operation {
            loop {
                match operation.events.try_recv() {
                    Ok(Event::Progress(p)) => {
                        self.progress = Some(p);
                        if !operation.cancelled.load(Ordering::Relaxed) {
                            self.status = if p.bytes >= p.total {
                                "Verifying and installing game files…"
                            } else {
                                "Downloading the game…"
                            }
                            .into();
                        }
                        changed = true;
                    }
                    Ok(Event::Manifest(manifest)) => {
                        self.manifest = manifest;
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
            match child.0.try_wait() {
                Ok(Some(status)) => {
                    self.child = None;
                    self.status_error = !(status.success() || self.stopping);
                    self.status = if !self.status_error {
                        "Game stopped.".into()
                    } else {
                        format!("Game exited with {status}. See game.log for details.")
                    };
                    self.stopping = false;
                    changed = true;
                }
                Err(error) => {
                    self.status = format!("Could not read game status: {error}");
                    self.status_error = true;
                    changed = true;
                }
                Ok(None) => {}
            }
        }
        changed
    }

    fn finish(&mut self, result: anyhow::Result<String>) {
        self.status_error = result.is_err();
        self.status = result.unwrap_or_else(|error| format!("{error:#}"));
        match self.store.installed() {
            Ok(installed) => self.installed = installed,
            Err(error) => {
                self.installed = None;
                self.status_error = true;
                self.status = format!("{} · Could not read installation: {error:#}", self.status);
            }
        }
        self.operation = None;
        self.progress = None;
    }
}

impl Drop for Launcher {
    fn drop(&mut self) {
        if let Some(operation) = &self.operation {
            operation.cancelled.store(true, Ordering::Relaxed);
        }
    }
}

fn version_is_current(installed: &str, offered: &str) -> bool {
    match (Version::parse(installed), Version::parse(offered)) {
        (Ok(installed), Ok(offered)) => installed >= offered,
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum ButtonStyle {
    Primary,
    Quiet,
    Danger,
}

fn button(
    id: &'static str,
    label: &'static str,
    enabled: bool,
    style: ButtonStyle,
    cx: &Context<Launcher>,
    action: impl Fn(&mut Launcher, &mut Context<Launcher>) + 'static,
) -> AnyElement {
    let (background, hover, text) = match (style, enabled) {
        (_, false) => (0x242229, 0x242229, 0xa5a0ab),
        (ButtonStyle::Primary, true) => (0xac293c, 0xc7374c, 0xffffff),
        (ButtonStyle::Quiet, true) => (0x302d36, 0x413c49, 0xf3eff3),
        (ButtonStyle::Danger, true) => (0x46242c, 0x65303c, 0xffcbd3),
    };
    let control = div()
        .px_4()
        .py_2()
        .min_h(px(40.))
        .flex()
        .items_center()
        .rounded_md()
        .border_1()
        .border_color(rgb(background))
        .bg(rgb(background))
        .text_color(rgb(text))
        .text_sm()
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .child(label);
    if enabled {
        control
            .id(id)
            .tab_index(0)
            .cursor_pointer()
            .hover(move |element| element.bg(rgb(hover)))
            .focus(|element| element.border_color(rgb(0xf1b2bd)))
            .on_click(cx.listener(move |launcher, _, _, cx| {
                action(launcher, cx);
                cx.notify();
            }))
            .into_any_element()
    } else {
        control.into_any_element()
    }
}

fn version_cell(title: &'static str, value: &str) -> gpui::Div {
    div()
        .flex_1()
        .min_w(px(128.))
        .rounded_md()
        .border_1()
        .border_color(rgb(0x39313b))
        .bg(rgb(0x211d25))
        .px_4()
        .py_3()
        .child(div().text_sm().text_color(rgb(0xbab0c0)).child(title))
        .child(
            div()
                .text_lg()
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child(value.to_owned()),
        )
}

fn progress_panel(progress: Progress) -> gpui::Div {
    let fraction = if progress.total == 0 {
        0.
    } else {
        progress.bytes as f32 / progress.total as f32
    }
    .clamp(0., 1.);
    let size = format!(
        "{:.1} / {:.1} MiB",
        progress.bytes as f64 / 1048576.,
        progress.total as f64 / 1048576.
    );
    let speed = if progress.bytes_per_second == 0 {
        size
    } else {
        format!(
            "{}  ·  {:.1} MiB/s",
            size,
            progress.bytes_per_second as f64 / 1048576.
        )
    };
    div()
        .flex()
        .flex_col()
        .gap_2()
        .child(
            div()
                .h(px(5.))
                .w_full()
                .overflow_hidden()
                .rounded_md()
                .bg(rgb(0x3c323d))
                .child(div().h_full().w(gpui::relative(fraction)).bg(rgb(0xe85167))),
        )
        .child(
            div()
                .flex()
                .justify_between()
                .text_sm()
                .text_color(rgb(0xccc2ce))
                .child(format!("{:.0}%", (fraction * 100.).floor()))
                .child(speed),
        )
}

impl Launcher {
    fn open(&mut self, target: impl AsRef<std::ffi::OsStr>) {
        if let Err(error) = open::that_detached(target) {
            self.status = format!("Could not open the requested location: {error}");
            self.status_error = true;
        }
    }

    fn stop_game(&mut self) {
        if let Some(child) = &mut self.child {
            match child.0.kill() {
                Ok(()) => {
                    self.stopping = true;
                    self.status = "Stopping the game…".into();
                    self.status_error = false;
                }
                Err(error) => {
                    self.status = format!("Could not stop the game: {error}");
                    self.status_error = true;
                }
            }
        }
    }
}

impl Render for Launcher {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        use ButtonStyle::{Danger, Primary, Quiet};
        let preview = self.local.is_some();
        let idle = self.operation.is_none() && !self.choosing_folder;
        let running = self.child.is_some();
        let ready = idle && !running;
        let installed = self.installed.as_ref().map(|i| i.version.0.as_str());
        let latest = self.manifest.as_ref().map(|m| m.game_version.as_str());
        let update = installed
            .zip(latest)
            .is_some_and(|(current, offered)| !version_is_current(current, offered));
        let notes = self
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.release_notes_url.clone());
        let settings = self.show_settings;
        let store = self.store.root().to_path_buf();
        let logs = self.store.logs();
        let auto = !preview && !store.join("manual-updates").exists();
        let cancellable = self.operation.as_ref().is_some_and(|operation| {
            matches!(operation.action, Action::Install | Action::Repair)
                && !operation.cancelled.load(Ordering::Relaxed)
        });
        let address = if preview {
            PREVIEW_ADDRESS
        } else {
            GAME_ADDRESS
        };
        let mode = if preview {
            "Local preview"
        } else {
            "Desktop launcher"
        };
        let text_status = if self.status_error {
            0xffa6b5
        } else {
            0xe4dce7
        };

        let mut actions = div().flex().flex_wrap().items_center().gap_2();
        if running {
            actions = actions
                .child(button(
                    "browser",
                    "Open in browser",
                    !self.stopping,
                    Primary,
                    cx,
                    move |l, _| l.open(format!("http://{address}/")),
                ))
                .child(button(
                    "stop",
                    "Stop game",
                    !self.stopping,
                    Quiet,
                    cx,
                    |l, _| l.stop_game(),
                ));
        } else {
            let (action, title, enabled) = match (installed, update, latest) {
                (None, _, Some(_)) => (Action::Install, "Install game", ready),
                (None, _, None) => (Action::Install, "Install game", false),
                (Some(_), true, _) => (Action::Install, "Install update", ready),
                _ => (Action::Play, "Play game", ready),
            };
            actions = actions.child(button(
                "primary",
                title,
                enabled,
                Primary,
                cx,
                move |l, _| l.run(action),
            ));
            if update {
                actions = actions.child(button(
                    "play-installed",
                    "Play installed",
                    ready,
                    Quiet,
                    cx,
                    |l, _| l.run(Action::Play),
                ));
            }
        }
        if !preview {
            actions = actions.child(button(
                "check",
                "Check for updates",
                idle,
                Quiet,
                cx,
                |l, _| l.run(Action::Check),
            ));
        }
        if let Some(url) = notes {
            actions = actions.child(button(
                "release-notes",
                "Release notes",
                true,
                Quiet,
                cx,
                move |l, _| l.open(&url),
            ));
        }
        if cancellable {
            actions = actions.child(button("cancel", "Cancel", true, Quiet, cx, |l, _| {
                if let Some(operation) = &l.operation {
                    operation.cancelled.store(true, Ordering::Relaxed);
                    l.status = "Cancelling…".into();
                }
            }));
        }

        let mut maintenance = div()
            .flex()
            .flex_wrap()
            .gap_2()
            .child(button(
                "open-install",
                "Installation folder",
                true,
                Quiet,
                cx,
                {
                    let store = store.clone();
                    move |l, _| l.open(&store)
                },
            ))
            .child(button("open-logs", "Logs", true, Quiet, cx, move |l, _| {
                l.open(&logs)
            }));
        if installed.is_some() {
            maintenance = maintenance
                .child(button(
                    "repair",
                    "Verify or repair",
                    ready,
                    Quiet,
                    cx,
                    |l, _| l.run(Action::Repair),
                ))
                .child(button(
                    "uninstall",
                    "Uninstall…",
                    ready,
                    Danger,
                    cx,
                    |l, _| {
                        l.confirm_uninstall = true;
                    },
                ));
        } else if !preview {
            maintenance = maintenance.child(button(
                "choose-folder",
                "Change folder…",
                ready,
                Quiet,
                cx,
                |l, cx| l.choose_folder(cx),
            ));
        }
        if !preview {
            maintenance = maintenance.child(button(
                "startup-checks",
                if auto {
                    "Startup checks on"
                } else {
                    "Startup checks off"
                },
                idle,
                Quiet,
                cx,
                move |l, _| {
                    let switch = l.store.root().join("manual-updates");
                    let result = if auto {
                        std::fs::File::create(switch).map(drop)
                    } else {
                        std::fs::remove_file(switch)
                    };
                    if let Err(error) = result {
                        l.status = format!("Could not save update preferences: {error}");
                        l.status_error = true;
                    }
                },
            ));
        }

        div().size_full().tab_group().id("launcher").track_focus(&self.focus)
            .on_action(cx.listener(|_, _: &FocusNext, window, _| window.focus_next()))
            .on_action(cx.listener(|_, _: &FocusPrevious, window, _| window.focus_prev()))
            .overflow_y_scroll()
            .bg(rgb(0x151219)).text_color(rgb(0xf4ecf3))
            .p_5().flex().flex_col().gap_4()
            .child(div().w_full().flex().flex_col().gap_4().p_5().rounded_lg()
                .border_1().border_color(rgb(0x51303d)).bg(rgb(0x2a1924))
                .child(div().flex().items_center().justify_between().gap_2()
                    .child(div().text_sm().font_weight(gpui::FontWeight::SEMIBOLD).text_color(rgb(0xffbac6)).child(mode))
                    .child(div().text_sm().text_color(rgb(0xd4becd)).child(format!("Launcher {LAUNCHER_VERSION}"))))
                .child(div().text_2xl().font_weight(gpui::FontWeight::BOLD).child("Russian Roulette Revamped"))
                .child(div().flex().flex_wrap().gap_3()
                    .child(version_cell("Installed", installed.unwrap_or("Not installed")))
                    .child(version_cell(if preview { "Local bundle" } else { "Latest release" }, latest.unwrap_or("Unavailable"))))
            )
            .child(div().p_4().rounded_md().border_1().border_color(rgb(0x3a323e)).bg(rgb(0x211b25))
                .flex().flex_col().gap_3()
                .child(div().text_color(rgb(text_status)).child(self.status.clone()))
                .children(self.progress.map(progress_panel))
                .child(actions))
            .child(div().flex().justify_between().items_center().gap_2()
                .child(div().text_sm().text_color(rgb(0xbab0c0)).child(Target::current().map(|t| t.to_string()).unwrap_or_default()))
                .child(button("settings", if settings { "Hide settings" } else { "Settings & files" }, true, Quiet, cx, |l, _| {
                    l.show_settings = !l.show_settings;
                    l.confirm_uninstall = false;
                })))
            .when(settings, |view| {
                view.child(div().p_4().flex().flex_col().gap_3().rounded_md().border_1().border_color(rgb(0x3a323e)).bg(rgb(0x211b25))
                    .child(div().text_sm().text_color(rgb(0xccc2ce)).child(store.display().to_string()))
                    .child(maintenance)
                    .when(self.confirm_uninstall && ready, |settings| {
                        settings.child(div().p_3().rounded_md().bg(rgb(0x39232e)).flex().flex_col().gap_2()
                            .child("Remove the active game files? Your browser settings and logs will stay.")
                            .child(div().flex().flex_wrap().gap_2()
                                .child(button("keep-game", "Keep game", true, Quiet, cx, |l, _| l.confirm_uninstall = false))
                                .child(button("confirm-remove", "Remove game", true, Danger, cx, |l, _| l.run(Action::Uninstall)))))
                    }))
            })
    }
}

struct StartupError(String);

impl Render for StartupError {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .p_6()
            .size_full()
            .bg(rgb(0x151219))
            .text_color(rgb(0xf4ecf3))
            .child(div().text_xl().child("Could not start the launcher"))
            .child(div().mt_3().child(self.0.clone()))
    }
}

fn launch_config() -> anyhow::Result<(Store, Option<LocalPackage>)> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [] => {
            let store = match std::env::var_os("ROULETTE_INSTALL_DIR") {
                Some(path) => Store::new(PathBuf::from(path).join("roulette-revamped"))?,
                None => Store::preferred()?,
            };
            Ok((store, None))
        }
        [flag, directory, version, state] if flag == "--local-package" => {
            let version = Version::parse(
                version
                    .to_str()
                    .ok_or_else(|| anyhow::anyhow!("Preview version must be UTF-8"))?,
            )?;
            let package = LocalPackage::open(Path::new(directory), &version)?;
            let store = Store::new(Path::new(state).join("roulette-preview"))?;
            Ok((store, Some(package)))
        }
        _ => anyhow::bail!(
            "Usage: roulette-launcher [--local-package DIRECTORY VERSION STATE_DIRECTORY]"
        ),
    }
}

fn main() {
    let config = launch_config();
    Application::new().run(move |cx: &mut App| {
        cx.bind_keys([
            KeyBinding::new("tab", FocusNext, None),
            KeyBinding::new("shift-tab", FocusPrevious, None),
        ]);
        let bounds = Bounds::centered(None, size(px(710.), px(535.)), cx);
        let window = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            window_min_size: Some(size(px(420.), px(350.))),
            app_id: Some("io.github.Peter5235252.RouletteRevamped".into()),
            ..Default::default()
        };
        let opened = match config {
            Ok((store, preview)) => cx
                .open_window(window, |window, cx| {
                    window.set_window_title("Russian Roulette Revamped");
                    cx.new(|cx| Launcher::new(store, preview, window, cx))
                })
                .map(drop),
            Err(error) => {
                let message = format!("{error:#}");
                eprintln!("{message}");
                cx.open_window(window, |window, cx| {
                    window.set_window_title("Russian Roulette Revamped");
                    cx.new(|_| StartupError(message))
                })
                .map(drop)
            }
        };
        if let Err(error) = opened {
            eprintln!("Could not open launcher: {error}");
            cx.quit();
        } else {
            cx.on_window_closed(|cx| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
        }
    });
}
