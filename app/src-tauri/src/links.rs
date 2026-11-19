use std::collections::HashMap;

use base64::Engine;
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use url::Url;

/// Turn a share link into an Xray-core outbound.
pub fn to_outbound(link: &str) -> Result<Value, String> {
    let link = link.trim();
    let (scheme, rest) = link
        .split_once("://")
        .ok_or_else(|| "That entry isn't a share link.".to_string())?;
    match scheme {
        "vless" => vless(rest),
        "trojan" => trojan(rest),
        "vmess" => vmess(rest),
        "ss" => shadowsocks(rest),
        other => Err(format!("{other} links aren't supported yet.")),
    }
}

fn query(url: &Url) -> HashMap<String, String> {
    url.query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect()
}

fn get<'a>(q: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    q.get(key).map(String::as_str).filter(|value| !value.is_empty())
}

fn vless(rest: &str) -> Result<Value, String> {
    let url = Url::parse(&format!("vless://{rest}")).map_err(|_| "vless link is malformed.".to_string())?;
    let id = percent_decode_str(url.username()).decode_utf8_lossy().into_owned();
    if id.is_empty() {
        return Err("vless link has no user id.".into());
    }
    let host = url.host_str().ok_or("vless link has no server.")?.to_string();
    let port = url.port().ok_or("vless link has no port.")?;
    let q = query(&url);

    let mut user = json!({ "id": id, "encryption": get(&q, "encryption").unwrap_or("none") });
    if let Some(flow) = get(&q, "flow") {
        user["flow"] = json!(flow);
    }

    let mut outbound = json!({
        "protocol": "vless",
        "settings": { "vnext": [{ "address": host, "port": port, "users": [user] }] },
    });
    outbound["streamSettings"] = stream(
        &q,
        get(&q, "type").unwrap_or("tcp"),
        get(&q, "security").unwrap_or("none"),
        &host,
    );
    Ok(outbound)
}

fn trojan(rest: &str) -> Result<Value, String> {
    let url = Url::parse(&format!("trojan://{rest}")).map_err(|_| "trojan link is malformed.".to_string())?;
    let password = percent_decode_str(url.username()).decode_utf8_lossy().into_owned();
    if password.is_empty() {
        return Err("trojan link has no password.".into());
    }
    let host = url.host_str().ok_or("trojan link has no server.")?.to_string();
    let port = url.port().ok_or("trojan link has no port.")?;
    let q = query(&url);

    let mut outbound = json!({
        "protocol": "trojan",
        "settings": { "servers": [{ "address": host, "port": port, "password": password }] },
    });
    outbound["streamSettings"] = stream(
        &q,
        get(&q, "type").unwrap_or("tcp"),
        // Trojan is TLS unless the link says otherwise.
        get(&q, "security").unwrap_or("tls"),
        &host,
    );
    Ok(outbound)
}

fn vmess(rest: &str) -> Result<Value, String> {
    let body = rest.split('#').next().unwrap_or(rest);
    let decoded = decode_base64(body)?;
    let value: Value = serde_json::from_slice(&decoded)
        .map_err(|_| "vmess link isn't valid JSON.".to_string())?;

    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let number = |key: &str| {
        value.get(key).and_then(|raw| {
            raw.as_u64()
                .or_else(|| raw.as_str().and_then(|part| part.parse::<u64>().ok()))
        })
    };

    let host = text("add");
    if host.is_empty() {
        return Err("vmess link has no server.".into());
    }
    let port = number("port").ok_or("vmess link has no port.")? as u16;
    let id = text("id");
    if id.is_empty() {
        return Err("vmess link has no user id.".into());
    }
    let alter_id = number("aid").unwrap_or(0) as u32;
    let cipher = match text("scy").as_str() {
        "" => "auto".to_string(),
        other => other.to_string(),
    };

    let mut outbound = json!({
        "protocol": "vmess",
        "settings": {
            "vnext": [{
                "address": host,
                "port": port,
                "users": [{ "id": id, "alterId": alter_id, "security": cipher }],
            }],
        },
    });

    // Reuse the same stream builder by mapping the vmess fields onto its keys.
    let mut q = HashMap::new();
    for (from, to) in [
        ("host", "host"),
        ("path", "path"),
        ("sni", "sni"),
        ("alpn", "alpn"),
        ("fp", "fp"),
    ] {
        let field = text(from);
        if !field.is_empty() {
            q.insert(to.to_string(), field);
        }
    }
    if text("type") == "http" {
        q.insert("headerType".into(), "http".into());
    }
    let network = match text("net").as_str() {
        "" => "tcp".to_string(),
        other => other.to_string(),
    };
    let security = match text("tls").as_str() {
        "tls" | "xtls" => "tls",
        _ => "none",
    };
    outbound["streamSettings"] = stream(&q, &network, security, &host);
    Ok(outbound)
}

fn shadowsocks(rest: &str) -> Result<Value, String> {
    if rest.contains("plugin=") {
        return Err("Shadowsocks links with a plugin aren't supported yet.".into());
    }
    let body = rest.split('#').next().unwrap_or(rest);
    let body = body.split('?').next().unwrap_or(body);

    let (userinfo, hostport) = match body.rsplit_once('@') {
        Some((user, server)) => (user.to_string(), server.to_string()),
        None => {
            let decoded = String::from_utf8(decode_base64(body)?)
                .map_err(|_| "ss link isn't valid base64.".to_string())?;
            let (user, server) = decoded
                .rsplit_once('@')
                .ok_or("ss link has no server.")?;
            (user.to_string(), server.to_string())
        }
    };

    let userinfo = percent_decode_str(&userinfo).decode_utf8_lossy().into_owned();
    let credentials = if userinfo.contains(':') {
        userinfo
    } else {
        String::from_utf8(decode_base64(&userinfo)?)
            .map_err(|_| "ss credentials aren't valid base64.".to_string())?
    };
    let (method, password) = credentials
        .split_once(':')
        .ok_or("ss link has no method and password.")?;

    let url = Url::parse(&format!("ss://{hostport}"))
        .map_err(|_| "ss link has no valid server address.".to_string())?;
    let host = url.host_str().ok_or("ss link has no server.")?.to_string();
    let port = url.port().ok_or("ss link has no port.")?;

    Ok(json!({
        "protocol": "shadowsocks",
        "settings": {
            "servers": [{ "address": host, "port": port, "method": method, "password": password }],
        },
        "streamSettings": { "network": "tcp" },
    }))
}

fn stream(q: &HashMap<String, String>, network: &str, security: &str, address: &str) -> Value {
    let mut settings = json!({ "network": network, "security": security });
    let server_name = get(q, "sni").or_else(|| get(q, "host")).unwrap_or(address);
    let host_header = get(q, "host").unwrap_or(address);

    match security {
        "tls" | "xtls" => {
            let mut tls = json!({
                "serverName": server_name,
                "allowInsecure": matches!(get(q, "allowInsecure").or_else(|| get(q, "insecure")), Some("1") | Some("true")),
            });
            if let Some(fingerprint) = get(q, "fp") {
                tls["fingerprint"] = json!(fingerprint);
            }
            if let Some(alpn) = get(q, "alpn") {
                let list: Vec<&str> = alpn.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
                if !list.is_empty() {
                    tls["alpn"] = json!(list);
                }
            }
            settings["tlsSettings"] = tls;
        }
        "reality" => {
            let mut reality = json!({
                "serverName": get(q, "sni").unwrap_or(address),
                "fingerprint": get(q, "fp").unwrap_or("chrome"),
                "publicKey": get(q, "pbk").unwrap_or_default(),
                "shortId": get(q, "sid").unwrap_or_default(),
            });
            if let Some(spider) = get(q, "spx") {
                reality["spiderX"] = json!(spider);
            }
            settings["realitySettings"] = reality;
        }
        _ => {}
    }

    match network {
        "ws" => {
            settings["wsSettings"] = json!({
                "path": get(q, "path").unwrap_or("/"),
                "host": host_header,
            });
        }
        "grpc" => {
            settings["grpcSettings"] = json!({ "serviceName": get(q, "serviceName").unwrap_or_default() });
        }
        "h2" | "http" => {
            settings["httpSettings"] = json!({
                "path": get(q, "path").unwrap_or("/"),
                "host": [host_header],
            });
        }
        "tcp" => {
            if get(q, "headerType") == Some("http") {
                settings["tcpSettings"] = json!({
                    "header": {
                        "type": "http",
                        "request": {
                            "path": [get(q, "path").unwrap_or("/")],
                            "headers": { "Host": [host_header] },
                        },
                    },
                });
            }
        }
        _ => {}
    }

    settings
}

fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    let engines = [
        base64::engine::general_purpose::STANDARD,
        base64::engine::general_purpose::STANDARD_NO_PAD,
        base64::engine::general_purpose::URL_SAFE,
        base64::engine::general_purpose::URL_SAFE_NO_PAD,
    ];
    for engine in engines {
        if let Ok(bytes) = engine.decode(text.trim()) {
            return Ok(bytes);
        }
    }
    Err("That link isn't valid base64.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vless_ws_tls() {
        let outbound = to_outbound(
            "vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&security=tls&type=ws&host=cdn.example.com&path=%2Fws&sni=cdn.example.com&fp=chrome#node",
        )
        .unwrap();
        assert_eq!(outbound["protocol"], "vless");
        let server = &outbound["settings"]["vnext"][0];
        assert_eq!(server["address"], "example.com");
        assert_eq!(server["port"], 443);
        assert_eq!(server["users"][0]["id"], "11111111-2222-3333-4444-555555555555");
        let stream = &outbound["streamSettings"];
        assert_eq!(stream["network"], "ws");
        assert_eq!(stream["security"], "tls");
        assert_eq!(stream["wsSettings"]["path"], "/ws");
        assert_eq!(stream["wsSettings"]["host"], "cdn.example.com");
        assert_eq!(stream["tlsSettings"]["serverName"], "cdn.example.com");
        assert_eq!(stream["tlsSettings"]["fingerprint"], "chrome");
    }

    #[test]
    fn trojan_defaults_to_tls() {
        let outbound = to_outbound("trojan://s3cret@example.org:8443?sni=example.org#node").unwrap();
        assert_eq!(outbound["protocol"], "trojan");
        assert_eq!(outbound["settings"]["servers"][0]["password"], "s3cret");
        assert_eq!(outbound["streamSettings"]["security"], "tls");
        assert_eq!(outbound["streamSettings"]["tlsSettings"]["serverName"], "example.org");
    }

    #[test]
    fn vmess_tcp_without_tls() {
        let payload = base64::engine::general_purpose::STANDARD.encode(
            json!({
                "v": "2", "ps": "node", "add": "10.0.0.1", "port": "8080",
                "id": "11111111-2222-3333-4444-555555555555", "aid": "0",
                "scy": "auto", "net": "tcp", "type": "none", "host": "", "path": "",
                "tls": "", "sni": "", "alpn": "", "fp": "",
            })
            .to_string(),
        );
        let outbound = to_outbound(&format!("vmess://{payload}")).unwrap();
        assert_eq!(outbound["protocol"], "vmess");
        let server = &outbound["settings"]["vnext"][0];
        assert_eq!(server["address"], "10.0.0.1");
        assert_eq!(server["port"], 8080);
        assert_eq!(server["users"][0]["alterId"], 0);
        assert_eq!(outbound["streamSettings"]["security"], "none");
    }

    #[test]
    fn shadowsocks_sip002() {
        let userinfo = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode("aes-256-gcm:pa%ss".replace('%', ""));
        let outbound =
            to_outbound(&format!("ss://{userinfo}@example.net:8388#node")).unwrap();
        assert_eq!(outbound["protocol"], "shadowsocks");
        let server = &outbound["settings"]["servers"][0];
        assert_eq!(server["address"], "example.net");
        assert_eq!(server["port"], 8388);
        assert_eq!(server["method"], "aes-256-gcm");
        assert_eq!(server["password"], "pass");
    }

    #[test]
    fn rejects_unknown_scheme() {
        assert!(to_outbound("wireguard://nope").is_err());
        assert!(to_outbound("not a link").is_err());
    }
}
