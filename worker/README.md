# ASiRi Worker · Cloudflare Worker برای پنل ASiRi (اختیاری)

**[فارسی](#fa) · [English](#en)** · [راهنمای دپلوی / Deploy guide](README-DEPLOY.md) · [README پروژه](../README.md)

> ⚠️ این Worker **اختیاری** و کاملاً مستقل از پنل است. پنل بدون آن هم کامل کار می‌کند. پروژه‌ی **غیررسمی** است و به Cloudflare یا CluvexStudio وابسته نیست.
> ⚠️ This Worker is **optional** and fully independent of the panel. The panel works completely without it. **Unofficial**; not affiliated with Cloudflare or CluvexStudio.

---

<a id="fa"></a>
# 🇮🇷 فارسی

## فهرست
1. [این Worker چیست؟](#fa-what)
2. [دو حالت استفاده](#fa-modes)
3. [رفتار دقیق: هر درخواست چه جوابی می‌گیرد؟](#fa-behavior)
4. [متغیرها](#fa-vars)
5. [محدودیت‌ها](#fa-limits)
6. [امنیت](#fa-security)
7. [ساختار پوشه و اسکریپت‌ها](#fa-layout)
8. [توسعه‌ی محلی و تست](#fa-dev)
9. [مجوز](#fa-license)

<a id="fa-what"></a>
## این Worker چیست؟
یک Cloudflare Worker کوچک (یک فایل: [`src/index.ts`](src/index.ts)) که روی دامنه‌ی Cloudflare شما اجرا می‌شود و دو کار می‌کند:

1. **پل WebSocket به TCP:** درخواست WebSocket روی مسیر `WS_PATH` را می‌پذیرد و پیام‌های باینری آن را با `cloudflare:sockets` به یک مقصد TCP خام (`TARGET_HOST:TARGET_PORT`) می‌رساند و جواب مقصد را برمی‌گرداند. Worker هیچ پروتکلی را تفسیر نمی‌کند؛ فقط بایت‌ها را رد و بدل می‌کند.
2. **Reverse proxy:** هر درخواست دیگر را به `ORIGIN` (مثلاً آدرس پنل) می‌فرستد. اگر `ORIGIN` خالی باشد جواب `404` می‌دهد؛ پس دامنه‌ی Worker از بیرون شبیه یک سایت معمولی است.

```
                        ┌─ مسیر == WS_PATH ──► WebSocket ⇄ TCP خام (TARGET_HOST:TARGET_PORT)
کلاینت ──► Cloudflare ──┤
                        └─ هر مسیر دیگر ─────► reverse proxy به ORIGIN (یا 404)
```

<a id="fa-modes"></a>
## دو حالت استفاده

### حالت الف: «در جلوی پنل» (ORIGIN = آدرس پنل)
دامنه‌ی Cloudflare شما جلوی پنل قرار می‌گیرد و لینک‌های VLESS/Trojan پنل از این دامنه می‌گذرند.
- `ORIGIN=https://panel.example.com`
- `WS_PATH` را **خالی** بگذارید (پل خاموش می‌شود) یا روی مسیری غیر از مسیر مخفی پنل.
- درخواست‌های WebSocket روی مسیر مخفی پنل (`/ws/<hex>`) از Worker به پنل پاس داده می‌شوند.
- در پنل `INBOUND_PUBLIC_HOST` را روی دامنه‌ی Worker بگذارید تا لینک‌ها با آن ساخته شوند.
- ⚠️ رابط پنل (با Basic Auth) هم از دامنه‌ی Worker در دسترس می‌شود، چون هر مسیری پروکسی می‌شود.

### حالت ب: «پل TCP» (WS_PATH + TARGET_*)
یک مسیر مخفی روی Worker باز می‌شود که به یک سرور TCP وصل است.
- `WS_PATH=/ws/<مسیر-مخفی>`، `TARGET_HOST`، `TARGET_PORT`.
- **مقصد باید پروتکلی را بفهمد که کلاینت داخل WebSocket می‌فرستد.** Worker فقط بایت‌ها را عبور می‌دهد.
- اتصال Worker به مقصد **TCP ساده** است (بدون TLS). پس مقصد باید روی `TARGET_PORT` متن ساده بپذیرد، حتی اگر عدد پورت `443` باشد.
- مثال ممکن: مقصد = رله‌ی TCP پنل (`RELAY_PUBLIC_HOST:RELAY_PUBLIC_PORT`) با Shadowsocks فعال، و کلاینتی که Shadowsocks را روی WebSocket می‌فرستد (مثل v2ray-plugin در حالت websocket+tls). این سناریو در پروژه تست نشده و باید خودتان راستی‌آزمایی کنید.

دو حالت را می‌توان **هم‌زمان** استفاده کرد: `ORIGIN` برای پنل و `WS_PATH` برای پل، فقط مسیرها نباید یکی باشند.

<a id="fa-behavior"></a>
## رفتار دقیق: هر درخواست چه جوابی می‌گیرد؟

مسیر با `WS_PATH` مقایسه می‌شود. `/` انتهایی نادیده گرفته می‌شود، مقایسه حساس به حروف است و query string در نظر گرفته نمی‌شود. اگر `WS_PATH` خالی باشد، پل کاملاً خاموش است.

| درخواست | جواب |
| --- | --- |
| مسیر `WS_PATH` بدون هدر `Upgrade: websocket` | `426 Upgrade Required` |
| مسیر `WS_PATH`، WebSocket، متد غیر از `GET` | `405 Method Not Allowed` |
| مسیر `WS_PATH`، WebSocket، `TARGET_HOST` خالی یا `TARGET_PORT` نامعتبر (غیرعدد یا خارج از ۱ تا ۶۵۵۳۵) | `500 Tunnel target is not configured` |
| مسیر `WS_PATH`، WebSocket، مقصد در دسترس نیست | `502 Upstream unavailable` |
| مسیر `WS_PATH`، WebSocket، مقصد وصل شد | `101` و پل برقرار می‌شود |
| مسیر دیگر، `ORIGIN` خالی | `404 Not Found` |
| مسیر دیگر، `ORIGIN` آدرس نامعتبر (مثلاً بدون `https://`) | `500 Bad ORIGIN` |
| مسیر دیگر، `ORIGIN` معتبر | همان درخواست (متد، هدرها، بدنه، مسیر و query) به `ORIGIN` فرستاده می‌شود و جوابش برمی‌گردد. شامل WebSocket روی مسیرهای دیگر هم می‌شود |

جزئیات پل:
- Worker **اول** به مقصد وصل می‌شود و **بعد** WebSocket را می‌پذیرد؛ پس اگر مقصد خراب باشد، کلاینت فوراً `502` می‌گیرد، نه یک اتصال که بعداً می‌میرد.
- فشار برگشتی (backpressure): نوشتن به مقصد یکی‌یکی انجام می‌شود. اگر بیش از **۱ مگابایت** داده در صف نوشتن بماند (مقصد کند است)، اتصال با کد `1013` بسته می‌شود.
- پیام متنی WebSocket به بایت تبدیل می‌شود؛ پیام‌های برگشتی همیشه باینری‌اند.
- بسته شدن هر طرف (کلاینت، مقصد یا خطا) هر دو طرف را می‌بندد. کدها: `1000` عادی، `1011` خطا، `1013` مقصد کند.
- گزینه‌ی `allowHalfOpen` خاموش است: وقتی یک سمت می‌بندد، سمت دیگر هم بسته می‌شود.

<a id="fa-vars"></a>
## متغیرها
در [`wrangler.toml`](wrangler.toml) بخش `[vars]` (یا به‌صورت Secret، بخش [امنیت](#fa-security)):

| متغیر | الزامی | مثال | توضیح |
| --- | --- | --- | --- |
| `ORIGIN` | برای حالت الف | `https://panel.example.com` | مقصد درخواست‌های معمولی. باید با `https://` یا `http://` شروع شود. خالی = `404` |
| `WS_PATH` | برای حالت ب | `/ws/9f3a1c7b2d4e` | مسیر مخفی پل. با `/` شروع شود. خالی = پل خاموش |
| `TARGET_HOST` | برای حالت ب | `target.example.com` | دامنه یا IP مقصد TCP |
| `TARGET_PORT` | برای حالت ب | `1080` | پورت مقصد (عدد ۱ تا ۶۵۵۳۵؛ در `wrangler.toml` به‌صورت رشته) |

مقدارهای فعلی `wrangler.toml` نمونه‌ی ساختگی‌اند (`panel.example.com`، `/ws/changeme0000`، `target.example.com`، `443`) و باید قبل از دپلوی عوض شوند.

<a id="fa-limits"></a>
## محدودیت‌ها
- **فقط TCP.** UDP پشتیبانی نمی‌شود.
- هیچ پروتکلی (VLESS، Trojan، Shadowsocks، …) در خود Worker پیاده نشده است؛ فقط پل بایتی است.
- **بدون TLS به مقصد:** `connect()` با تنظیم پیش‌فرض (TLS خاموش) صدا زده می‌شود.
- محدودیت‌های Cloudflare روی `cloudflare:sockets` (طبق مستندات Cloudflare تا زمان نگارش؛ مستندات فعلی را ببینید): اتصال به آدرس‌های خود Cloudflare ممکن نیست و پورت ۲۵ بسته است.
- بدون keep-alive یا ping داخلی و بدون محدودیت نرخ یا سهمیه‌ی اتصال.
- سقف درخواست و CPU و پهنای باند به پلن Cloudflare شما بستگی دارد.
- دامنه‌ی `*.workers.dev` در برخی شبکه‌ها فیلتر است؛ بهتر است دامنه‌ی اختصاصی خودتان را وصل کنید ([راهنمای دپلوی](README-DEPLOY.md)).
- استفاده از Workers برای عبور حجم زیاد ترافیک پراکسی ممکن است با شرایط استفاده‌ی Cloudflare در تضاد باشد و به مسدود شدن حساب منجر شود. قبل از استفاده، شرایط خدمات Cloudflare را بخوانید.

<a id="fa-security"></a>
## امنیت
- Worker **احراز هویت ندارد**. تنها محافظ پل، پنهان بودن `WS_PATH` است. هر کس مسیر را بداند می‌تواند یک اتصال TCP به مقصد باز کند. پس خود مقصد باید رمز یا UUID داشته باشد.
- `WS_PATH` را طولانی و تصادفی بسازید: `echo "/ws/$(openssl rand -hex 12)"`.
- چون مقدار `[vars]` داخل فایل `wrangler.toml` (و احتمالاً Git) است، **`WS_PATH` را به‌صورت Secret بگذارید** و از `[vars]` حذف کنید: `npx wrangler secret put WS_PATH`.
- مسیر مخفی را در لاگ، اسکرین‌شات و ریپوی عمومی منتشر نکنید.
- در حالت الف، رابط پنل از دامنه‌ی Worker هم در دسترس است. رمز `PANEL_PASSWORD` قوی بگذارید. چون درخواست‌ها از Cloudflare و Worker عبور می‌کنند، پنل ممکن است به‌جای IP واقعی کلاینت، IP واسطه‌ها را ببیند و محدودیت ورود ناموفق پنل (بر اساس IP) برای همه یک سطل مشترک شود. با `ORIGIN` اشتباه یا رمز ضعیف خطرش بیشتر است.
- فایل `.dev.vars` (برای توسعه‌ی محلی) را commit نکنید.

<a id="fa-layout"></a>
## ساختار پوشه و اسکریپت‌ها
```
worker/
├── src/index.ts       کل منطق Worker
├── wrangler.toml      نام، تنظیمات و [vars]
├── package.json       اسکریپت‌ها و وابستگی‌ها
├── tsconfig.json      تنظیمات TypeScript (فقط typecheck)
├── README.md          این فایل
└── README-DEPLOY.md   راهنمای دپلوی
```
- این پوشه **بیرون** از workspace پنل (`pnpm-workspace.yaml` فقط `web` را دارد) و بیرون از Dockerfile است؛ پس وابستگی‌هایش جدا و با `npm install` داخل `worker/` نصب می‌شوند.
- فایل `web/wrangler.toml` ورودی (`main`) ندارد و پنل از آن استفاده نمی‌کند. Worker قابل دپلوی فقط همین پوشه‌ی `worker/` است.

| دستور (داخل `worker/`) | کار |
| --- | --- |
| `npm install` | نصب وابستگی‌ها (`wrangler`، `typescript`، `@cloudflare/workers-types`) |
| `npm run dev` | اجرای محلی با `wrangler dev` |
| `npm run typecheck` | بررسی تایپ‌ها (`tsc --noEmit`) |
| `npm run deploy` | دپلوی با `wrangler deploy` |

<a id="fa-dev"></a>
## توسعه‌ی محلی و تست
```bash
cd worker
npm install
npm run typecheck
npm run dev            # معمولاً http://localhost:8787
```
برای مقدارهای محلی، فایل `worker/.dev.vars` بسازید (commit نشود):
```
ORIGIN=https://panel.example.com
WS_PATH=/ws/localtest
TARGET_HOST=127.0.0.1
TARGET_PORT=1080
```
تست‌های ساده (جواب‌ها مطابق [جدول رفتار](#fa-behavior)):
```bash
curl -i http://localhost:8787/ws/localtest        # 426 (بدون Upgrade)
curl -i http://localhost:8787/                    # 404 یا جواب ORIGIN
npx wscat -c ws://localhost:8787/ws/localtest     # 101 اگر مقصد در دسترس باشد، وگرنه 502
```
ریپو برای خود Worker تست خودکار ندارد؛ تست‌های `tests/` مربوط به پنل‌اند.

<a id="fa-license"></a>
## مجوز
مانند کل پروژه: GNU AGPL v3؛ متن کامل در [LICENSE](../LICENSE).

---

<a id="en"></a>
# 🇬🇧 English

## Contents
1. [What is this Worker?](#en-what)
2. [Two usage modes](#en-modes)
3. [Exact behavior: what does each request get?](#en-behavior)
4. [Variables](#en-vars)
5. [Limitations](#en-limits)
6. [Security](#en-security)
7. [Layout and scripts](#en-layout)
8. [Local development and testing](#en-dev)
9. [License](#en-license)

<a id="en-what"></a>
## What is this Worker?
A tiny Cloudflare Worker (one file: [`src/index.ts`](src/index.ts)) running on your Cloudflare domain that does two things:

1. **WebSocket-to-TCP bridge:** it accepts a WebSocket on `WS_PATH`, forwards its binary messages through `cloudflare:sockets` to a raw TCP target (`TARGET_HOST:TARGET_PORT`) and sends the target's replies back. The Worker interprets no protocol; it only moves bytes.
2. **Reverse proxy:** every other request is sent to `ORIGIN` (e.g. your panel's URL). If `ORIGIN` is empty it answers `404`, so the Worker domain looks like an ordinary site from outside.

```
                        ┌─ path == WS_PATH ──► WebSocket ⇄ raw TCP (TARGET_HOST:TARGET_PORT)
client ──► Cloudflare ──┤
                        └─ any other path ───► reverse proxy to ORIGIN (or 404)
```

<a id="en-modes"></a>
## Two usage modes

### Mode A: "in front of the panel" (ORIGIN = panel URL)
Your Cloudflare domain sits in front of the panel and the panel's VLESS/Trojan links pass through it.
- `ORIGIN=https://panel.example.com`
- Leave `WS_PATH` **empty** (the bridge is off) or set it to a path different from the panel's secret path.
- WebSocket requests on the panel's secret path (`/ws/<hex>`) are passed through the Worker to the panel.
- In the panel set `INBOUND_PUBLIC_HOST` to the Worker domain so links are built with it.
- ⚠️ The panel UI (Basic Auth) also becomes reachable on the Worker domain, because every path is proxied.

### Mode B: "TCP bridge" (WS_PATH + TARGET_*)
A secret path on the Worker is wired to a TCP server.
- `WS_PATH=/ws/<secret-path>`, `TARGET_HOST`, `TARGET_PORT`.
- **The target must understand whatever protocol the client sends inside the WebSocket.** The Worker just passes bytes.
- The Worker's connection to the target is **plain TCP** (no TLS). The target must accept plaintext on `TARGET_PORT`, even if the port number is `443`.
- One possible setup: target = the panel's TCP relay (`RELAY_PUBLIC_HOST:RELAY_PUBLIC_PORT`) with Shadowsocks enabled, and a client that carries Shadowsocks over WebSocket (e.g. v2ray-plugin in websocket+tls mode). This scenario is not tested by the project; verify it yourself.

You can use both modes **together**: `ORIGIN` for the panel and `WS_PATH` for the bridge, as long as the paths differ.

<a id="en-behavior"></a>
## Exact behavior: what does each request get?

The path is compared with `WS_PATH`. A trailing `/` is ignored, the comparison is case-sensitive and the query string is not considered. If `WS_PATH` is empty the bridge is fully off.

| Request | Response |
| --- | --- |
| `WS_PATH` path without `Upgrade: websocket` | `426 Upgrade Required` |
| `WS_PATH` path, WebSocket, method other than `GET` | `405 Method Not Allowed` |
| `WS_PATH` path, WebSocket, `TARGET_HOST` empty or `TARGET_PORT` invalid (non-integer or outside 1–65535) | `500 Tunnel target is not configured` |
| `WS_PATH` path, WebSocket, target unreachable | `502 Upstream unavailable` |
| `WS_PATH` path, WebSocket, target connected | `101`, the bridge is up |
| other path, `ORIGIN` empty | `404 Not Found` |
| other path, `ORIGIN` not a valid URL (e.g. missing `https://`) | `500 Bad ORIGIN` |
| other path, valid `ORIGIN` | the same request (method, headers, body, path and query) goes to `ORIGIN` and its response is returned. This includes WebSockets on other paths |

Bridge details:
- The Worker connects to the target **first** and accepts the WebSocket **afterwards**, so a dead target gives the client an immediate `502` instead of an upgrade that dies later.
- Backpressure: writes to the target happen one at a time. If more than **1 MiB** is queued waiting to be written (a slow target) the connection is closed with code `1013`.
- Text WebSocket messages are converted to bytes; messages coming back are always binary.
- Closing either side (client, target, or an error) closes both. Codes: `1000` normal, `1011` error, `1013` slow target.
- `allowHalfOpen` is off: when one side closes, the other closes too.

<a id="en-vars"></a>
## Variables
In [`wrangler.toml`](wrangler.toml) under `[vars]` (or as a Secret, see [Security](#en-security)):

| Variable | Required | Example | Description |
| --- | --- | --- | --- |
| `ORIGIN` | for mode A | `https://panel.example.com` | where ordinary requests go. Must start with `https://` or `http://`. Empty = `404` |
| `WS_PATH` | for mode B | `/ws/9f3a1c7b2d4e` | secret bridge path. Must start with `/`. Empty = bridge off |
| `TARGET_HOST` | for mode B | `target.example.com` | domain or IP of the TCP target |
| `TARGET_PORT` | for mode B | `1080` | target port (integer 1–65535; a string in `wrangler.toml`) |

The current `wrangler.toml` values are mock placeholders (`panel.example.com`, `/ws/changeme0000`, `target.example.com`, `443`) and must be replaced before deploying.

<a id="en-limits"></a>
## Limitations
- **TCP only.** No UDP.
- No protocol (VLESS, Trojan, Shadowsocks, …) is implemented in the Worker; it is a byte bridge only.
- **No TLS to the target:** `connect()` is called with the default (TLS off).
- Cloudflare's own limits on `cloudflare:sockets` (per Cloudflare's docs at the time of writing; check the current docs): connecting to Cloudflare's own addresses is not possible and port 25 is blocked.
- No built-in keep-alive/ping and no rate limiting or connection quota.
- Request, CPU and bandwidth ceilings depend on your Cloudflare plan.
- The `*.workers.dev` domain is filtered on some networks; attach your own domain ([Deploy guide](README-DEPLOY.md)).
- Pushing large volumes of proxy traffic through Workers may conflict with Cloudflare's terms of service and could get the account restricted. Read Cloudflare's terms before use.

<a id="en-security"></a>
## Security
- The Worker has **no authentication**. The only protection of the bridge is the secrecy of `WS_PATH`. Anyone who knows it can open a TCP connection to the target, so the target itself must require a password or UUID.
- Make `WS_PATH` long and random: `echo "/ws/$(openssl rand -hex 12)"`.
- `[vars]` values live in `wrangler.toml` (and probably Git), so **store `WS_PATH` as a Secret** and remove it from `[vars]`: `npx wrangler secret put WS_PATH`.
- Don't publish the secret path in logs, screenshots or a public repo.
- In mode A the panel UI is reachable via the Worker domain as well. Use a strong `PANEL_PASSWORD`. Because requests pass through Cloudflare and the Worker, the panel may see the intermediaries' IPs instead of the real client IP, so the panel's per-IP failed-login limit may become one shared bucket for everyone.
- Don't commit `.dev.vars` (local development).

<a id="en-layout"></a>
## Layout and scripts
```
worker/
├── src/index.ts       all Worker logic
├── wrangler.toml      name, settings and [vars]
├── package.json       scripts and dependencies
├── tsconfig.json      TypeScript config (typecheck only)
├── README.md          this file
└── README-DEPLOY.md   deploy guide
```
- This folder is **outside** the panel workspace (`pnpm-workspace.yaml` lists only `web`) and outside the Dockerfile, so its dependencies are installed separately with `npm install` inside `worker/`.
- `web/wrangler.toml` has no `main` entry and is not used by the panel. The only deployable Worker is this `worker/` folder.

| Command (inside `worker/`) | Purpose |
| --- | --- |
| `npm install` | install dependencies (`wrangler`, `typescript`, `@cloudflare/workers-types`) |
| `npm run dev` | run locally with `wrangler dev` |
| `npm run typecheck` | type-check (`tsc --noEmit`) |
| `npm run deploy` | deploy with `wrangler deploy` |

<a id="en-dev"></a>
## Local development and testing
```bash
cd worker
npm install
npm run typecheck
npm run dev            # usually http://localhost:8787
```
For local values create `worker/.dev.vars` (never commit it):
```
ORIGIN=https://panel.example.com
WS_PATH=/ws/localtest
TARGET_HOST=127.0.0.1
TARGET_PORT=1080
```
Quick checks (responses follow the [behavior table](#en-behavior)):
```bash
curl -i http://localhost:8787/ws/localtest        # 426 (no Upgrade)
curl -i http://localhost:8787/                    # 404 or the ORIGIN's response
npx wscat -c ws://localhost:8787/ws/localtest     # 101 if the target is reachable, else 502
```
The repo has no automated tests for the Worker itself; the tests in `tests/` cover the panel.

<a id="en-license"></a>
## License
Same as the whole project: GNU AGPL v3; full text in [LICENSE](../LICENSE).
