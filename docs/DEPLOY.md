# Deploying Last Streamgraph

A static SPA served by [`serve`](https://www.npmjs.com/package/serve) under
systemd. These steps assume a fresh Linux server with systemd and root access.
The bundled unit (`deploy/last-streamgraph.service`) expects the app at
`/root/last-streamgraph` and listens on port `8080`.

## 1. Install Node.js (20 or newer)

```bash
# Debian/Ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version   # should print v20+ 
```

## 2. Get the code

```bash
sudo git clone https://github.com/klahr/last-streamgraph.git /root/last-streamgraph
cd /root/last-streamgraph
```

(Or `rsync` your working copy to `/root/last-streamgraph`.)

## 3. Install dependencies and build

```bash
npm ci                 # installs deps + serve, exactly per package-lock.json
npm run build          # type-checks and produces dist/
```

`dist/` now holds the static site, including a default `dist/config.js`
(no baked-in key yet — that comes next).

## 4. (Optional) Bake in a Last.fm API key

So visitors don't need their own key, drop a read-only API key into an env file:

```bash
echo 'LASTFM_API_KEY=your-read-only-api-key' | sudo tee /etc/last-streamgraph.env
sudo chmod 600 /etc/last-streamgraph.env
```

The service regenerates `dist/config.js` from this on every start, so rotating
the key later is just editing this file and restarting — no rebuild.

> The key is served to the browser and is **publicly readable**. Only ever use a
> read-only API key here, never the shared secret. Skip this step entirely to
> have each visitor enter their own key.

## 5. Install and start the service

```bash
sudo cp deploy/last-streamgraph.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now last-streamgraph
sudo systemctl status last-streamgraph --no-pager
```

Verify it's up:

```bash
curl -sI http://localhost:8080/ | head -1          # HTTP/1.1 200 OK
curl -s  http://localhost:8080/config.js           # shows your key (or empty {})
```

## 6. Put it behind TLS (recommended)

`serve` listens on plain HTTP on `:8080`. Front it with a reverse proxy that
terminates HTTPS. Example with Caddy (auto-TLS via Let's Encrypt):

```bash
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
streamgraph.example.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Because the SPA reads the username from the URL path, share links like
`https://streamgraph.example.com/klarre908` work out of the box.

## Updating an existing deployment

```bash
cd /root/last-streamgraph
git pull
npm ci
npm run build
sudo systemctl restart last-streamgraph
```

## Troubleshooting

- **`serve: not found` / service won't start** — run `npm ci` in
  `/root/last-streamgraph`; `serve` is a dev dependency and must be installed.
- **Key not applied** — check `cat /root/last-streamgraph/dist/config.js` after a
  restart; confirm `/etc/last-streamgraph.env` has `LASTFM_API_KEY=...` and that
  the service was restarted (not just the file edited).
- **Logs** — `journalctl -u last-streamgraph -e`.
