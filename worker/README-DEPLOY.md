# راهنمای دپلوی · Deploy guide — ASiRi Worker

**[فارسی](#fa) · [English](#en)** · [README Worker](README.md) · [README پروژه](../README.md) · [دپلوی پنل](../README-DEPLOY.md)

---

<a id="fa"></a>
# 🇮🇷 فارسی

## فهرست
1. [قبل از شروع](#fa-before)
2. [مرحله ۱: آماده‌سازی](#fa-s1)
3. [مرحله ۲: تنظیم wrangler.toml](#fa-s2)
4. [مرحله ۳: دپلوی و ثبت Secret](#fa-s3)
5. [مرحله ۴: دامنه‌ی اختصاصی](#fa-s4)
6. [مرحله ۵: اتصال به پنل (حالت الف)](#fa-s5)
7. [مرحله ۶: تست](#fa-s6)
8. [دپلوی خودکار (CI)](#fa-ci)
9. [به‌روزرسانی، لاگ، بازگشت و حذف](#fa-ops)
10. [مشکلات رایج](#fa-trouble)

<a id="fa-before"></a>
## قبل از شروع
- حساب Cloudflare (پلن رایگان کافی است).
- Node.js 18 یا بالاتر (ترجیحاً 20 یا 22) و npm.
- **حالت الف** (جلوی پنل): پنل باید قبلاً دپلوی شده و با HTTPS در دسترس باشد ([دپلوی پنل](../README-DEPLOY.md)).
- **حالت ب** (پل TCP): یک سرور TCP که از اینترنت در دسترس است و پروتکل مورد نظرتان را روی متن ساده می‌پذیرد.
- **توصیه‌شده:** یک دامنه که در Cloudflare مدیریت می‌شود. دامنه‌ی `*.workers.dev` در برخی شبکه‌ها فیلتر است.
- حالت‌ها را در [README Worker](README.md#fa-modes) بخوانید.

<a id="fa-s1"></a>
## مرحله ۱: آماده‌سازی
```bash
git clone <آدرس-ریپوی-شما> asiri-panel && cd asiri-panel/worker
npm install
npx wrangler login          # مرورگر باز می‌شود و به حساب Cloudflare وصل می‌شوید
npm run typecheck           # باید بدون خطا تمام شود
```
- روی سرور بدون مرورگر، به‌جای `wrangler login` از توکن API استفاده کنید: در Cloudflare ← My Profile ← API Tokens ← قالب **Edit Cloudflare Workers** ← سپس
  ```bash
  export CLOUDFLARE_API_TOKEN=...
  export CLOUDFLARE_ACCOUNT_ID=...
  ```
- مسیر مخفی بسازید (حالت ب) و نگه دارید:
  ```bash
  echo "/ws/$(openssl rand -hex 12)"
  ```

<a id="fa-s2"></a>
## مرحله ۲: تنظیم wrangler.toml
فایل `worker/wrangler.toml` را ویرایش کنید. مقدارهای فعلی ساختگی‌اند.

**حالت الف (جلوی پنل):**
```toml
name = "aether-tunnel"
main = "src/index.ts"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ORIGIN = "https://panel.example.com"   # آدرس HTTPS پنل شما
TARGET_HOST = ""
TARGET_PORT = ""
# WS_PATH را اینجا نگذارید؛ خالی یعنی پل خاموش است.
```

**حالت ب (پل TCP):**
```toml
[vars]
ORIGIN = ""                             # خالی = مسیرهای دیگر 404 می‌دهند
TARGET_HOST = "target.example.com"      # دامنه یا IP سرور TCP
TARGET_PORT = "1080"                    # پورت (به‌صورت رشته)
# WS_PATH را به‌صورت Secret ثبت می‌کنیم (مرحله ۳)، نه اینجا.
```
نکته‌ها:
- هر دو حالت را می‌توان هم‌زمان داشت (هم `ORIGIN` هم `TARGET_*`)، به شرط اینکه `WS_PATH` با مسیر مخفی پنل یکی نباشد.
- `ORIGIN` حتماً با `https://` شروع شود، وگرنه `500 Bad ORIGIN`.
- مقدارهای `[vars]` در هر دپلوی از روی این فایل **جایگزین** می‌شوند؛ تغییرات دستی داشبورد برای آن‌ها پاک می‌شود. پس همیشه اینجا ویرایش کنید.
- `WS_PATH` را در `[vars]` نگذارید؛ اگر هم در `[vars]` و هم Secret باشد، تداخل ایجاد می‌شود.

<a id="fa-s3"></a>
## مرحله ۳: دپلوی و ثبت Secret
```bash
npm run deploy
```
خروجی آدرسی مثل `https://aether-tunnel.<حساب-شما>.workers.dev` می‌دهد. سپس مسیر مخفی را ثبت کنید (فقط حالت ب):
```bash
npx wrangler secret put WS_PATH
# مقدار را وارد کنید، مثلاً: /ws/9f3a1c7b2d4e5f60a1b2c3d4
```
Secret بلافاصله اعمال می‌شود و در دپلوی‌های بعدی هم می‌ماند. تا ثبت نشود، پل خاموش است (`WS_PATH` خالی).

<a id="fa-s4"></a>
## مرحله ۴: دامنه‌ی اختصاصی
دامنه‌ی شما باید در همین حساب Cloudflare باشد.

**با فایل (توصیه‌شده):** به `wrangler.toml` اضافه کنید و دوباره `npm run deploy` بزنید:
```toml
routes = [
  { pattern = "worker.example.com", custom_domain = true }
]
```
**یا با داشبورد:** Workers & Pages ← `aether-tunnel` ← Settings ← Domains & Routes ← Add ← Custom domain.

- رکورد DNS را Cloudflare خودش می‌سازد. اگر از قبل رکورد دیگری با همان نام دارید، ابتدا حذفش کنید.
- گزینه‌ی **WebSockets** در تنظیمات دامنه (Network) باید روشن باشد (پیش‌فرض روشن است).

<a id="fa-s5"></a>
## مرحله ۵: اتصال به پنل (حالت الف)
1. در Variables/Environment پنل بگذارید:
   ```
   INBOUND_PUBLIC_HOST=worker.example.com
   ```
2. پنل را ری‌استارت (Redeploy) کنید. اشتراک را خاموش و روشن کنید تا لینک‌های VLESS/Trojan با دامنه‌ی Worker ساخته شوند.
3. لینک‌ها همیشه روی پورت `443` با TLS ساخته می‌شوند که با دامنه‌ی Worker سازگار است.
4. مسیر مخفی WebSocket پنل (`INBOUND_WS_PATH` یا مقدار پیش‌فرضش) بدون تغییر از Worker به پنل می‌رسد.

> watchdog پنل health check را از **مسیر عمومی** انجام می‌دهد، یعنی حالا از دامنه‌ی Worker. اگر Worker یا `ORIGIN` اشتباه باشد، watchdog تونل سالم را هم ری‌استارت می‌کند. مرحله‌ی تست را حتماً انجام دهید.

<a id="fa-s6"></a>
## مرحله ۶: تست
(به‌جای `worker.example.com` دامنه‌ی خودتان را بگذارید.)

**حالت الف:**
```bash
curl -i https://worker.example.com/healthz   # 200 و متن ok (از پنل)
curl -i https://worker.example.com/          # 401 Authentication required (از پنل)
```
سپس لینک VLESS یا Trojan پنل را در کلاینت وارد کنید و وصل شوید.

**حالت ب:**
```bash
curl -i https://worker.example.com/ws/<مسیر-مخفی>          # 426 Upgrade Required
curl -i https://worker.example.com/other                    # 404 (اگر ORIGIN خالی است)
npx wscat -c wss://worker.example.com/ws/<مسیر-مخفی>        # اتصال برقرار می‌شود
```
- اگر `wscat` خطای `Unexpected server response: 502` داد، مقصد در دسترس نیست ([مشکلات رایج](#fa-trouble)).
- اتصال موفق WebSocket فقط یعنی Worker به مقصد وصل شده. درست‌بودن پروتکل را با کلاینت واقعی بسنجید.

<a id="fa-ci"></a>
## دپلوی خودکار (CI)
**Workers Builds (داخل Cloudflare):** Workers & Pages ← Worker ← Settings ← Builds ← اتصال ریپو. **Root directory:** `worker`، **Deploy command:** `npx wrangler deploy`.

**GitHub Actions:** فایل `.github/workflows/deploy-worker.yml`:
```yaml
name: deploy-worker
on:
  push:
    branches: [main]
    paths: ["worker/**"]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
        working-directory: worker
      - run: npx wrangler deploy
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
توکن و Account ID را در GitHub ← Settings ← Secrets and variables ← Actions بگذارید. Secret مربوط به `WS_PATH` روی Cloudflare می‌ماند و با دپلوی عوض نمی‌شود.

<a id="fa-ops"></a>
## به‌روزرسانی، لاگ، بازگشت و حذف
```bash
cd worker
npm run deploy                    # به‌روزرسانی بعد از تغییر کد یا wrangler.toml
npx wrangler tail                 # لاگ زنده‌ی Worker (Ctrl+C برای خروج)
npx wrangler deployments list     # فهرست دپلوی‌ها
npx wrangler rollback             # بازگشت به نسخه‌ی قبلی
npx wrangler secret put WS_PATH   # عوض‌کردن مسیر مخفی (لینک/کلاینت‌ها را هم عوض کنید)
npx wrangler secret delete WS_PATH  # خاموش‌کردن پل
npx wrangler delete               # حذف کامل Worker
```
- بعد از عوض‌کردن `WS_PATH`، کلاینت‌ها باید مسیر جدید را بگیرند.
- Worker ماندگاری یا داده‌ای ندارد؛ پشتیبان‌گیری لازم نیست جز نگه‌داشتن `wrangler.toml` و مقدار Secret.

<a id="fa-trouble"></a>
## مشکلات رایج

| مشکل | علت و راه‌حل |
| --- | --- |
| `wrangler login` روی سرور کار نمی‌کند | از `CLOUDFLARE_API_TOKEN` و `CLOUDFLARE_ACCOUNT_ID` استفاده کنید |
| صفحه‌ی خطای Cloudflare با کد `1101` | Worker استثنا داده؛ با `npx wrangler tail` ببینید |
| `502 Upstream unavailable` روی مسیر WS | مقصد در دسترس نیست: `TARGET_HOST/PORT` را بررسی کنید؛ فایروال مقصد؛ مقصد باید TCP ساده بپذیرد؛ مقصد نباید آدرس خود Cloudflare یا پورت ۲۵ باشد |
| `500 Tunnel target is not configured` | `TARGET_HOST` خالی است یا `TARGET_PORT` عدد معتبر ۱ تا ۶۵۵۳۵ نیست |
| `500 Bad ORIGIN` | `ORIGIN` بدون `https://` یا نامعتبر است |
| `426 Upgrade Required` | طبیعی است؛ این مسیر فقط WebSocket می‌پذیرد (در مرورگر هم همین را می‌بینید) |
| روی مسیر `/` پاسخ `404` | `ORIGIN` خالی است (در حالت ب طبیعی است) |
| مسیر مخفی کار نمی‌کند و `404` یا پاسخ پنل می‌گیرید | Secret `WS_PATH` ثبت نشده یا مقدارش با مسیر کلاینت (حروف کوچک/بزرگ، `/` ابتدایی) فرق دارد |
| دپلوی با خطای تداخل متغیر شکست می‌خورد | `WS_PATH` هم در `[vars]` هم Secret است؛ از `[vars]` حذفش کنید |
| لینک‌های پنل هنوز دامنه‌ی قدیمی را دارند | `INBOUND_PUBLIC_HOST` را ست و پنل را ری‌استارت کنید و اشتراک را خاموش/روشن کنید |
| watchdog پنل مدام تونل را ری‌استارت می‌کند | health check از دامنه‌ی Worker شکست می‌خورد: `ORIGIN`، دامنه، WebSockets روی دامنه را بررسی کنید یا موقتاً `INBOUND_WS=off` |
| اتصال با کد `1013` قطع می‌شود | مقصد برای نوشتن کند است (بیش از ۱ مگابایت در صف)؛ سرعت و شبکه‌ی مقصد را بررسی کنید |
| دامنه‌ی `workers.dev` باز نمی‌شود | از دامنه‌ی اختصاصی استفاده کنید ([مرحله ۴](#fa-s4)) |
| افزودن Custom domain خطا می‌دهد | رکورد DNS هم‌نام وجود دارد؛ حذفش کنید یا نام دیگری بگیرید |

---

<a id="en"></a>
# 🇬🇧 English

## Contents
1. [Before you start](#en-before)
2. [Step 1: prepare](#en-s1)
3. [Step 2: configure wrangler.toml](#en-s2)
4. [Step 3: deploy and set the Secret](#en-s3)
5. [Step 4: custom domain](#en-s4)
6. [Step 5: connect to the panel (mode A)](#en-s5)
7. [Step 6: test](#en-s6)
8. [Automatic deploys (CI)](#en-ci)
9. [Updating, logs, rollback and removal](#en-ops)
10. [Common problems](#en-trouble)

<a id="en-before"></a>
## Before you start
- A Cloudflare account (the free plan is enough).
- Node.js 18 or newer (20 or 22 preferred) and npm.
- **Mode A** (in front of the panel): the panel must already be deployed and reachable over HTTPS ([panel deploy guide](../README-DEPLOY.md)).
- **Mode B** (TCP bridge): a TCP server reachable from the internet that accepts your protocol in plaintext.
- **Recommended:** a domain managed by Cloudflare. The `*.workers.dev` domain is filtered on some networks.
- Read the modes in the [Worker README](README.md#en-modes).

<a id="en-s1"></a>
## Step 1: prepare
```bash
git clone <your-repo-url> asiri-panel && cd asiri-panel/worker
npm install
npx wrangler login          # opens a browser to link your Cloudflare account
npm run typecheck           # should finish with no errors
```
- On a server without a browser use an API token instead of `wrangler login`: Cloudflare ← My Profile ← API Tokens ← **Edit Cloudflare Workers** template, then
  ```bash
  export CLOUDFLARE_API_TOKEN=...
  export CLOUDFLARE_ACCOUNT_ID=...
  ```
- Generate the secret path (mode B) and keep it:
  ```bash
  echo "/ws/$(openssl rand -hex 12)"
  ```

<a id="en-s2"></a>
## Step 2: configure wrangler.toml
Edit `worker/wrangler.toml`. The current values are mock placeholders.

**Mode A (in front of the panel):**
```toml
name = "aether-tunnel"
main = "src/index.ts"
compatibility_date = "2025-09-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ORIGIN = "https://panel.example.com"   # your panel's HTTPS URL
TARGET_HOST = ""
TARGET_PORT = ""
# Don't put WS_PATH here; empty means the bridge is off.
```

**Mode B (TCP bridge):**
```toml
[vars]
ORIGIN = ""                             # empty = other paths answer 404
TARGET_HOST = "target.example.com"      # domain or IP of the TCP server
TARGET_PORT = "1080"                    # port (as a string)
# WS_PATH is set as a Secret (step 3), not here.
```
Notes:
- You can have both modes at once (`ORIGIN` and `TARGET_*`), as long as `WS_PATH` differs from the panel's secret path.
- `ORIGIN` must start with `https://`, otherwise `500 Bad ORIGIN`.
- `[vars]` values are **overwritten** from this file on every deploy; dashboard edits to them are lost. Always edit here.
- Don't put `WS_PATH` in `[vars]`; defining it both in `[vars]` and as a Secret conflicts.

<a id="en-s3"></a>
## Step 3: deploy and set the Secret
```bash
npm run deploy
```
The output shows an address like `https://aether-tunnel.<your-account>.workers.dev`. Then store the secret path (mode B only):
```bash
npx wrangler secret put WS_PATH
# enter the value, e.g.: /ws/9f3a1c7b2d4e5f60a1b2c3d4
```
The Secret applies immediately and survives later deploys. Until it is set, the bridge is off (`WS_PATH` is empty).

<a id="en-s4"></a>
## Step 4: custom domain
Your domain must be in the same Cloudflare account.

**Via file (recommended):** add this to `wrangler.toml` and run `npm run deploy` again:
```toml
routes = [
  { pattern = "worker.example.com", custom_domain = true }
]
```
**Or via dashboard:** Workers & Pages ← `aether-tunnel` ← Settings ← Domains & Routes ← Add ← Custom domain.

- Cloudflare creates the DNS record itself. If a record with the same name already exists, delete it first.
- The zone's **WebSockets** setting (Network) must be on (it is by default).

<a id="en-s5"></a>
## Step 5: connect to the panel (mode A)
1. In the panel's Variables/Environment set:
   ```
   INBOUND_PUBLIC_HOST=worker.example.com
   ```
2. Restart (redeploy) the panel. Turn sharing off and on so the VLESS/Trojan links are built with the Worker domain.
3. Links are always built on port `443` with TLS, which fits the Worker domain.
4. The panel's secret WebSocket path (`INBOUND_WS_PATH` or its default) reaches the panel unchanged through the Worker.

> The panel's watchdog runs its health check over the **public path**, which is now the Worker domain. If the Worker or `ORIGIN` is wrong, the watchdog will restart a healthy tunnel. Don't skip the test step.

<a id="en-s6"></a>
## Step 6: test
(Replace `worker.example.com` with your domain.)

**Mode A:**
```bash
curl -i https://worker.example.com/healthz   # 200 and "ok" (from the panel)
curl -i https://worker.example.com/          # 401 Authentication required (from the panel)
```
Then import the panel's VLESS or Trojan link in a client and connect.

**Mode B:**
```bash
curl -i https://worker.example.com/ws/<secret-path>          # 426 Upgrade Required
curl -i https://worker.example.com/other                      # 404 (when ORIGIN is empty)
npx wscat -c wss://worker.example.com/ws/<secret-path>        # connects
```
- If `wscat` says `Unexpected server response: 502`, the target is unreachable ([Common problems](#en-trouble)).
- A successful WebSocket only means the Worker reached the target. Verify the protocol itself with a real client.

<a id="en-ci"></a>
## Automatic deploys (CI)
**Workers Builds (inside Cloudflare):** Workers & Pages ← Worker ← Settings ← Builds ← connect the repo. **Root directory:** `worker`, **Deploy command:** `npx wrangler deploy`.

**GitHub Actions:** `.github/workflows/deploy-worker.yml`:
```yaml
name: deploy-worker
on:
  push:
    branches: [main]
    paths: ["worker/**"]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
        working-directory: worker
      - run: npx wrangler deploy
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```
Put the token and Account ID in GitHub ← Settings ← Secrets and variables ← Actions. The `WS_PATH` Secret stays on Cloudflare and is not changed by deploys.

<a id="en-ops"></a>
## Updating, logs, rollback and removal
```bash
cd worker
npm run deploy                    # update after code or wrangler.toml changes
npx wrangler tail                 # live Worker logs (Ctrl+C to exit)
npx wrangler deployments list     # list deployments
npx wrangler rollback             # roll back to the previous version
npx wrangler secret put WS_PATH   # change the secret path (update clients too)
npx wrangler secret delete WS_PATH  # turn the bridge off
npx wrangler delete               # remove the Worker entirely
```
- After changing `WS_PATH`, clients must use the new path.
- The Worker keeps no state or data; nothing to back up except `wrangler.toml` and the Secret's value.

<a id="en-trouble"></a>
## Common problems

| Problem | Cause and fix |
| --- | --- |
| `wrangler login` doesn't work on a server | use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| Cloudflare error page with code `1101` | the Worker threw; check `npx wrangler tail` |
| `502 Upstream unavailable` on the WS path | target unreachable: check `TARGET_HOST/PORT`, the target's firewall; the target must accept plain TCP; it must not be a Cloudflare address or port 25 |
| `500 Tunnel target is not configured` | `TARGET_HOST` is empty or `TARGET_PORT` isn't a valid integer 1–65535 |
| `500 Bad ORIGIN` | `ORIGIN` lacks `https://` or is invalid |
| `426 Upgrade Required` | expected; this path only accepts WebSockets (you see it in a browser too) |
| `404` on `/` | `ORIGIN` is empty (normal in mode B) |
| Secret path doesn't work and you get `404` or the panel's response | the `WS_PATH` Secret isn't set, or differs from the client's path (case, leading `/`) |
| Deploy fails with a variable conflict | `WS_PATH` is in both `[vars]` and Secrets; remove it from `[vars]` |
| Panel links still show the old domain | set `INBOUND_PUBLIC_HOST`, restart the panel and toggle sharing off/on |
| Panel watchdog keeps restarting the tunnel | its health check through the Worker domain fails: check `ORIGIN`, the domain and WebSockets on it, or temporarily set `INBOUND_WS=off` |
| Connection dropped with code `1013` | the target is too slow to write to (over 1 MiB queued); check its speed and network |
| `workers.dev` domain doesn't load | use a custom domain ([Step 4](#en-s4)) |
| Adding a Custom domain errors out | a DNS record with the same name exists; delete it or choose another name |
