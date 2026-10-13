# راهنمای دپلوی · Deploy guide — ASiRi panel

**[فارسی](#fa) · [English](#en)** · [README](README.md) · [`.env.example`](.env.example)

---

<a id="fa"></a>
# 🇮🇷 فارسی

## فهرست
1. [قبل از شروع: چه چیزی لازم است؟](#fa-before)
2. [Railway](#fa-railway)
3. [Render](#fa-render)
4. [VPS با Docker](#fa-vps)
5. [Cloudflare Worker (اختیاری)](#fa-worker)
6. [چک‌لیست بعد از دپلوی](#fa-check)
7. [به‌روزرسانی و پشتیبان‌گیری](#fa-update)
8. [مشکلات رایج](#fa-trouble)

<a id="fa-before"></a>
## قبل از شروع: چه چیزی لازم است؟
- ریپو را در GitHub داشته باشید (Fork یا ریپوی خودتان). ایمیج از `Dockerfile` ریشه‌ی ریپو ساخته می‌شود.
- **حداقل یک رله:** رله‌ی TCP (`RELAY_PORT`) یا دامنه‌ی HTTPS پنل برای VLESS/Trojan. Railway و Render دامنه‌ی HTTPS را خودکار می‌دهند.
- **یک Volume** (Mount path: `/data`) و `TMPDIR=/data/tmp`، وگرنه با هر دپلوی تنظیمات و هویت WARP پاک می‌شود. جزئیات: [README ← ماندگاری و Volume](README.md#fa-persist).
- **رمزها را خودتان بدهید:** `PANEL_PASSWORD` و `SHARE_PASSWORD` طولانی و تصادفی؛ و `SHARE_USERNAME`. رمز اشتراک روی Volume ذخیره نمی‌شود و اگر ندهید، با هر ری‌استارت لینک‌ها عوض می‌شوند.

مقایسه‌ی پلتفرم‌ها:

| | Railway | Render | VPS |
| --- | --- | --- | --- |
| رله‌ی TCP (SOCKS/SS/HTTP) | ✅ با TCP Proxy | ❌ فقط پورت HTTP عمومی است | ✅ |
| رله‌ی WebSocket (VLESS/Trojan) | ✅ | ✅ | ✅ (با reverse proxy) |
| HTTPS خودکار | ✅ | ✅ | با Caddy/Nginx |
| Volume | ✅ | ✅ (نمونه‌ی پولی) | ✅ |

<a id="fa-railway"></a>
## Railway

### ۱) ساخت سرویس
1. **New Project ← Deploy from GitHub repo** و ریپو را انتخاب کنید. Railway خودش `Dockerfile` را پیدا و بیلد می‌کند.
2. در **Settings ← Networking** روی **Generate Domain** بزنید تا دامنه‌ی `*.up.railway.app` ساخته شود (پورت هدف همان `PORT` سرویس است؛ پیش‌فرض `3000`).
3. در **Settings ← Healthcheck Path** مقدار `/healthz` را بگذارید (این مسیر بدون رمز است).

### ۲) Volume
1. روی بوم پروژه **Add Volume** بزنید (Ctrl/⌘+K یا راست‌کلیک) و **سرویس پنل** را انتخاب کنید.
2. **Mount path:** `/data` (نام Volume مهم نیست).

### ۳) متغیرها (Variables)
```
PANEL_USER=admin
PANEL_PASSWORD=یک-رمز-طولانی-و-تصادفی
SHARE_USERNAME=myuser
SHARE_PASSWORD=رمز-اشتراک-طولانی
TMPDIR=/data/tmp
AUTO_START=1
SHARE_AUTO=1
```
متغیرهای `RAILWAY_PUBLIC_DOMAIN` و `RAILWAY_VOLUME_MOUNT_PATH` را خود Railway می‌گذارد. دامنه‌ی عمومی خودکار برای VLESS/Trojan استفاده می‌شود و `INBOUND_PUBLIC_HOST` لازم نیست.

### ۴) رله‌ی TCP (اختیاری، برای SOCKS/Shadowsocks/HTTP)
1. در **Settings ← Networking ← TCP Proxy** پورت **Application port** را بنویسید، مثلاً `1080`.
2. در Variables بگذارید: `RELAY_PORT=1080` (**همان عدد**؛ نباید `PORT` یا `PORT+1` باشد).
3. Railway یک دامنه و پورت تصادفی (مثل `xyz.proxy.rlwy.net:12345`) می‌دهد؛ پنل آن را از `RAILWAY_TCP_PROXY_DOMAIN` و `RAILWAY_TCP_PROXY_PORT` خودکار می‌خواند.

### ۵) Redeploy
بعد از ساخت Volume و تنظیم متغیرها، سرویس را Redeploy کنید. بعد به [چک‌لیست](#fa-check) بروید.

<a id="fa-render"></a>
## Render
Render فقط یک پورت HTTP را عمومی می‌کند؛ پس **فقط رله‌ی WebSocket (VLESS/Trojan)** کار می‌کند و رله‌ی TCP عمومی ندارید. اگر SOCKS/Shadowsocks مستقیم می‌خواهید از Railway یا VPS استفاده کنید.

1. **New ← Web Service**، ریپو را وصل کنید، **Runtime: Docker**.
2. **Health Check Path:** `/healthz`
3. **Environment:**
   ```
   PANEL_USER=admin
   PANEL_PASSWORD=یک-رمز-طولانی-و-تصادفی
   SHARE_USERNAME=myuser
   SHARE_PASSWORD=رمز-اشتراک-طولانی
   TMPDIR=/data/tmp
   AUTO_START=1
   SHARE_AUTO=1
   ```
4. **Disks ← Add Disk:** Name دلخواه، **Mount Path:** `/data`، Size مثلاً ۱ GB. Disk فقط روی نمونه‌های پولی است.
5. دامنه‌ی `*.onrender.com` خودکار از `RENDER_EXTERNAL_HOSTNAME` برداشته می‌شود.
6. Deploy کنید.

> نمونه‌های رایگان Render بعد از بی‌کاری می‌خوابند و تونل قطع می‌شود؛ برای استفاده‌ی واقعی مناسب نیستند.

<a id="fa-vps"></a>
## VPS با Docker
نیاز: Ubuntu/Debian با Docker (BuildKit)، یک دامنه که به IP سرور اشاره کند (رکورد A).

### ۱) اجرای پنل (فقط روی localhost)
```bash
git clone <آدرس-ریپوی-شما> asiri-panel && cd asiri-panel
docker build -t asiri-panel .
docker run -d --name asiri-panel --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -p 1080:1080 \
  -e PANEL_USER=admin \
  -e PANEL_PASSWORD='یک-رمز-طولانی-و-تصادفی' \
  -e SHARE_USERNAME=myuser \
  -e SHARE_PASSWORD='رمز-اشتراک-طولانی' \
  -e RELAY_PORT=1080 \
  -e RELAY_PUBLIC_HOST=panel.example.com \
  -e RELAY_PUBLIC_PORT=1080 \
  -e INBOUND_PUBLIC_HOST=panel.example.com \
  -e AUTO_START=1 -e SHARE_AUTO=1 \
  -v asiri-data:/data -e TMPDIR=/data/tmp \
  asiri-panel
```
- پورت ۳۰۰۰ فقط روی `127.0.0.1` باز است و از بیرون با reverse proxy در دسترس می‌شود.
- `-p 1080:1080` رله‌ی TCP است و باید عمومی باشد. اگر نمی‌خواهید، آن را و `RELAY_*` را حذف کنید.
- `asiri-data` نام دلخواه Volume و `/data` Mount path است.

### ۲) HTTPS با Caddy (ساده‌ترین)
```
panel.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
    }
}
```
Caddy گواهی را خودکار می‌گیرد و WebSocket را بدون تنظیم اضافه پاس می‌دهد. خط `X-Real-IP` مهم است: پنل IP را برای محدودیت ورود از این هدر می‌خواند و نباید کلاینت بتواند آن را جعل کند.

### ۲-ب) یا Nginx
```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;
    # ssl_certificate / ssl_certificate_key (مثلاً با certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 600s;
    }
}
```
هدرهای `Upgrade` و `Connection` برای VLESS/Trojan ضروری‌اند. `X-Forwarded-For` را عمداً با `$remote_addr` جایگزین کردیم، نه اضافه، تا قابل جعل نباشد.

### ۳) فایروال
فقط این‌ها را باز کنید: `22` (SSH)، `80` و `443` (Caddy/Nginx) و `1080` (رله‌ی TCP، اگر استفاده می‌کنید). پورت `3000` را باز نکنید.
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 1080 && ufw enable
```
> Docker قوانین ufw را برای `-p` دور می‌زند. به همین خاطر پنل را با `127.0.0.1:3000:3000` منتشر کردیم.

<a id="fa-worker"></a>
## Cloudflare Worker (اختیاری)
> 📖 راهنمای کامل Worker: [worker/README.md](worker/README.md) · راهنمای دپلوی: [worker/README-DEPLOY.md](worker/README-DEPLOY.md)

برای قراردادن دامنه‌ی Cloudflare جلوی پنل: در `worker/wrangler.toml` مقدار `ORIGIN` را آدرس پنل بگذارید، `WS_PATH` را روی مسیری غیر از مسیر مخفی پنل، و بعد `npx wrangler deploy`. سپس در پنل `INBOUND_PUBLIC_HOST` را روی دامنه‌ی Worker بگذارید. جزئیات: [README ← Cloudflare Worker](README.md#fa-worker).

<a id="fa-check"></a>
## چک‌لیست بعد از دپلوی
1. `https://دامنه/healthz` بدون رمز باید `ok` بدهد.
2. `https://دامنه` رمز می‌خواهد؛ با `PANEL_USER` / `PANEL_PASSWORD` وارد شوید.
3. بنر «Settings and WARP identity will be lost…» **نباید** نمایش داده شود. اگر هست، Volume یا `TMPDIR` درست نیست.
4. تونل را وصل کنید و منتظر **متصل** بمانید.
5. «ساخت آدرس عمومی» را بزنید و لینک‌ها را بگیرید.
6. از ترمینال تست کنید:
   ```bash
   curl --socks5-hostname HOST:PORT --proxy-user USER:PASS https://www.cloudflare.com/cdn-cgi/trace
   ```
7. **تست ماندگاری:** سرویس را ری‌استارت کنید. تنظیمات تونل باید مانده باشد و با `AUTO_START=1` تونل خودش وصل شود. لینک‌ها هم باید همان قبلی باشند (به شرط ست‌بودن `SHARE_*`).

<a id="fa-update"></a>
## به‌روزرسانی و پشتیبان‌گیری
- **Railway/Render:** با push به ریپو خودکار دپلوی می‌شود. Volume دست‌نخورده می‌ماند.
- **VPS:**
  ```bash
  cd asiri-panel && git pull
  docker build -t asiri-panel .
  docker rm -f asiri-panel
  # دوباره همان دستور docker run بالا را اجرا کنید (Volume همان asiri-data است)
  ```
- **نسخه‌ی Aether:** پین‌شده است (`v1.5.0`). برای نسخه‌ی دیگر: `docker build --build-arg AETHER_VERSION=vX.Y.Z -t asiri-panel .`
- **پشتیبان:** فقط پوشه‌ی `/data/tmp/.aether` ارزش دارد (تنظیمات و هویت WARP):
  ```bash
  docker run --rm -v asiri-data:/data -v "$PWD":/backup debian:bookworm-slim \
    tar czf /backup/asiri-data.tgz -C /data .
  ```

<a id="fa-trouble"></a>
## مشکلات رایج

| مشکل | راه‌حل |
| --- | --- |
| بیلد با `unsupported arch` شکست می‌خورد | از BuildKit استفاده کنید (`docker buildx build`) |
| `503` | `PANEL_USER` و `PANEL_PASSWORD` را بگذارید |
| بنر ماندگاری می‌ماند | Mount path و `TMPDIR` را مطابق [README](README.md#fa-persist) بررسی کنید؛ `TMPDIR` باید داخل Mount path باشد |
| لینک‌ها بعد از دپلوی عوض می‌شوند | `SHARE_USERNAME` و `SHARE_PASSWORD` را در Variables بگذارید |
| `No relay is enabled…` | `RELAY_PORT` یا دامنه‌ی HTTPS پنل را تنظیم کنید |
| رله‌ی TCP «منتظر آدرس عمومی» | TCP Proxy را در Railway فعال کنید یا `RELAY_PUBLIC_HOST/PORT` بدهید |
| رله‌ی TCP «خطا» | `RELAY_PORT` برابر `PORT` یا `PORT+1` است یا اشغال است |
| تونل مدام ری‌استارت می‌شود | `INBOUND_PUBLIC_HOST` را بررسی کنید و هدر Upgrade را در reverse proxy پاس بدهید، یا `INBOUND_WS=off` |
| VLESS/Trojan وصل نمی‌شود | اشتراک روشن باشد؛ دامنه روی ۴۴۳ با TLS باشد؛ هدر Upgrade پاس شود |

---

<a id="en"></a>
# 🇬🇧 English

## Contents
1. [Before you start](#en-before)
2. [Railway](#en-railway)
3. [Render](#en-render)
4. [VPS with Docker](#en-vps)
5. [Cloudflare Worker (optional)](#en-worker)
6. [Post-deploy checklist](#en-check)
7. [Updating and backups](#en-update)
8. [Common problems](#en-trouble)

<a id="en-before"></a>
## Before you start
- Have the repo on GitHub (a fork or your own). The image is built from the `Dockerfile` at the repo root.
- **At least one relay:** the TCP relay (`RELAY_PORT`) or the panel's HTTPS domain for VLESS/Trojan. Railway and Render provide the HTTPS domain automatically.
- **A Volume** (mount path `/data`) and `TMPDIR=/data/tmp`, otherwise settings and the WARP identity are wiped on every deploy. Details: [README ← Persistence and Volumes](README.md#en-persist).
- **Set the secrets yourself:** long random `PANEL_PASSWORD` and `SHARE_PASSWORD`, and `SHARE_USERNAME`. Share credentials are not stored on the volume; if you don't set them, links change on every restart.

Platform comparison:

| | Railway | Render | VPS |
| --- | --- | --- | --- |
| TCP relay (SOCKS/SS/HTTP) | ✅ via TCP Proxy | ❌ only the HTTP port is public | ✅ |
| WebSocket relay (VLESS/Trojan) | ✅ | ✅ | ✅ (via reverse proxy) |
| Automatic HTTPS | ✅ | ✅ | via Caddy/Nginx |
| Volume | ✅ | ✅ (paid instance) | ✅ |

<a id="en-railway"></a>
## Railway

### 1) Create the service
1. **New Project ← Deploy from GitHub repo** and pick the repo. Railway finds and builds the `Dockerfile` itself.
2. **Settings ← Networking ← Generate Domain** to get a `*.up.railway.app` domain (the target port is the service's `PORT`; default `3000`).
3. **Settings ← Healthcheck Path:** `/healthz` (unauthenticated).

### 2) Volume
1. On the project canvas choose **Add Volume** (Ctrl/⌘+K or right-click) and select the **panel service**.
2. **Mount path:** `/data` (the volume name doesn't matter).

### 3) Variables
```
PANEL_USER=admin
PANEL_PASSWORD=a-long-random-password
SHARE_USERNAME=myuser
SHARE_PASSWORD=a-long-share-password
TMPDIR=/data/tmp
AUTO_START=1
SHARE_AUTO=1
```
Railway sets `RAILWAY_PUBLIC_DOMAIN` and `RAILWAY_VOLUME_MOUNT_PATH` itself. The automatic public domain is used for VLESS/Trojan, so `INBOUND_PUBLIC_HOST` is not needed.

### 4) TCP relay (optional, for SOCKS/Shadowsocks/HTTP)
1. **Settings ← Networking ← TCP Proxy**: enter the **Application port**, e.g. `1080`.
2. Add the variable `RELAY_PORT=1080` (**the same number**; must not be `PORT` or `PORT+1`).
3. Railway gives you a domain and a random port (like `xyz.proxy.rlwy.net:12345`); the panel reads them from `RAILWAY_TCP_PROXY_DOMAIN` and `RAILWAY_TCP_PROXY_PORT` automatically.

### 5) Redeploy
After creating the volume and setting the variables, redeploy, then follow the [checklist](#en-check).

<a id="en-render"></a>
## Render
Render exposes only one HTTP port publicly, so **only the WebSocket relay (VLESS/Trojan)** works and there is no public TCP relay. If you want plain SOCKS/Shadowsocks use Railway or a VPS.

1. **New ← Web Service**, connect the repo, **Runtime: Docker**.
2. **Health Check Path:** `/healthz`
3. **Environment:**
   ```
   PANEL_USER=admin
   PANEL_PASSWORD=a-long-random-password
   SHARE_USERNAME=myuser
   SHARE_PASSWORD=a-long-share-password
   TMPDIR=/data/tmp
   AUTO_START=1
   SHARE_AUTO=1
   ```
4. **Disks ← Add Disk:** any Name, **Mount Path:** `/data`, Size e.g. 1 GB. Disks are only available on paid instances.
5. The `*.onrender.com` domain is picked up automatically from `RENDER_EXTERNAL_HOSTNAME`.
6. Deploy.

> Free Render instances spin down when idle and cut the tunnel; they are not suitable for real use.

<a id="en-vps"></a>
## VPS with Docker
Requirements: Ubuntu/Debian with Docker (BuildKit) and a domain pointing at the server's IP (A record).

### 1) Run the panel (localhost only)
```bash
git clone <your-repo-url> asiri-panel && cd asiri-panel
docker build -t asiri-panel .
docker run -d --name asiri-panel --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -p 1080:1080 \
  -e PANEL_USER=admin \
  -e PANEL_PASSWORD='a-long-random-password' \
  -e SHARE_USERNAME=myuser \
  -e SHARE_PASSWORD='a-long-share-password' \
  -e RELAY_PORT=1080 \
  -e RELAY_PUBLIC_HOST=panel.example.com \
  -e RELAY_PUBLIC_PORT=1080 \
  -e INBOUND_PUBLIC_HOST=panel.example.com \
  -e AUTO_START=1 -e SHARE_AUTO=1 \
  -v asiri-data:/data -e TMPDIR=/data/tmp \
  asiri-panel
```
- Port 3000 is published on `127.0.0.1` only; the reverse proxy exposes it.
- `-p 1080:1080` is the TCP relay and must be public. If you don't want it, drop it together with the `RELAY_*` variables.
- `asiri-data` is any volume name and `/data` the mount path.

### 2) HTTPS with Caddy (simplest)
```
panel.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
    }
}
```
Caddy obtains the certificate automatically and forwards WebSockets with no extra setup. The `X-Real-IP` line matters: the panel reads the client IP for login rate-limiting from that header, and a client must not be able to forge it.

### 2b) Or Nginx
```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;
    # ssl_certificate / ssl_certificate_key (e.g. via certbot)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 600s;
    }
}
```
The `Upgrade` and `Connection` headers are required for VLESS/Trojan. `X-Forwarded-For` is deliberately replaced with `$remote_addr`, not appended to, so it can't be forged.

### 3) Firewall
Open only: `22` (SSH), `80` and `443` (Caddy/Nginx) and `1080` (TCP relay, if used). Do not open `3000`.
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 1080 && ufw enable
```
> Docker bypasses ufw rules for `-p`; that's why the panel is published as `127.0.0.1:3000:3000`.

<a id="en-worker"></a>
## Cloudflare Worker (optional)
> 📖 Full Worker docs: [worker/README.md](worker/README.md) · Deploy guide: [worker/README-DEPLOY.md](worker/README-DEPLOY.md)

To put a Cloudflare domain in front of the panel: set `ORIGIN` in `worker/wrangler.toml` to the panel URL, `WS_PATH` to a path different from the panel's secret path, then `npx wrangler deploy`. Afterwards set `INBOUND_PUBLIC_HOST` in the panel to the Worker domain. Details: [README ← Cloudflare Worker](README.md#en-worker).

<a id="en-check"></a>
## Post-deploy checklist
1. `https://your-domain/healthz` returns `ok` without a password.
2. `https://your-domain` asks for a login; sign in with `PANEL_USER` / `PANEL_PASSWORD`.
3. The "Settings and WARP identity will be lost…" banner must **not** appear. If it does, the volume or `TMPDIR` is wrong.
4. Connect the tunnel and wait for **connected**.
5. Press "Create public address" and grab the links.
6. Test from a terminal:
   ```bash
   curl --socks5-hostname HOST:PORT --proxy-user USER:PASS https://www.cloudflare.com/cdn-cgi/trace
   ```
7. **Persistence test:** restart the service. The tunnel settings must still be there and, with `AUTO_START=1`, the tunnel reconnects by itself. The links must be unchanged too (provided `SHARE_*` are set).

<a id="en-update"></a>
## Updating and backups
- **Railway/Render:** pushing to the repo redeploys automatically. The volume stays untouched.
- **VPS:**
  ```bash
  cd asiri-panel && git pull
  docker build -t asiri-panel .
  docker rm -f asiri-panel
  # re-run the same docker run command from above (same asiri-data volume)
  ```
- **Aether version:** pinned (`v1.5.0`). For another one: `docker build --build-arg AETHER_VERSION=vX.Y.Z -t asiri-panel .`
- **Backup:** only `/data/tmp/.aether` matters (settings and WARP identity):
  ```bash
  docker run --rm -v asiri-data:/data -v "$PWD":/backup debian:bookworm-slim \
    tar czf /backup/asiri-data.tgz -C /data .
  ```

<a id="en-trouble"></a>
## Common problems

| Problem | Fix |
| --- | --- |
| Build fails with `unsupported arch` | use BuildKit (`docker buildx build`) |
| `503` | set `PANEL_USER` and `PANEL_PASSWORD` |
| Persistence banner stays | check the mount path and `TMPDIR` per the [README](README.md#en-persist); `TMPDIR` must be inside the mount path |
| Links change after a deploy | set `SHARE_USERNAME` and `SHARE_PASSWORD` in the variables |
| `No relay is enabled…` | set `RELAY_PORT` or the panel's HTTPS domain |
| TCP relay "pending" | enable TCP Proxy on Railway or set `RELAY_PUBLIC_HOST/PORT` |
| TCP relay "error" | `RELAY_PORT` equals `PORT` or `PORT+1`, or is in use |
| Tunnel keeps restarting | check `INBOUND_PUBLIC_HOST` and forward the Upgrade header in the reverse proxy, or set `INBOUND_WS=off` |
| VLESS/Trojan won't connect | sharing must be on; the domain must be on 443 with TLS; the Upgrade header must pass |
