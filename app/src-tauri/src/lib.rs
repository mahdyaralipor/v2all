mod links;
mod proxy;
mod xray;

use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Manager, RunEvent, State};

const DATA_URL: &str = "https://mahdyaralipor.github.io/v2all/data.json";
const PROBE_URL: &str = "https://www.gstatic.com/generate_204";

pub struct AppState {
    dir: PathBuf,
    tunnel: Mutex<Option<Tunnel>>,
}

struct Tunnel {
    child: Child,
    previous_proxy: Option<proxy::Previous>,
    host: String,
    port: u16,
    remark: Option<String>,
    since: Instant,
    proxy: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Connection {
    connected: bool,
    host: String,
    port: u16,
    remark: Option<String>,
    since_ms: u64,
    proxy: bool,
    note: Option<String>,
}

impl AppState {
    /// Called once on exit, so closing the window never leaves a stray Xray
    /// process or a machine pointed at a dead port.
    fn shutdown(&self) {
        if let Ok(mut guard) = self.tunnel.lock() {
            if let Some(mut tunnel) = guard.take() {
                let _ = tunnel.child.kill();
                let _ = tunnel.child.wait();
                if let Some(previous) = tunnel.previous_proxy.as_ref() {
                    restore_proxy(&self.dir, previous);
                }
            }
        }
    }
}

const PROXY_BACKUP: &str = "proxy-backup.json";

/// Remember what the system proxy looked like, so an unclean exit can still be
/// repaired on the next launch (the settings are machine-wide).
fn remember_proxy(dir: &std::path::Path, previous: &proxy::Previous) {
    if let Ok(text) = serde_json::to_string(previous) {
        let _ = std::fs::write(dir.join(PROXY_BACKUP), text);
    }
}

fn restore_proxy(dir: &std::path::Path, previous: &proxy::Previous) {
    proxy::restore(previous);
    let _ = std::fs::remove_file(dir.join(PROXY_BACKUP));
}

fn recover_proxy(dir: &std::path::Path) {
    let path = dir.join(PROXY_BACKUP);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    if let Ok(previous) = serde_json::from_str::<proxy::Previous>(&text) {
        proxy::restore(&previous);
    }
    let _ = std::fs::remove_file(path);
}

#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> Result<Value, String> {
    let cache = state.dir.join("data.json");
    match fetch_snapshot().await {
        Ok(value) => {
            if let Ok(text) = serde_json::to_string(&value) {
                let _ = std::fs::write(&cache, text);
            }
            Ok(value)
        }
        // Offline launch is normal on a censored connection: show the last copy.
        Err(error) => {
            let text = std::fs::read_to_string(&cache).map_err(|_| error.clone())?;
            serde_json::from_str(&text).map_err(|_| error)
        }
    }
}

async fn fetch_snapshot() -> Result<Value, String> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("v2all/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?
        .get(DATA_URL)
        .send()
        .await
        .map_err(|error| format!("Couldn't reach the subscription: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("The subscription returned {}.", response.status()));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("The subscription isn't valid JSON: {error}"))
}

#[tauri::command]
async fn test_latency(host: String, port: u16, timeout: u64) -> Option<u64> {
    let target = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    let timeout = timeout.clamp(200, 10_000);
    let started = Instant::now();
    let connect = tokio::net::TcpStream::connect(&target);
    match tokio::time::timeout(Duration::from_millis(timeout), connect).await {
        Ok(Ok(_)) => Some(started.elapsed().as_millis() as u64),
        _ => None,
    }
}

#[tauri::command]
async fn connect(
    state: State<'_, AppState>,
    link: String,
    remark: Option<String>,
    host: String,
    port: u16,
) -> Result<Connection, String> {
    // Parse before touching the running tunnel, so a bad link changes nothing.
    let outbound = links::to_outbound(&link)?;
    stop(&state);

    let dir = state.dir.clone();
    let binary = xray::ensure(&dir).await?;
    let config = dir.join("config.json");
    let log = dir.join("xray.log");
    let document = xray_config(outbound);
    std::fs::write(
        &config,
        serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Couldn't write {}: {error}", config.display()))?;

    let mut child = xray::start(&binary, &config, &log)?;
    tokio::time::sleep(Duration::from_millis(400)).await;
    if let Ok(Some(status)) = child.try_wait() {
        let tail = xray::tail(&log);
        return Err(if tail.is_empty() {
            format!("Xray stopped right after starting ({status}).")
        } else {
            format!("Xray stopped right after starting ({status}). {tail}")
        });
    }

    let mut notes: Vec<String> = Vec::new();
    let previous_proxy = match proxy::enable() {
        Ok(previous) => {
            remember_proxy(&dir, &previous);
            Some(previous)
        }
        Err(error) => {
            notes.push(format!(
                "The tunnel is up, but the system proxy wasn't changed ({error}). \
                 Point your apps at 127.0.0.1:{} (HTTP) or {} (SOCKS).",
                proxy::HTTP_PORT,
                proxy::SOCKS_PORT
            ));
            None
        }
    };

    if let Err(error) = xray::fetch_through_proxy(PROBE_URL, proxy::SOCKS_PORT).await {
        // Keep the promise of the list: a config is only "working" if traffic
        // actually crosses it. Tear down instead of showing a fake Connected.
        let _ = child.kill();
        let _ = child.wait();
        if let Some(previous) = previous_proxy.as_ref() {
            restore_proxy(&dir, previous);
        }
        return Err(format!(
            "The tunnel started, but the server didn't carry traffic ({error}). Try another config."
        ));
    }

    let proxy = previous_proxy.is_some();
    *state
        .tunnel
        .lock()
        .map_err(|_| "The connection state is unavailable.".to_string())? = Some(Tunnel {
        child,
        previous_proxy,
        host: host.clone(),
        port,
        remark: remark.clone(),
        since: Instant::now(),
        proxy,
    });

    Ok(Connection {
        connected: true,
        host,
        port,
        remark,
        since_ms: 0,
        proxy,
        note: (!notes.is_empty()).then(|| notes.join(" ")),
    })
}

fn stop(state: &AppState) {
    let Ok(mut guard) = state.tunnel.lock() else {
        return;
    };
    if let Some(mut tunnel) = guard.take() {
        let _ = tunnel.child.kill();
        let _ = tunnel.child.wait();
        if let Some(previous) = tunnel.previous_proxy.as_ref() {
            restore_proxy(&state.dir, previous);
        }
    }
}

#[tauri::command]
fn disconnect(state: State<'_, AppState>) {
    stop(&state);
}

#[tauri::command]
fn connection_status(state: State<'_, AppState>) -> Option<Connection> {
    let mut guard = state.tunnel.lock().ok()?;
    if let Some(tunnel) = guard.as_mut() {
        if matches!(tunnel.child.try_wait(), Ok(Some(_))) {
            let dead = guard.take()?;
            if let Some(previous) = dead.previous_proxy.as_ref() {
                restore_proxy(&state.dir, previous);
            }
            return None;
        }
    }
    let tunnel = guard.as_ref()?;
    Some(Connection {
        connected: true,
        host: tunnel.host.clone(),
        port: tunnel.port,
        remark: tunnel.remark.clone(),
        since_ms: tunnel.since.elapsed().as_millis() as u64,
        proxy: tunnel.proxy,
        note: None,
    })
}

fn xray_config(outbound: Value) -> Value {
    json!({
        "log": { "loglevel": "warning" },
        "inbounds": [
            {
                "tag": "socks",
                "listen": "127.0.0.1",
                "port": proxy::SOCKS_PORT,
                "protocol": "socks",
                "settings": { "auth": "noauth", "udp": true },
            },
            {
                "tag": "http",
                "listen": "127.0.0.1",
                "port": proxy::HTTP_PORT,
                "protocol": "http",
            },
        ],
        "outbounds": [
            outbound,
            { "tag": "direct", "protocol": "freedom" },
            { "tag": "block", "protocol": "blackhole" },
        ],
        "routing": {
            "domainStrategy": "AsIs",
            "rules": [
                {
                    "type": "field",
                    "ip": [
                        "127.0.0.0/8",
                        "10.0.0.0/8",
                        "172.16.0.0/12",
                        "192.168.0.0/16",
                        "::1/128",
                        "fc00::/7",
                        "fe80::/10"
                    ],
                    "outboundTag": "direct"
                },
            ],
        },
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            recover_proxy(&dir);
            app.manage(AppState {
                dir,
                tunnel: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            test_latency,
            connect,
            disconnect,
            connection_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building v2all")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Some(state) = app.try_state::<AppState>() {
                    state.shutdown();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn published_configs() -> Vec<Value> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/data.json");
        let text = std::fs::read_to_string(path).expect("docs/data.json is part of the repo");
        let data: Value = serde_json::from_str(&text).expect("docs/data.json is valid JSON");
        data["configs"].as_array().cloned().expect("configs array")
    }

    #[test]
    fn config_exposes_local_proxy_ports() {
        let outbound = links::to_outbound(
            "trojan://s3cret@example.org:8443?sni=example.org#node",
        )
        .unwrap();
        let config = xray_config(outbound);
        assert_eq!(config["inbounds"].as_array().unwrap().len(), 2);
        assert_eq!(config["inbounds"][0]["port"], proxy::SOCKS_PORT);
        assert_eq!(config["inbounds"][1]["port"], proxy::HTTP_PORT);
        assert_eq!(config["outbounds"][0]["protocol"], "trojan");
        assert_eq!(config["routing"]["rules"][0]["outboundTag"], "direct");
    }

    #[test]
    fn proxy_backup_round_trips() {
        let previous = proxy::Previous::default();
        let text = serde_json::to_string(&previous).unwrap();
        let restored: proxy::Previous = serde_json::from_str(&text).unwrap();
        assert_eq!(serde_json::to_string(&restored).unwrap(), text);
    }

    #[test]
    fn parses_every_published_link() {
        let configs = published_configs();
        assert!(!configs.is_empty());
        for config in configs {
            let link = config["link"].as_str().unwrap();
            let outbound = links::to_outbound(link)
                .unwrap_or_else(|error| panic!("{} link failed: {error}", config["proto"]));
            assert!(outbound["protocol"].is_string());
        }
    }

    #[test]
    #[ignore = "downloads Xray and opens a real tunnel"]
    fn live_round_trip() {
        // A local VLESS server stands in for a real node, so the test proves the
        // whole client path (link -> config -> Xray -> SOCKS -> TLS -> internet)
        // without depending on whether a free config is still alive.
        let dir = std::env::temp_dir().join("v2all-live-test");
        std::fs::create_dir_all(&dir).unwrap();
        let binary = tauri::async_runtime::block_on(xray::ensure(&dir)).expect("xray binary");

        let id = "11111111-2222-3333-4444-555555555555";
        let server_config = dir.join("server.json");
        let server_log = dir.join("server.log");
        std::fs::write(
            &server_config,
            serde_json::to_vec_pretty(&json!({
                "log": { "loglevel": "warning" },
                "inbounds": [{
                    "listen": "127.0.0.1",
                    "port": 18100,
                    "protocol": "vless",
                    "settings": { "clients": [{ "id": id }], "decryption": "none" }
                }],
                "outbounds": [{ "tag": "direct", "protocol": "freedom" }]
            }))
            .unwrap(),
        )
        .unwrap();

        let client_config = dir.join("config.json");
        let client_log = dir.join("xray.log");
        let link =
            format!("vless://{id}@127.0.0.1:18100?encryption=none&security=none&type=tcp#local");
        let outbound = links::to_outbound(&link).expect("local link parses");
        std::fs::write(
            &client_config,
            serde_json::to_vec_pretty(&xray_config(outbound)).unwrap(),
        )
        .unwrap();

        let mut server =
            xray::start(&binary, &server_config, &server_log).expect("server starts");
        let mut client =
            xray::start(&binary, &client_config, &client_log).expect("client starts");
        let result = tauri::async_runtime::block_on(async {
            tokio::time::sleep(Duration::from_millis(600)).await;
            xray::fetch_through_proxy(PROBE_URL, proxy::SOCKS_PORT).await
        });
        let _ = client.kill();
        let _ = client.wait();
        let _ = server.kill();
        let _ = server.wait();

        result.unwrap_or_else(|error| {
            panic!(
                "{error}\nclient: {}\nserver: {}",
                xray::tail(&client_log),
                xray::tail(&server_log)
            )
        });
    }
}
