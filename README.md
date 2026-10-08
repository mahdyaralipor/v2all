# v2all

[![refresh-sub](https://github.com/mahdyaralipor/v2all/actions/workflows/update-sub.yml/badge.svg)](https://github.com/mahdyaralipor/v2all/actions/workflows/update-sub.yml)

One command to turn public free-V2Ray config lists into a **working subscription**.

## 🚀 Live subscription (auto-refreshed every 6h)

📊 **Dashboard:** https://mahdyaralipor.github.io/v2all/

Paste as subscription in v2rayNG / Hiddify / v2rayN:

```
https://raw.githubusercontent.com/mahdyaralipor/v2all/main/real_sub.txt
```

Run it yourself: `./v2all.py --pool 300 --top 30` — or fork this repo,
then Actions → `refresh-sub` → Run workflow (works on forks too).

```
./v2all.py --pool 300 --top 30
```

## How it works

1. **Fetch** — pulls raw config lists from 22 auto-updated GitHub sources
   (0xRadikal, barry-far, MatinGhanbari, Alirewa, freefq, hamedcode,
   morpheusadam, MahanKenway, Au1rxx — updated every 15 min to daily).
2. **TCP ping** — concurrently dials host:port of ~10k unique configs,
   drops duplicates and non-routable IPs.
3. **Real handshake** — runs each survivor through a local `xray-core`
   instance and fetches a real URL through it. Only configs that actually
   proxy traffic pass. (TCP-open alone is not proof — most free lists are
   >90% dead at this stage.)
4. **Normalize + publish** — rebuilds links in canonical form (fixes the
   `null`-field vmess links that clients silently skip on import) and
   publishes the base64 sub to a secret gist, giving you a stable
   subscription URL.

## Requirements

- Python 3.8+ (stdlib only, no pip packages)
- `curl` (used for the through-proxy probe)
- `gh` CLI logged in (only for the publish step; `--no-publish` skips it)

`xray-core` is downloaded automatically on first run (linux x64/arm64).

## Outputs

| file | what |
|---|---|
| `real_working.txt` / `real_sub.txt` | working configs, plain + base64 sub |
| `working.txt` | TCP-reachable pool (prefilter, not verified) |
| `untested-udp.txt` | hysteria2/tuic links (UDP — can't be TCP-tested) |
| `sub_url.txt` | your stable subscription URL |

Paste `sub_url.txt` as a subscription in v2rayNG / Hiddify / v2rayN,
or import `real_working.txt` from clipboard.

## Notes

- Free configs die fast — re-run every few days. Sources update themselves.
- Latency is measured from *your* network; always run it yourself.
- These are public third-party servers. Don't use them for anything sensitive.

راهنمای فارسی: همین یک دستور را بزن؛ آخرش یک لینک سابسکریپشن آماده می‌گیری که توی v2rayNG یا Hiddify وارد می‌کنی. هر چند روز یک بار دوباره اجراش کن.

## License

MIT
