#!/usr/bin/env python3
"""v2all — one command: fetch free configs -> TCP ping -> real xray handshake -> subscription URL.
Usage: ./v2all.py [--pool 200] [--top 30] [--no-publish]
Outputs: working.txt, working_sub.txt, real_working.txt, real_sub.txt,
         untested-udp.txt, sub_url.txt
"""
import argparse
import base64
import ipaddress
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import parse_qs, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
XRAY = os.path.join(HERE, "bin", "xray")
PROBE = "https://www.gstatic.com/generate_204"

SOURCES = [
    ("0xRadikal", "Free-v2ray-Configs", "top100.txt"),
    ("0xRadikal", "Free-v2ray-Configs", "protocols/vless.txt"),
    ("0xRadikal", "Free-v2ray-Configs", "protocols/vmess.txt"),
    ("0xRadikal", "Free-v2ray-Configs", "protocols/trojan.txt"),
    ("0xRadikal", "Free-v2ray-Configs", "protocols/shadowsocks.txt"),
    ("barry-far", "V2ray-Config", "All_Configs_Sub.txt"),
    ("MatinGhanbari", "v2ray-configs", "subscriptions/v2ray/super-sub.txt"),
    ("Alirewa", "V2ray-Configs", "sub1.txt"),
    ("Alirewa", "V2ray-Configs", "sub2.txt"),
    ("Alirewa", "V2ray-Configs", "sub3.txt"),
    ("Alirewa", "V2ray-Configs", "config.txt"),
    ("freefq", "free", "v2"),
    ("hamedcode", "port-based-v2ray-configs", "sub/vless.txt"),
    ("hamedcode", "port-based-v2ray-configs", "sub/vmess.txt"),
    ("hamedcode", "port-based-v2ray-configs", "sub/trojan.txt"),
    ("hamedcode", "port-based-v2ray-configs", "sub/ss.txt"),
    ("morpheusadam", "v2ray-config", "subs/all.txt"),
    ("MahanKenway", "Freedom-V2Ray", "configs/vless.txt"),
    ("MahanKenway", "Freedom-V2Ray", "configs/vmess.txt"),
    ("MahanKenway", "Freedom-V2Ray", "configs/trojan.txt"),
    ("MahanKenway", "Freedom-V2Ray", "configs/ss.txt"),
    ("Au1rxx", "free-vpn-subscriptions", "output/v2ray-base64.txt"),
]
UDP_PROTOS = {"hysteria2", "hy2", "tuic"}

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m",
     "c": "\033[96m", "b": "\033[1m", "d": "\033[90m", "x": "\033[0m"}


def bar(done, total, extra=""):
    w = 30
    f = int(done / max(total, 1) * w)
    pct = done / max(total, 1) * 100
    return (f"\r{C['c']}[{'█' * f}{'░' * (w - f)}]{C['x']} "
            f"{pct:5.1f}% ({done}/{total}) {extra}")


def b64dec(s):
    s = s.strip().replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def extract_links(text):
    lines = [l.strip() for l in text.splitlines() if "://" in l]
    if lines:
        return lines
    try:
        dec = b64dec(text.strip()).decode("utf-8", "errors")
    except Exception:
        return []
    return [l.strip() for l in dec.splitlines() if "://" in l]


def parse_hostport(hostport):
    hostport = hostport.split("/", 1)[0]
    if ":" not in hostport:
        return None
    host, port = hostport.rsplit(":", 1)
    host = host.strip("[]")
    if not host or not port.isdigit():
        return None
    return host, int(port)


def parse_link(link):
    try:
        scheme = link.split("://", 1)[0].lower()
        if scheme == "vmess":
            d = json.loads(b64dec(link.split("://", 1)[1].split("#", 1)[0].split("?", 1)[0]))
            return scheme, d["add"], int(str(d["port"])), str(d.get("ps", ""))
        body = link.split("://", 1)[1]
        frag = ""
        if "#" in body:
            body, frag = body.split("#", 1)
        if scheme in ("ss", "shadowsocks"):
            if "@" in body:
                _, hostport = body.rsplit("@", 1)
            else:
                txt = b64dec(body.split("?", 1)[0].split("/", 1)[0]).decode("utf-8", "errors")
                if "@" not in txt:
                    return None
                _, hostport = txt.rsplit("@", 1)
            hp = parse_hostport(hostport)
            return (scheme, hp[0], hp[1], frag) if hp else None
        if scheme in ("vless", "trojan", "socks", "socks5", "http",
                      "hysteria2", "hy2", "tuic"):
            u = urlsplit(link.split("#", 1)[0])
            if not u.hostname or not u.port:
                return None
            return scheme, u.hostname, u.port, frag
        return None
    except Exception:
        return None


def normalize_link(link):
    """Rebuild link in canonical form so strict clients import it.
    vmess JSON nulls -> "" (the usual cause of silently-skipped imports).
    Returns normalized link or None. Idempotent for other protos."""
    p = parse_link(link)
    if not p:
        return None
    proto, host, port, remark = p
    if proto == "vmess":
        try:
            d = json.loads(b64dec(link.split("://", 1)[1].split("#", 1)[0].split("?", 1)[0]))

            def s(k, default=""):
                v = d.get(k)
                return default if v is None else str(v)

            aid = s("aid", "0")
            aid = str(int(aid)) if aid.isdigit() else "0"
            out = {"v": "2", "ps": s("ps", remark), "add": s("add", host),
                   "port": s("port", str(port)), "id": s("id"),
                   "aid": aid, "scy": s("scy", "auto") or "auto",
                   "net": s("net", "tcp") or "tcp", "type": s("type", "none") or "none",
                   "host": s("host"), "path": s("path"), "tls": s("tls"),
                   "sni": s("sni"), "alpn": s("alpn"), "fp": s("fp")}
            if not out["id"] or not out["add"]:
                return None
            link = "vmess://" + base64.b64encode(
                json.dumps(out, separators=(",", ":")).encode()).decode()
        except Exception:
            return None
    return link if parse_link(link) else None


def is_routable(host):
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified)


def fetch(owner, repo, path):
    for branch in ("main", "master"):
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "v2all"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("utf-8", "errors")
        except Exception:
            continue
    return None


def tcp_ping(host, port, timeout):
    t0 = time.perf_counter()
    try:
        s = socket.create_connection((host, port), timeout=timeout)
        s.close()
        return (time.perf_counter() - t0) * 1000
    except Exception:
        return None


def tls_settings(q):
    sni = q.get("sni", [""])[0] or q.get("host", [""])[0]
    s = {"serverName": sni}
    if q.get("alpn"):
        s["alpn"] = q["alpn"][0].split(",")
    if q.get("fp"):
        s["fingerprint"] = q["fp"][0]
    return s


def stream_settings(net, security, q):
    st = {"network": net}
    if net == "ws":
        st["wsSettings"] = {"path": q.get("path", ["/"])[0],
                            "headers": {"Host": q["host"][0]} if q.get("host") else {}}
    elif net == "grpc":
        st["grpcSettings"] = {"serviceName": q.get("serviceName", [""])[0]}
    if security == "tls":
        st["security"] = "tls"
        st["tlsSettings"] = tls_settings(q)
    elif security == "reality":
        st["security"] = "reality"
        st["realitySettings"] = {
            "serverName": q.get("sni", [""])[0], "publicKey": q.get("pbk", [""])[0],
            "shortId": q.get("sid", [""])[0], "fingerprint": q.get("fp", ["chrome"])[0]}
    return st


def to_outbound(link):
    scheme = link.split("://", 1)[0].lower()
    body = link.split("://", 1)[1].split("#", 1)[0]
    if scheme == "vmess":
        d = json.loads(b64dec(body.split("?", 1)[0]))
        net = (d.get("net") or "tcp").lower()
        if net not in ("tcp", "ws", "grpc"):
            return None
        q = {"host": [d.get("host", "")], "path": [d.get("path", "")],
             "sni": [d.get("sni") or d.get("host", "")]}
        if d.get("alpn"):
            q["alpn"] = [d["alpn"]]
        if d.get("fp"):
            q["fp"] = [d["fp"]]
        return {"protocol": "vmess", "settings": {
            "vnext": [{"address": d["add"], "port": int(str(d["port"])),
                       "users": [{"id": d["id"], "alterId": int(d.get("aid", 0)),
                                  "security": d.get("scy", "auto")}]}]},
            "streamSettings": stream_settings(
                net, "tls" if (d.get("tls") or "").lower() == "tls" else "none", q)}
    u = urlsplit(link.split("#", 1)[0])
    q = parse_qs(u.query)
    net = q.get("type", ["tcp"])[0].lower()
    sec = q.get("security", ["none"])[0].lower()
    if scheme == "vless":
        if net not in ("tcp", "ws", "grpc") or sec not in ("none", "tls", "reality"):
            return None
        ob = {"protocol": "vless", "settings": {
            "vnext": [{"address": u.hostname, "port": u.port,
                       "users": [{"id": u.username,
                                  "encryption": q.get("encryption", ["none"])[0]}]}]},
              "streamSettings": stream_settings(net, sec, q)}
        if q.get("flow"):
            ob["settings"]["vnext"][0]["users"][0]["flow"] = q["flow"][0]
        return ob
    if scheme == "trojan":
        if net not in ("tcp", "ws", "grpc"):
            return None
        if sec == "none":
            sec = "tls"
        if sec != "tls":
            return None
        return {"protocol": "trojan", "settings": {
            "servers": [{"address": u.hostname, "port": u.port, "password": u.username}]},
            "streamSettings": stream_settings(net, sec, q)}
    if scheme in ("ss", "shadowsocks"):
        nb = body.split("?", 1)[0]
        if "@" in nb:
            userinfo, hostport = nb.rsplit("@", 1)
            try:
                method, password = b64dec(userinfo).decode("utf-8", "errors").split(":", 1)
            except Exception:
                method, password = userinfo.split(":", 1)
        else:
            txt = b64dec(nb.split("/", 1)[0]).decode("utf-8", "errors")
            if "@" not in txt:
                return None
            userinfo, hostport = txt.rsplit("@", 1)
            method, password = userinfo.split(":", 1)
        hp = parse_hostport(hostport)
        if not hp:
            return None
        return {"protocol": "shadowsocks", "settings": {
            "servers": [{"address": hp[0], "port": hp[1],
                         "method": method, "password": password}]}}
    return None


def wait_port(port, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
            return True
        except OSError:
            time.sleep(0.2)
    return False


def real_test(idx, link, timeout, base_port):
    port = base_port + idx
    try:
        ob = to_outbound(link)
    except Exception:
        return ("unsupported", None)
    if ob is None:
        return ("unsupported", None)
    cfg = {"inbounds": [{"port": port, "protocol": "socks",
                         "settings": {"auth": "noauth"}}],
           "outbounds": [ob]}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(cfg, f)
        path = f.name
    proc = subprocess.Popen([XRAY, "run", "-c", path],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not wait_port(port, 6):
            return ("no-inbound", None)
        t0 = time.perf_counter()
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "-x", f"socks5h://127.0.0.1:{port}",
             "--max-time", str(timeout), PROBE],
            capture_output=True, text=True, timeout=timeout + 5)
        ms = (time.perf_counter() - t0) * 1000
        if r.stdout.strip() in ("200", "204"):
            return ("ok", ms)
        return ("failed", None)
    except Exception:
        return ("failed", None)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        os.unlink(path)


def gh_run(*args):
    return subprocess.run(["gh"] + list(args), capture_output=True, text=True)


def latest_xray_tag():
    """Resolve latest Xray-core tag without API (runner IPs are often rate-limited)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(
                "https://github.com/XTLS/Xray-core/releases/latest",
                headers={"User-Agent": "v2all"}), timeout=25) as r:
            tag = r.geturl().rstrip("/").rsplit("/", 1)[-1]
            if tag.startswith("v"):
                return tag
    except Exception:
        pass
    try:
        headers = {"User-Agent": "v2all"}
        tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        with urllib.request.urlopen(urllib.request.Request(
                "https://api.github.com/repos/XTLS/Xray-core/releases/latest",
                headers=headers), timeout=25) as r:
            return json.load(r)["tag_name"]
    except Exception:
        return None


def ensure_xray():
    """Use bundled xray-core, or download it on first run (linux x64/arm64)."""
    if os.path.isfile(XRAY) and os.access(XRAY, os.X_OK):
        return True
    print(f"  {C['y']}xray-core not found, downloading...{C['x']}")
    import zipfile
    machine = {"x86_64": "64", "aarch64": "arm64", "arm64": "arm64"}.get(os.uname().machine)
    if not machine or not sys.platform.startswith("linux"):
        print(f"  {C['r']}auto-download supports linux x64/arm64 only; "
              f"put an xray binary at bin/xray{C['x']}")
        return False
    try:
        tag = latest_xray_tag()
        if not tag:
            raise RuntimeError("could not resolve latest xray-core release")
        os.makedirs(os.path.join(HERE, "bin"), exist_ok=True)
        zpath = os.path.join(HERE, "bin", "xray.zip")
        urllib.request.urlretrieve(
            f"https://github.com/XTLS/Xray-core/releases/download/"
            f"{tag}/Xray-linux-{machine}.zip", zpath)
        with zipfile.ZipFile(zpath) as z:
            z.extract("xray", os.path.join(HERE, "bin"))
        os.remove(zpath)
        os.chmod(XRAY, 0o755)
        print(f"  {C['g']}xray-core {tag} ready{C['x']}")
        return True
    except Exception as e:
        print(f"  {C['r']}download failed:{C['x']} {e}")
        return False


def publish_sub(text, out_dir):
    """Publish base64 sub as a secret gist; return stable raw URL or None.
    Reuses the gist id in <out>/gist_id.txt so the URL never changes."""
    fn = "real_sub.txt"
    id_file = os.path.join(out_dir, "gist_id.txt")
    try:
        if os.path.exists(id_file):
            gid = open(id_file).read().strip()
            r = gh_run("api", "-X", "PATCH", f"gists/{gid}",
                       "-f", f"files[{fn}][content]={text}")
            if r.returncode != 0:
                return None
        else:
            r = gh_run("gist", "create", "--desc",
                       "v2all healthy v2ray sub (auto)",
                       os.path.join(out_dir, fn))
            if r.returncode != 0:
                return None
            gid = r.stdout.strip().splitlines()[-1].rstrip("/").rsplit("/", 1)[-1]
            with open(id_file, "w") as f:
                f.write(gid)
        u = gh_run("api", "user", "--jq", ".login")
        if u.returncode != 0:
            return None
        return (f"https://gist.githubusercontent.com/{u.stdout.strip()}"
                f"/{gid}/raw/{fn}")
    except Exception:
        return None


def ms_color(ms):
    if ms < 600:
        return C["g"]
    if ms < 1000:
        return C["y"]
    return C["r"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", type=int, default=300, help="TCP-best sent to real test")
    ap.add_argument("--top", type=int, default=30, help="final sub size")
    ap.add_argument("--timeout-tcp", type=float, default=4.0)
    ap.add_argument("--timeout-real", type=float, default=8.0)
    ap.add_argument("--workers-tcp", type=int, default=100)
    ap.add_argument("--workers-real", type=int, default=12)
    ap.add_argument("--base-port", type=int, default=22000)
    ap.add_argument("--out", default=HERE)
    ap.add_argument("--no-publish", action="store_true")
    ap.add_argument("--no-color", action="store_true")
    a = ap.parse_args()
    if a.no_color:
        for k in C:
            C[k] = ""
    t_all = time.time()

    # Phase 1: fetch
    print(f"{C['b']}{C['c']}① fetching sources...{C['x']}")
    raw = []
    for owner, repo, path in SOURCES:
        text = fetch(owner, repo, path)
        if text is None:
            print(f"  {C['r']}SKIP{C['x']} {owner}/{repo}/{path}")
            continue
        links = extract_links(text)
        raw.extend(links)
        print(f"  {C['g']}OK{C['x']}   {owner}/{repo}/{path} → {len(links)}")
    print(f"  total raw: {C['b']}{len(raw)}{C['x']}")

    # Phase 2: TCP ping
    seen, uniq, skipped = set(), [], 0
    for l in raw:
        p = parse_link(l)
        if not p:
            skipped += 1
            continue
        if (p[0], p[1], p[2]) in seen:
            continue
        seen.add((p[0], p[1], p[2]))
        uniq.append((l,) + p)
    udp = [u for u in uniq if u[1] in UDP_PROTOS]
    tcp = [u for u in uniq if u[1] not in UDP_PROTOS and is_routable(u[2])]
    print(f"{C['b']}{C['c']}② TCP ping x{len(tcp)}...{C['x']}")
    alive, done = [], 0
    with ThreadPoolExecutor(max_workers=a.workers_tcp) as ex:
        futs = {ex.submit(tcp_ping, u[2], u[3], a.timeout_tcp): u for u in tcp}
        for f in as_completed(futs):
            done += 1
            ms = f.result()
            if ms is not None:
                alive.append(futs[f] + (ms,))
            if done % 100 == 0 or done == len(tcp):
                sys.stdout.write(bar(done, len(tcp), f"{C['g']}alive:{len(alive)}{C['x']}"))
                sys.stdout.flush()
    print()
    alive.sort(key=lambda x: x[-1])
    print(f"  TCP alive: {C['g']}{C['b']}{len(alive)}{C['x']}/{len(tcp)}")

    cand = []
    dropped = 0
    for x in alive[: a.pool]:
        n = normalize_link(x[0])
        if n is None:
            dropped += 1
            continue
        cand.append((n,) + x[1:])
    if dropped:
        print(f"  {C['y']}dropped unimportable: {dropped}{C['x']}")
    with open(f"{a.out}/working.txt", "w") as f:
        f.write("\n".join(x[0] for x in cand) + "\n")
    with open(f"{a.out}/untested-udp.txt", "w") as f:
        f.write("\n".join(x[0] for x in udp) + "\n")

    # Phase 3: real handshake
    print(f"{C['b']}{C['c']}③ real handshake x{len(cand)}...{C['x']}")
    if not ensure_xray():
        print(f"  {C['r']}cannot run real test without xray-core{C['x']}")
        sys.exit(1)
    real, done, nfail = [], 0, 0
    with ThreadPoolExecutor(max_workers=a.workers_real) as ex:
        futs = {ex.submit(real_test, i, x[0], a.timeout_real, a.base_port): x
                for i, x in enumerate(cand)}
        for f in as_completed(futs):
            done += 1
            st, ms = f.result()
            if st == "ok":
                real.append(futs[f] + (ms,))
            else:
                nfail += 1
            if done % 5 == 0 or done == len(cand):
                sys.stdout.write(bar(done, len(cand),
                                     f"{C['g']}real-alive:{len(real)}{C['x']}"))
                sys.stdout.flush()
    print()
    real.sort(key=lambda x: x[-1])
    final, dropped = [], 0
    for x in real:
        n = normalize_link(x[0])
        if n is None:
            dropped += 1
            continue
        final.append((n,) + x[1:])
        if len(final) >= a.top:
            break
    if dropped:
        print(f"  {C['y']}dropped unimportable: {dropped}{C['x']}")
    print(f"  REAL alive: {C['g']}{C['b']}{len(real)}{C['x']}/{len(cand)}")

    sub_b64 = base64.b64encode(("\n".join(x[0] for x in final)).encode()).decode()
    with open(f"{a.out}/real_working.txt", "w") as f:
        f.write("\n".join(x[0] for x in final) + "\n")
    with open(f"{a.out}/real_sub.txt", "w") as f:
        f.write(sub_b64)

    print(f"\n{C['b']}TOP {len(final)}:{C['x']}")
    for x in final:
        print(f"  {ms_color(x[-1])}{x[-1]:7.0f}{C['x']} | {x[1]:6s} | "
              f"{x[2]}:{x[3]} | {C['d']}{x[4][:34]}{C['x']}")

    # Phase 4: publish subscription
    url = None
    if not a.no_publish and final:
        print(f"\n{C['b']}{C['c']}④ publishing subscription...{C['x']}")
        try:
            url = publish_sub(sub_b64, a.out)
            if url:
                with open(f"{a.out}/sub_url.txt", "w") as f:
                    f.write(url + "\n")
                print(f"  {C['g']}uploaded{C['x']}")
            else:
                print(f"  {C['r']}upload rejected{C['x']}")
        except Exception as e:
            print(f"  {C['r']}upload failed:{C['x']} {e}")

    dt = time.time() - t_all
    print(f"\n{C['b']}{C['g']}✔ done in {dt:.0f}s "
          f"| unique:{len(uniq)} TCP:{len(alive)} REAL:{len(real)}{C['x']}")
    if url:
        print(f"{C['b']}{C['y']}★ subscription URL:{C['x']} {C['b']}{url}{C['x']}")
        print(f"  paste it as subscription in v2rayNG / Hiddify / v2rayN")
    else:
        print(f"  import manually: {a.out}/real_working.txt (clipboard) "
              f"or {a.out}/real_sub.txt")


if __name__ == "__main__":
    sys.exit(main())
