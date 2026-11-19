//! System proxy switch. Enabling remembers the previous settings so Disconnect
//! puts the machine back the way it was.

pub const HTTP_PORT: u16 = 10809;
pub const SOCKS_PORT: u16 = 10808;

#[cfg(windows)]
mod platform {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    #[derive(Default)]
    pub struct Previous {
        enabled: u32,
        server: String,
    }

    fn key() -> Result<RegKey, String> {
        RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(KEY)
            .map(|(key, _)| key)
            .map_err(|_| "the Windows proxy registry key isn't writable.".to_string())
    }

    pub fn enable() -> Result<Previous, String> {
        let key = key()?;
        let previous = Previous {
            enabled: key.get_value("ProxyEnable").unwrap_or(0),
            server: key.get_value("ProxyServer").unwrap_or_default(),
        };
        key.set_value("ProxyEnable", &1u32)
            .map_err(|error| format!("couldn't turn the Windows proxy on: {error}"))?;
        key.set_value(
            "ProxyServer",
            &format!("http=127.0.0.1:{};https=127.0.0.1:{}", super::HTTP_PORT, super::HTTP_PORT),
        )
        .map_err(|error| format!("couldn't set the Windows proxy address: {error}"))?;
        refresh();
        Ok(previous)
    }

    pub fn restore(previous: &Previous) {
        let Ok(key) = key() else { return };
        let _ = key.set_value("ProxyEnable", &previous.enabled);
        let _ = key.set_value("ProxyServer", &previous.server);
        refresh();
    }

    fn refresh() {
        use windows_sys::Win32::Networking::WinInet::{
            InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
        };
        unsafe {
            InternetSetOptionW(std::ptr::null(), INTERNET_OPTION_SETTINGS_CHANGED, std::ptr::null(), 0);
            InternetSetOptionW(std::ptr::null(), INTERNET_OPTION_REFRESH, std::ptr::null(), 0);
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::process::Command;

    #[derive(Default)]
    pub struct Previous {
        mode: String,
    }

    fn gsettings(args: &[&str]) -> Result<String, String> {
        let output = Command::new("gsettings")
            .args(args)
            .output()
            .map_err(|_| "gsettings isn't available on this desktop.".to_string())?;
        if !output.status.success() {
            return Err(format!(
                "gsettings {} failed.",
                args.join(" ")
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn apply() -> Result<(), String> {
        for (schema, key, value) in [
            ("org.gnome.system.proxy", "mode", "manual"),
            ("org.gnome.system.proxy.http", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.http", "port", "10809"),
            ("org.gnome.system.proxy.https", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.https", "port", "10809"),
            ("org.gnome.system.proxy.socks", "host", "127.0.0.1"),
            ("org.gnome.system.proxy.socks", "port", "10808"),
        ] {
            gsettings(&["set", schema, key, value])?;
        }
        Ok(())
    }

    pub fn enable() -> Result<Previous, String> {
        let mode = gsettings(&["get", "org.gnome.system.proxy", "mode"])?;
        let mode = mode.trim_matches('\'').to_string();
        if let Err(error) = apply() {
            // Don't leave the desktop half-switched.
            let _ = gsettings(&["set", "org.gnome.system.proxy", "mode", &mode]);
            return Err(error);
        }
        Ok(Previous { mode })
    }

    pub fn restore(previous: &Previous) {
        let mode = if previous.mode.is_empty() {
            "none"
        } else {
            previous.mode.as_str()
        };
        let _ = gsettings(&["set", "org.gnome.system.proxy", "mode", mode]);
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    #[derive(Default)]
    pub struct Previous;

    pub fn enable() -> Result<Previous, String> {
        Err("system proxy switching isn't implemented on this platform.".to_string())
    }

    pub fn restore(_previous: &Previous) {}
}

pub use platform::{enable, restore, Previous};
