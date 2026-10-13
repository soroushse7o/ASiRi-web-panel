# ASiRi panel — Deploy guide · راهنمای دپلوی

**[فارسی](#fa) · [English](#en)**

> Full documentation: [README.md](README.md) · Variable reference: [.env.example](.env.example)
> مستندات کامل: [README.md](README.md) · مرجع متغیرها: [.env.example](.env.example)

---

<a id="fa"></a>
# 🇮🇷 فارسی

## قبل از شروع

**پیش‌نیاز:** ریپو روی GitHub خودتان (Fork یا Push) و یکی از این‌ها: حساب Railway، حساب Render (پلن **پولی**) یا یک VPS با Docker.

**کدام پلتفرم؟**

| | Railway | Render | VPS با Docker |
| --- | --- | --- | --- |
| رله‌ی TCP (`host:port` ثابت) | ✅ با TCP Proxy | ❌ ندارد | ✅ با `RELAY_PORT` |
| رله‌ی WebSocket (VLESS/Trojan روی ۴۴۳) | ✅ دامنه‌ی خودکار | ✅ دامنه‌ی خودکار | ✅ با دامنه و reverse proxy |
| ماندگاری | Volume | Disk (پولی) | Docker volume |
| هزینه | طبق پلن | پلن رایگان نمی‌شود (می‌خوابد و تونل قطع می‌شود) | هزینه‌ی سرور |

**سه تصمیم قبل از دپلوی:**
1. **دو رمز طولانی و تصادفی** بسازید: یکی برای ورود به پنل (`PANEL_PASSWORD`) و یکی برای اشتراک (`SHARE_PASSWORD`).
2. **`SHARE_USERNAME` و `SHARE_PASSWORD` را حتماً در متغیرهای محیطی بگذارید.** تنظیمات اشتراک روی دیسک ذخیره نمی‌شود؛ بدون این دو متغیر با هر ری‌استارت نام کاربری و رمز تصادفی عوض می‌شود و همه‌ی لینک‌ها (از جمله VLESS/Trojan) از کار می‌افتند. نام کاربری ۳ تا ۳۲ و رمز ۸ تا ۶۴ کاراکتر از `A-Za-z0-9._~-` باشد.
3. **Volume بسازید** و `TMPDIR` را روی آن بگذارید تا تنظیمات تونل، آخرین کانفیگ سالم و نتیجه‌ی «بهترین کانفیگ» بعد از ری‌استارت بمانند.

## ۱) Railway — گام‌به‌گام

> نام منوها ممکن است با به‌روزرسانی Railway کمی فرق کند.

### ۱.۱ سرویس
1. **New Project ← Deploy from GitHub repo** و ریپو را انتخاب کنید. `Dockerfile` ریشه خودکار شناسایی می‌شود.
2. Start Command را **عوض نکنید**؛ ایمیج با `server.mjs` (همان `next start` به‌علاوه‌ی هوک WebSocket) راه می‌افتد.
3. در **Variables** این‌ها را بگذارید:

| متغیر | الزامی؟ | مقدار |
| --- | --- | --- |
| `PANEL_USER`، `PANEL_PASSWORD` | ✅ | ورود به پنل (بدون آن پنل `503` می‌دهد) |
| `SHARE_USERNAME`، `SHARE_PASSWORD` | ✅ توصیه‌ی جدی | برای لینک‌های ثابت (بالا را ببینید) |
| `TMPDIR` | ✅ توصیه می‌شود | `/data/tmp` (بعد از ساخت Volume) |
| `AUTO_START` | توصیه می‌شود | `1` — اتصال خودکار تونل بعد از هر ری‌استارت |
| `SHARE_AUTO` | توصیه می‌شود | `1` — رله‌ها با اتصال تونل روشن شوند |
| `RELAY_PORT` | برای رله‌ی TCP | `1080` (هر پورت آزاد به‌جز `PORT` و `PORT+1`؛ از `1819` و `1820` هم استفاده نکنید) |
| `SHARE_PROTOCOLS` | اختیاری | `socks,http,ss` (پیش‌فرض). فقط رمزنگاری‌شده: `ss` |
| `INBOUND_WS` | اختیاری | `vless,trojan` (پیش‌فرض)، یکی از دو، یا `off` |
| `INBOUND_WS_PATH` | اختیاری | مسیر دلخواه WebSocket، مثل `/my-secret-path` |
| `NOTIFY_*` | اختیاری | بخش اعلان‌ها در `.env.example` |

4. **Settings ← Networking ← Generate Domain** برای پنل. پورت هدف دامنه باید برابر `PORT` سرویس باشد؛ Railway خودش `PORT` را تزریق می‌کند (پیش‌فرض ایمیج ۳۰۰۰ است). بعد از ساخت دامنه، Railway متغیر `RAILWAY_PUBLIC_DOMAIN` را تزریق می‌کند و پنل آن را برای لینک‌های VLESS/Trojan می‌خواند.

### ۱.۲ Volume (ماندگاری)
**Settings ← Volumes ← New Volume** را روی مسیر `/data` بسازید و `TMPDIR=/data/tmp` را بگذارید. بدون آن با هر ری‌استارت این‌ها پاک می‌شود و پنل بنر `Settings and WARP identity will be lost on restart.` نشان می‌دهد:
- تنظیمات تونل، آخرین کانفیگ سالم و برنده‌ی «بهترین کانفیگ» (`tunnel-config.json`)
- هویت WARP

> نام کاربری و رمز اشتراک در هر حالت فقط از متغیرهای محیطی خوانده می‌شوند و روی Volume ذخیره نمی‌شوند.

### ۱.۳ TCP Proxy (آدرس ثابت `host:port`)
1. **Settings ← Networking ← TCP Proxy ← Add**.
2. «Application port» را برابر `RELAY_PORT` (مثلاً `1080`) بگذارید.
3. Railway این متغیرها را خودش تزریق می‌کند و پنل آن‌ها را می‌خواند؛ چیزی لازم نیست کپی کنید: `RAILWAY_TCP_PROXY_DOMAIN`، `RAILWAY_TCP_PROXY_PORT`، `RAILWAY_TCP_APPLICATION_PORT`.
4. **Redeploy** کنید.
5. اگر `RELAY_PORT` را نگذارید ولی TCP Proxy فعال باشد، `RAILWAY_TCP_APPLICATION_PORT` استفاده می‌شود.

### ۱.۴ راه‌اندازی در پنل
1. دامنه‌ی Railway را باز کنید و وارد شوید.
2. تونل را وصل کنید (با `AUTO_START=1` خودش وصل می‌شود).
3. «ساخت آدرس عمومی» را بزنید (با `SHARE_AUTO=1` خودکار است).
4. در کارت اشتراک، لینک‌های رله‌ی TCP (`ASiRi-Railway`) و دامنه‌ی پنل (VLESS/Trojan) را برای کلاینت بردارید.

### ۱.۵ VLESS / Trojan روی WebSocket
نیاز به تنظیم اضافه ندارد: دامنه‌ی Railway پنل، upgrade وب‌سوکت را با TLS لبه روی ۴۴۳ حمل می‌کند. اشتراک را روشن کنید و لینک `vless://` یا `trojan://` را بردارید. فقط TCP (بدون UDP و mux).

### ۱.۶ چک‌لیست بعد از دپلوی
- [ ] `https://<دامنه>/healthz` پاسخ `ok` می‌دهد (بدون رمز)
- [ ] ورود به پنل با رمز کار می‌کند
- [ ] بنر ماندگاری دیده نمی‌شود
- [ ] وضعیت **متصل** است و IP خروجی نمایش داده می‌شود
- [ ] رله‌ی TCP در حالت **فعال** است (نه «منتظر آدرس عمومی» یا «خطا»)
- [ ] لینک را در یک کلاینت امتحان کردید
- [ ] بعد از یک Redeploy، تونل خودش وصل شد و لینک‌ها عوض نشدند

## ۲) Render

1. **New ← Web Service**، Runtime = **Docker**، ریپو را وصل کنید.
2. Instance Type باید **پولی** باشد (پلن رایگان سرویس را می‌خواباند و تونل قطع می‌شود).
3. Environment: `PANEL_USER`، `PANEL_PASSWORD`، `SHARE_USERNAME`، `SHARE_PASSWORD`، `TMPDIR=/data/tmp` و در صورت نیاز `AUTO_START=1`، `SHARE_AUTO=1`.
4. **Advanced ← Health Check Path:** `/healthz`.
5. **Disk** روی `/data` بسازید (برای ماندگاری؛ نیازمند پلن پولی).
6. دامنه‌ی `*.onrender.com` برای VLESS/Trojan از `RENDER_EXTERNAL_HOSTNAME` خودکار شناسایی می‌شود. اگر دامنه‌ی اختصاصی وصل کرده‌اید، `INBOUND_PUBLIC_HOST` را روی آن بگذارید.

> Render **TCP Proxy ندارد.** روی Render فقط رله‌ی WebSocket (VLESS/Trojan) کار می‌کند و `RELAY_PORT` به کار نمی‌آید. رله‌ی TCP را روی Railway یا VPS خودتان اجرا کنید.

## ۳) VPS با Docker

### ۳.۱ فایل‌ها
کنار ریپو یک فایل `.env` بسازید (و آن را commit نکنید):
```bash
PANEL_PASSWORD=رمز-طولانی-پنل
SHARE_USERNAME=myuser
SHARE_PASSWORD=رمز-طولانی-اشتراک
RELAY_PUBLIC_HOST=YOUR.SERVER.IP.OR.DOMAIN
PANEL_DOMAIN=panel.example.com
```
و `docker-compose.yml`:
```yaml
services:
  asiri-panel:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"   # پنل؛ فقط از طریق reverse proxy در دسترس باشد
      - "1080:1080"             # رله‌ی TCP (در صورت استفاده از RELAY_PORT)
    environment:
      PANEL_USER: admin
      PANEL_PASSWORD: ${PANEL_PASSWORD}
      TMPDIR: /data/tmp
      AUTO_START: "1"
      SHARE_AUTO: "1"
      SHARE_USERNAME: ${SHARE_USERNAME}
      SHARE_PASSWORD: ${SHARE_PASSWORD}
      RELAY_PORT: "1080"
      RELAY_PUBLIC_HOST: ${RELAY_PUBLIC_HOST}   # خارج از Railway الزامی است
      RELAY_PUBLIC_PORT: "1080"
      INBOUND_PUBLIC_HOST: ${PANEL_DOMAIN}      # دامنه‌ی HTTPS شما برای VLESS/Trojan
    volumes:
      - asiri-data:/data
volumes:
  asiri-data:
```
اجرا: `docker compose up -d --build`

- اگر رمز پنل علامت `$` دارد، در `.env` آن را `$$` بنویسید.
- نیازی به رله‌ی TCP ندارید؟ خط `1080` و متغیرهای `RELAY_*` را حذف کنید.
- دامنه‌ی HTTPS ندارید؟ `INBOUND_PUBLIC_HOST` را حذف و `INBOUND_WS: "off"` اضافه کنید تا رله‌ی WebSocket خاموش بماند. دامنه‌ی اشتباه یا نرسیده به این پنل باعث شکست health check عمومی و ری‌استارت‌های پشت‌سرهم تونل می‌شود. در این حالت پنل را با تونل SSH باز کنید: `ssh -L 3000:127.0.0.1:3000 user@server` و سپس `http://localhost:3000`.

### ۳.۲ HTTPS برای پنل و VLESS/Trojan
reverse proxy باید **WebSocket Upgrade** را به پورت ۳۰۰۰ پاس بدهد و پنل از `X-Real-IP` یا `X-Forwarded-For` برای محدودیت ورود استفاده می‌کند.

Caddy (Upgrade و `X-Forwarded-For` را خودش مدیریت می‌کند):
```
panel.example.com {
    reverse_proxy 127.0.0.1:3000
}
```
Nginx (داخل بلوک `server` با گواهی TLS):
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
}
```
لینک‌های VLESS/Trojan همیشه روی پورت `443` با TLS ساخته می‌شوند؛ پس دامنه باید روی ۴۴۳ با TLS جواب بدهد.

### ۳.۳ فایروال
- پورت `RELAY_PORT` از اینترنت باز است و تنها محافظ آن نام کاربری/رمز است. رمز قوی بگذارید یا فقط Shadowsocks را فعال کنید: `SHARE_PROTOCOLS=ss`.
- پورت‌های ۸۰ و ۴۴۳ برای reverse proxy باز باشند. پورت ۳۰۰۰ را مستقیم باز نکنید.

### ۳.۴ بدون compose
```bash
docker build -t asiri-panel .
docker run -d --name asiri-panel --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -p 1080:1080 \
  -e PANEL_USER=admin -e PANEL_PASSWORD='رمز-طولانی' \
  -e AUTO_START=1 -e SHARE_AUTO=1 \
  -e SHARE_USERNAME=myuser -e SHARE_PASSWORD='رمز-اشتراک-طولانی' \
  -e RELAY_PORT=1080 -e RELAY_PUBLIC_HOST=YOUR.SERVER.IP.OR.DOMAIN -e RELAY_PUBLIC_PORT=1080 \
  -e INBOUND_PUBLIC_HOST=panel.example.com \
  -v asiri-data:/data -e TMPDIR=/data/tmp \
  asiri-panel
```
ایمیج برای `amd64` و `arm64` ساخته می‌شود و به BuildKit نیاز دارد (در Docker جدید پیش‌فرض است).

## ۴) نسخه‌ی Aether
در `Dockerfile` نسخه پین است: `ARG AETHER_VERSION=v1.5.0`. checksum آن هنگام بیلد بررسی می‌شود و کارت نصب داخل پنل هم همان نسخه را می‌گیرد.
- محلی: `docker build --build-arg AETHER_VERSION=vX.Y.Z -t asiri-panel .`
- Railway: `AETHER_VERSION` را به‌عنوان Variable سرویس اضافه کنید و Redeploy کنید.

## ۵) به‌روزرسانی پنل
تغییرات را در ریپو push کنید (Railway/Render خودکار دوباره می‌سازند) یا روی VPS `git pull && docker compose up -d --build` بزنید. اگر Volume دارید، تنظیمات تونل می‌ماند؛ با `AUTO_START=1` تونل و با `SHARE_*` لینک‌ها هم همان می‌مانند.

## ۶) اعلان‌ها
Webhook (`NOTIFY_WEBHOOK_URL`) و/یا تلگرام (`NOTIFY_TELEGRAM_BOT_TOKEN` + `NOTIFY_TELEGRAM_CHAT_ID`). رویدادها: `tunnel_down`، `subscription_changed`، `relay_error`؛ تکرار تا `NOTIFY_COOLDOWN_SEC` ارسال نمی‌شود. پیام `subscription_changed` شامل نام کاربری، رمز و لینک‌هاست؛ فقط به کانال خصوصی بفرستید.

## ۷) بررسی محلی پیش از دپلوی
```bash
npm test                 # Node 22+؛ نیازی به نصب وابستگی ندارد
pnpm install && pnpm typecheck
docker build -t asiri-panel .
```

## ۸) Cloudflare Worker (اختیاری)
`worker/` یک Worker مستقل برای قرار گرفتن جلوی پنل یا پل WebSocket به TCP است. مقدارهای `[vars]` در `worker/wrangler.toml` ساختگی‌اند و باید قبل از `npx wrangler deploy` عوض شوند. توضیح کامل: README.md ← «Cloudflare Worker».

## مشکل دارید؟
جدول عیب‌یابی در [README.md](README.md#fa-trouble). پرتکرارترین‌ها: `503` (نبودن `PANEL_USER`/`PANEL_PASSWORD`)، `No relay is enabled…` (نه `RELAY_PORT` و نه دامنه‌ی HTTPS)، تغییر لینک‌ها بعد از ری‌استارت (نبودن `SHARE_*`) و ری‌استارت‌های پشت‌سرهم تونل (دامنه‌ی عمومی اشتباه).

---

<a id="en"></a>
# 🇬🇧 English

## Before you start

**Prerequisites:** the repo on your own GitHub (fork or push) and one of: a Railway account, a Render account (**paid** plan) or a VPS with Docker.

**Which platform?**

| | Railway | Render | VPS with Docker |
| --- | --- | --- | --- |
| TCP relay (stable `host:port`) | ✅ via TCP Proxy | ❌ none | ✅ via `RELAY_PORT` |
| WebSocket relay (VLESS/Trojan on 443) | ✅ automatic domain | ✅ automatic domain | ✅ with a domain and reverse proxy |
| Persistence | Volume | Disk (paid) | Docker volume |
| Cost | per plan | the free plan sleeps and drops the tunnel | server cost |

**Three decisions before deploying:**
1. Create **two long random passwords**: one for the panel login (`PANEL_PASSWORD`) and one for sharing (`SHARE_PASSWORD`).
2. **Always set `SHARE_USERNAME` and `SHARE_PASSWORD` as environment variables.** Share settings are not saved to disk; without these two, a restart generates a new random username and password and every link (including VLESS/Trojan) stops working. Username 3–32 and password 8–64 chars from `A-Za-z0-9._~-`.
3. **Add a volume** and point `TMPDIR` at it so the tunnel settings, last known-good config and the "Best config" result survive restarts.

## 1) Railway — step by step

> Menu names may differ slightly as Railway evolves.

### 1.1 Service
1. **New Project → Deploy from GitHub repo**, pick the repo. The root `Dockerfile` is auto-detected.
2. **Do not override** the Start Command; the image runs `server.mjs` (`next start` plus the WebSocket hook).
3. In **Variables** set:

| Variable | Required? | Value |
| --- | --- | --- |
| `PANEL_USER`, `PANEL_PASSWORD` | ✅ | panel login (the panel returns `503` without them) |
| `SHARE_USERNAME`, `SHARE_PASSWORD` | ✅ strongly recommended | for stable links (see above) |
| `TMPDIR` | ✅ recommended | `/data/tmp` (after adding the volume) |
| `AUTO_START` | recommended | `1` — reconnect the tunnel after every restart |
| `SHARE_AUTO` | recommended | `1` — start the relays when the tunnel connects |
| `RELAY_PORT` | for the TCP relay | `1080` (any free port except `PORT` and `PORT+1`; also avoid `1819` and `1820`) |
| `SHARE_PROTOCOLS` | optional | `socks,http,ss` (default). Encrypted only: `ss` |
| `INBOUND_WS` | optional | `vless,trojan` (default), one of them, or `off` |
| `INBOUND_WS_PATH` | optional | custom WebSocket path, e.g. `/my-secret-path` |
| `NOTIFY_*` | optional | see the notifications section of `.env.example` |

4. **Settings → Networking → Generate Domain** for the panel. The domain's target port must equal the service `PORT`; Railway injects `PORT` itself (the image default is 3000). Once the domain exists Railway injects `RAILWAY_PUBLIC_DOMAIN`, which the panel uses for the VLESS/Trojan links.

### 1.2 Volume (persistence)
**Settings → Volumes → New Volume** mounted at `/data`, then set `TMPDIR=/data/tmp`. Without it each restart wipes the following and the panel shows `Settings and WARP identity will be lost on restart.`:
- tunnel settings, the last known-good config and the "Best config" winner (`tunnel-config.json`)
- the WARP identity

> The share username and password are always read from environment variables only and are never saved to the volume.

### 1.3 TCP Proxy (stable `host:port`)
1. **Settings → Networking → TCP Proxy → Add**.
2. Set "Application port" to your `RELAY_PORT` (e.g. `1080`).
3. Railway injects these variables itself and the panel reads them; nothing to copy: `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, `RAILWAY_TCP_APPLICATION_PORT`.
4. **Redeploy**.
5. If `RELAY_PORT` is unset but a TCP Proxy exists, `RAILWAY_TCP_APPLICATION_PORT` is used.

### 1.4 Use the panel
1. Open the Railway domain and sign in.
2. Connect the tunnel (`AUTO_START=1` does it for you).
3. Press "Create public address" (automatic with `SHARE_AUTO=1`).
4. In the share card, take the links of the TCP relay (`ASiRi-Railway`) and the panel domain (VLESS/Trojan) for your client.

### 1.5 VLESS / Trojan over WebSocket
No extra setup: the panel's Railway domain carries the WebSocket upgrade through the edge's TLS on 443. Turn sharing on and take the `vless://` or `trojan://` link. TCP only (no UDP, no mux).

### 1.6 Post-deploy checklist
- [ ] `https://<domain>/healthz` returns `ok` (no auth)
- [ ] Panel login works
- [ ] The persistence banner is gone
- [ ] Status is **connected** and the exit IP is shown
- [ ] The TCP relay is **active** (not "pending" or "error")
- [ ] You tried a link in a client
- [ ] After a Redeploy the tunnel came back on its own and the links did not change

## 2) Render

1. **New → Web Service**, runtime **Docker**, connect the repo.
2. Use a **paid** instance type (the free plan sleeps and drops the tunnel).
3. Environment: `PANEL_USER`, `PANEL_PASSWORD`, `SHARE_USERNAME`, `SHARE_PASSWORD`, `TMPDIR=/data/tmp` and, if wanted, `AUTO_START=1`, `SHARE_AUTO=1`.
4. **Advanced → Health Check Path:** `/healthz`.
5. Add a **Disk** at `/data` (for persistence; needs a paid plan).
6. The `*.onrender.com` domain is picked up automatically for VLESS/Trojan from `RENDER_EXTERNAL_HOSTNAME`. If you attached a custom domain, set `INBOUND_PUBLIC_HOST` to it.

> Render has **no TCP Proxy.** On Render only the WebSocket relay (VLESS/Trojan) works and `RELAY_PORT` is of no use. Run the TCP relay on Railway or your own VPS.

## 3) VPS with Docker

### 3.1 Files
Create a `.env` next to the repo (and do not commit it):
```bash
PANEL_PASSWORD=a-long-panel-password
SHARE_USERNAME=myuser
SHARE_PASSWORD=a-long-share-password
RELAY_PUBLIC_HOST=YOUR.SERVER.IP.OR.DOMAIN
PANEL_DOMAIN=panel.example.com
```
and `docker-compose.yml`:
```yaml
services:
  asiri-panel:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"   # panel; reachable only through the reverse proxy
      - "1080:1080"             # TCP relay (when using RELAY_PORT)
    environment:
      PANEL_USER: admin
      PANEL_PASSWORD: ${PANEL_PASSWORD}
      TMPDIR: /data/tmp
      AUTO_START: "1"
      SHARE_AUTO: "1"
      SHARE_USERNAME: ${SHARE_USERNAME}
      SHARE_PASSWORD: ${SHARE_PASSWORD}
      RELAY_PORT: "1080"
      RELAY_PUBLIC_HOST: ${RELAY_PUBLIC_HOST}   # required outside Railway
      RELAY_PUBLIC_PORT: "1080"
      INBOUND_PUBLIC_HOST: ${PANEL_DOMAIN}      # your HTTPS domain for VLESS/Trojan
    volumes:
      - asiri-data:/data
volumes:
  asiri-data:
```
Run: `docker compose up -d --build`

- If the panel password contains `$`, write it as `$$` in `.env`.
- Don't need the TCP relay? Remove the `1080` line and the `RELAY_*` variables.
- No HTTPS domain? Remove `INBOUND_PUBLIC_HOST` and add `INBOUND_WS: "off"` to keep the WebSocket relay off. A wrong domain, or one that does not reach this panel, makes the public health check fail and the watchdog keep restarting the tunnel. Then reach the panel through an SSH tunnel: `ssh -L 3000:127.0.0.1:3000 user@server` and open `http://localhost:3000`.

### 3.2 HTTPS for the panel and VLESS/Trojan
The reverse proxy must forward the **WebSocket Upgrade** to port 3000, and the panel uses `X-Real-IP` or `X-Forwarded-For` for its login rate limit.

Caddy (handles Upgrade and `X-Forwarded-For` itself):
```
panel.example.com {
    reverse_proxy 127.0.0.1:3000
}
```
Nginx (inside a `server` block with a TLS certificate):
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
}
```
VLESS/Trojan links are always generated on port `443` with TLS, so the domain must answer on 443 with TLS.

### 3.3 Firewall
- `RELAY_PORT` is reachable from the internet and the username/password is its only protection. Use strong credentials or enable only Shadowsocks: `SHARE_PROTOCOLS=ss`.
- Keep 80 and 443 open for the reverse proxy. Do not expose port 3000 directly.

### 3.4 Without compose
```bash
docker build -t asiri-panel .
docker run -d --name asiri-panel --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -p 1080:1080 \
  -e PANEL_USER=admin -e PANEL_PASSWORD='a-long-password' \
  -e AUTO_START=1 -e SHARE_AUTO=1 \
  -e SHARE_USERNAME=myuser -e SHARE_PASSWORD='a-long-share-password' \
  -e RELAY_PORT=1080 -e RELAY_PUBLIC_HOST=YOUR.SERVER.IP.OR.DOMAIN -e RELAY_PUBLIC_PORT=1080 \
  -e INBOUND_PUBLIC_HOST=panel.example.com \
  -v asiri-data:/data -e TMPDIR=/data/tmp \
  asiri-panel
```
The image builds for `amd64` and `arm64` and needs BuildKit (the default in current Docker).

## 4) Aether version
The `Dockerfile` pins it: `ARG AETHER_VERSION=v1.5.0`. The checksum is verified at build time, and the in-panel install card fetches the same version.
- Locally: `docker build --build-arg AETHER_VERSION=vX.Y.Z -t asiri-panel .`
- Railway: add `AETHER_VERSION` as a service Variable and redeploy.

## 5) Updating the panel
Push your changes to the repo (Railway/Render rebuild automatically), or on a VPS run `git pull && docker compose up -d --build`. With a volume the tunnel settings survive; with `AUTO_START=1` the tunnel comes back, and with `SHARE_*` set the links stay the same.

## 6) Notifications
Webhook (`NOTIFY_WEBHOOK_URL`) and/or Telegram (`NOTIFY_TELEGRAM_BOT_TOKEN` + `NOTIFY_TELEGRAM_CHAT_ID`). Events: `tunnel_down`, `subscription_changed`, `relay_error`; repeats are suppressed for `NOTIFY_COOLDOWN_SEC`. `subscription_changed` messages contain the username, password and links; send them to private channels only.

## 7) Local checks before deploying
```bash
npm test                 # Node 22+; no dependencies to install
pnpm install && pnpm typecheck
docker build -t asiri-panel .
```

## 8) Cloudflare Worker (optional)
`worker/` is a standalone Worker meant to sit in front of the panel or to bridge a WebSocket to TCP. The `[vars]` in `worker/wrangler.toml` are mock values and must be replaced before `npx wrangler deploy`. Full description: README.md → "Cloudflare Worker".

## Having trouble?
See the troubleshooting table in [README.md](README.md#en-trouble). The most common ones: `503` (missing `PANEL_USER`/`PANEL_PASSWORD`), `No relay is enabled…` (neither `RELAY_PORT` nor an HTTPS domain), links changing after a restart (missing `SHARE_*`) and repeated tunnel restarts (wrong public domain).
