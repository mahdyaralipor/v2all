use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub fn binary_name() -> &'static str {
    if cfg!(windows) {
        "xray.exe"
    } else {
        "xray"
    }
}

fn asset() -> Result<&'static str, String> {
    Ok(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "Xray-windows-64.zip",
        ("windows", "aarch64") => "Xray-windows-arm64-v8a.zip",
        ("linux", "x86_64") => "Xray-linux-64.zip",
        ("linux", "aarch64") => "Xray-linux-arm64-v8a.zip",
        ("macos", "x86_64") => "Xray-macOS-64.zip",
        ("macos", "aarch64") => "Xray-macOS-arm64-v8a.zip",
        (os, arch) => return Err(format!("There is no Xray build for {os}/{arch}.")),
    })
}

/// Keep one Xray binary in the app data directory, downloading it on first use.
pub async fn ensure(dir: &Path) -> Result<PathBuf, String> {
    let path = dir.join(binary_name());
    if path.is_file() {
        return Ok(path);
    }
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Couldn't create {}: {error}", dir.display()))?;

    let url = format!(
        "https://github.com/XTLS/Xray-core/releases/latest/download/{}",
        asset()?
    );
    let response = reqwest::Client::builder()
        .user_agent(concat!("v2all/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Couldn't download Xray: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "The Xray download returned {}. Check your connection and try again.",
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("The Xray download was interrupted: {error}"))?
        .to_vec();

    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || extract(&bytes, &target))
        .await
        .map_err(|error| format!("Couldn't unpack Xray: {error}"))??;
    Ok(path)
}

fn extract(bytes: &[u8], target: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|error| format!("The Xray archive is unreadable: {error}"))?;
    let mut entry = archive
        .by_name(binary_name())
        .map_err(|_| format!("{} is missing from the Xray archive.", binary_name()))?;

    let partial = target.with_extension("download");
    {
        let mut file = std::fs::File::create(&partial)
            .map_err(|error| format!("Couldn't write {}: {error}", partial.display()))?;
        std::io::copy(&mut entry, &mut file)
            .map_err(|error| format!("Couldn't unpack Xray: {error}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Couldn't make Xray executable: {error}"))?;
    }
    std::fs::rename(&partial, target)
        .map_err(|error| format!("Couldn't finish installing Xray: {error}"))
}

pub fn start(binary: &Path, config: &Path, log: &Path) -> Result<Child, String> {
    let stdout = std::fs::File::create(log)
        .map_err(|error| format!("Couldn't open {}: {error}", log.display()))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("Couldn't open {}: {error}", log.display()))?;

    let mut command = Command::new(binary);
    command
        .arg("run")
        .arg("-c")
        .arg(config)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|error| format!("Couldn't start Xray: {error}"))
}

/// Last lines of the Xray log, for the error message when it refuses to stay up.
pub fn tail(path: &Path) -> String {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return String::new(),
    };
    let start = bytes.len().saturating_sub(900);
    let text = String::from_utf8_lossy(&bytes[start..]);
    let text = text.trim();
    if text.is_empty() {
        String::new()
    } else {
        format!("Last log: {text}")
    }
}

/// Read back the response that proves the tunnel carries traffic.
pub async fn fetch_through_proxy(url: &str, socks_port: u16) -> Result<(), String> {
    let proxy = reqwest::Proxy::all(format!("socks5h://127.0.0.1:{socks_port}"))
        .map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("it answered {}", response.status()))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn has_an_asset_for_common_targets() {
        assert!(super::asset().is_ok());
    }
}
