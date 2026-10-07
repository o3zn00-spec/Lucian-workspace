#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod runtime;

use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio},
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, thread, time::{Duration, Instant}};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, menu::{Menu, MenuItem, Submenu}};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn summon(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Default)]
struct Services {
    child: Mutex<Option<Child>>,
    starting: AtomicBool,
    exiting: AtomicBool,
}

fn local_page(name: &str) -> tauri::Url {
    #[cfg(windows)]
    let origin = "http://tauri.localhost";
    #[cfg(not(windows))]
    let origin = "tauri://localhost";
    format!("{origin}/{name}").parse().unwrap()
}

fn stop(services: &Services) {
    if let Some(mut child) = services.child.lock().unwrap().take() {
        if let Some(mut input) = child.stdin.take() { let _ = input.write_all(b"stop\n"); }
        let deadline = Instant::now() + Duration::from_secs(12);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) { return; }
            thread::sleep(Duration::from_millis(100));
        }
        // Only the child handle we created, never a PID obtained from a port.
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn start(app: tauri::AppHandle, services: Arc<Services>) {
    if services.exiting.load(Ordering::SeqCst) || services.starting.swap(true, Ordering::SeqCst) { return; }
    thread::spawn(move || {
        stop(&services);
        let Some(window) = app.get_webview_window("main") else {
            services.starting.store(false, Ordering::SeqCst);
            return;
        };
        let _ = window.navigate(local_page("index.html"));
        let result = (|| -> Result<(), String> {
            // Installed builds cannot fall back to source paths or a PATH executable.
            #[cfg(debug_assertions)]
            let packaged = match std::env::var_os("LUCIAN_DESKTOP_RUNTIME_RESOURCES") {
                Some(path) => Some(runtime::staged(&PathBuf::from(path))?),
                None => None,
            };
            #[cfg(not(debug_assertions))]
            let packaged = Some(runtime::packaged(&app.path().resource_dir().map_err(|_| "Resource path unavailable")?)?);
            let root = packaged.as_ref().map(|r| r.web.clone()).unwrap_or_else(||
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf());
            let node = match &packaged {
                Some(r) => r.node.clone(),
                None => PathBuf::from(std::env::var_os("LUCIAN_DESKTOP_NODE").ok_or("Node runtime not specified")?),
            };
            let mut command = Command::new(node);
            if packaged.is_some() {
                command.env_remove("NODE_OPTIONS").env_remove("NODE_PATH");
            }
            command.arg(root.join("desktop/host.mjs")).current_dir(&root)
                .env("NODE_ENV", "production").env("NEXT_TELEMETRY_DISABLED", "1")
                .env("NEXT_PRIVATE_OUTPUT_TRACE_ROOT", &root)
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            // Serialize creation with shutdown so exit cannot miss a new child.
            let output = {
                let mut owned = services.child.lock().unwrap();
                if services.exiting.load(Ordering::SeqCst) { return Err("Closing".into()); }
                let mut child = command.spawn().map_err(|_| "Cannot start local runtime")?;
                let output = child.stdout.take();
                *owned = Some(child);
                output.ok_or("Missing readiness pipe")?
            };
            let (sender, receiver) = std::sync::mpsc::channel();
            thread::spawn(move || {
                for line in BufReader::new(output).lines().map_while(Result::ok) {
                    if line.len() > 8192 { continue; }
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                        if value["type"] == "desktop-ready" {
                            let _ = sender.send(value["url"].as_str().unwrap_or("").to_string());
                            // Keep draining trusted stdout after readiness. Closing
                            // this pipe would turn a later Next log into EPIPE.
                        }
                    }
                }
            });
            let url = receiver.recv_timeout(Duration::from_secs(60)).map_err(|_| "Readiness timed out")?;
            if url != "http://127.0.0.1:43180" { return Err("Unexpected readiness origin".into()); }
            if services.exiting.load(Ordering::SeqCst) { return Err("Closing".into()); }
            window.navigate(url.parse().unwrap()).map_err(|_| "Navigation failed")?;
            Ok(())
        })();
        if let Err(reason) = result {
            #[cfg(debug_assertions)]
            eprintln!("Native local-runtime startup failed: {reason}");
            stop(&services);
            if !services.exiting.load(Ordering::SeqCst) {
                let _ = window.navigate(local_page("recovery.html"));
            }
        }
        services.starting.store(false, Ordering::SeqCst);
    });
}

fn main() {
    let services = Arc::new(Services::default());
    let setup_services = services.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default()
            // Restore geometry, never reopen invisibly after a tray-only exit.
            .with_state_flags(tauri_plugin_window_state::StateFlags::all()
                & !tauri_plugin_window_state::StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed { summon(app); }
            }).build())
        .setup(move |app| {
            let show = MenuItem::with_id(app, "show", "Show LUCIAN", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide to tray", true, None::<&str>)?;
            let restart = MenuItem::with_id(app, "restart", "Restart local services", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Exit LUCIAN", true, None::<&str>)?;
            // A shortcut conflict must not prevent the app from starting.
            let shortcut_ok = app.global_shortcut().register("Ctrl+Shift+Space").is_ok();
            let shortcut_status = MenuItem::with_id(app, "shortcut-status",
                if shortcut_ok { "Summon: Ctrl+Shift+Space" } else { "Summon shortcut unavailable (already in use)" },
                false, None::<&str>)?;
            let application = Submenu::with_items(app, "Application", true,
                &[&show, &hide, &shortcut_status, &restart, &quit])?;
            app.set_menu(Menu::with_items(app, &[&application])?)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("LUCIAN").inner_size(1440.0, 920.0).min_inner_size(900.0, 640.0)
                .on_navigation(|url| {
                    (url.scheme() == "tauri" && url.host_str() == Some("localhost")) ||
                    (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")) ||
                    (url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(43180))
                }).build()?;
            let tray_menu = Menu::with_items(app, &[&show, &hide, &restart, &quit])?;
            let mut tray = TrayIconBuilder::with_id("lucian")
                .tooltip("LUCIAN • Ctrl+Shift+Space to show")
                .menu(&tray_menu).show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click {
                        button: MouseButton::Left, button_state: MouseButtonState::Up, ..
                    }) { summon(tray.app_handle()); }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            // Hide is explicit. The window close button still exits and stops services.
            tray.build(app)?;
            let state = setup_services.clone();
            app.on_menu_event(move |app, event| match event.id().as_ref() {
                "show" => summon(app),
                "hide" => { if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); } },
                "restart" => start(app.clone(), state.clone()),
                "quit" => app.exit(0),
                _ => (),
            });
            start(app.handle().clone(), setup_services.clone());
            let monitor_state = setup_services.clone();
            let monitor_app = app.handle().clone();
            thread::spawn(move || {
                while !monitor_state.exiting.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(500));
                    if monitor_state.starting.load(Ordering::SeqCst) { continue; }
                    let stopped = {
                        let mut owned = monitor_state.child.lock().unwrap();
                        if owned.as_mut().map(|child| matches!(child.try_wait(), Ok(Some(_)))).unwrap_or(false) {
                            *owned = None;
                            true
                        } else { false }
                    };
                    if stopped {
                        if let Some(window) = monitor_app.get_webview_window("main") {
                            let _ = window.navigate(local_page("recovery.html"));
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!()).expect("LUCIAN native initialization failed")
        .run(move |_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                services.exiting.store(true, Ordering::SeqCst);
                stop(&services);
            }
        });
}
