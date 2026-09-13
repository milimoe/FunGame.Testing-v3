# 宝塔面板部署指南（.NET 10 + nginx 反向代理）

部署目标：`fun.milimoe.com` → nginx（80/443）→ `127.0.0.1:<端口>`（WebAPI；appsettings 默认 `11030`，线上宝塔实际用 `11976`，见 §4.0）

WebAPI 一个进程同时提供 **API + WebSocket + 三个独立前端**，所以 nginx 只需要反代一个端口：

| 路径 | 内容 | 来源 |
|---|---|---|
| `/` | 回合回放 + 职业规划 | `webui/dist` |
| `/client/` | Server 端点测试客户端 | `webui-client/dist` |
| `/solo/` | **单人模式**（竖版手游版式） | `webui-solo/dist` |
| `/api/*` | REST 接口 | WebAPI |
| `/ws/solo` | 单人模式对局 WebSocket | WebAPI |

---

## 0. 生成发布产物（Windows 上执行）

```bat
publish-linux.bat
```

产出三个目录：

| 目录 | 用途 |
|---|---|
| `publish\linux-x64-fd\` | **整套部署**（后端 + 三个前端），推荐 |
| `publish\client-webui\` | 仅 webui-client 的静态站构建（可选方案 B 用） |
| `publish\solo-webui\` | 仅 webui-solo（单人模式）的静态站构建（可选方案 B 用） |

> 前端构建用的是**同源 API**，换域名不用重新构建。webui 与两份独立静态站产物（`client-webui`、`solo-webui`）是相对路径；**webui-client / webui-solo 的 WebAPI 托管版**资源以绝对子路径 `/client/`、`/solo/` 引用（发布脚本已自动加，原因见下）。

### 前端资源路径怎么定（不要手改 index.html）

WebAPI 托管（默认）用相对路径就够。但如果 index.html 的访问 URL 比 `assets/` 所在目录**高一层**
（例如 nginx 用 alias/root 把 `.../webui-client/dist/` 或 `.../webui-solo/dist/` 挂到了别的路径），相对路径会指错。
这种情况**不要手改产物里的 index.html**（下次构建就丢了），改构建参数：

```bash
# 让产物里的资源变成  client/assets/index-xxx.js
VITE_ASSET_PREFIX=client/ npm run build          # bash / 宝塔构建
set VITE_ASSET_PREFIX=client/ && npm run build   # Windows cmd
```

| 变量 | 产物里的资源行 | 适用 |
|---|---|---|
| *（不设）* | `./assets/index-xxx.js` | WebAPI 托管在 `/client/`、或静态站根目录 |
| `VITE_BASE=/client/` | `/client/assets/index-xxx.js` | 固定在某个绝对子路径下 |
| `VITE_ASSET_PREFIX=client/` | `client/assets/index-xxx.js` | 相对再进一层（vite 的 `base` 表达不了，只认 `./` 或绝对路径） |

> **托管版为什么要绝对子路径**：nginx 整站反代 WebAPI 时，页面既能从 `/client/`（或 `/solo/`）也能从不带斜杠的 `/client`（或 `/solo`）打开。
> 相对路径 `./assets/...` 在不带斜杠时会被解析到 `/assets/...`（落回根路径的回合回放站）；而相对前缀 `client/assets/...` 在带斜杠时又会变成 `/client/client/assets/...`。
> 发布脚本因此对 WebAPI 托管版固定加 `VITE_BASE=/client/`（solo 为 `/solo/`）——资源用绝对子路径引用，两种入口都正确命中：
> 每个前端构建两次，相对路径版给独立静态站（`publish\client-webui`、`publish\solo-webui`），绝对子路径版给 `publish\linux-x64-fd`。

### 资源路径排错：页面白屏但控制台只有一条 404

先确认**页面 URL 的目录就是 `assets/` 的父目录**。

```bash
# 页面在 .../webui-client/dist/ 下时，assets 必须同级
ls /www/wwwroot/fungame-testing/webui-client/dist/
# 期望：index.html  assets/
# 如果看到 client/ 子目录（里面才是 assets），说明上传时多套了一层
```

症状与成因：

| 现象 | 成因 |
|---|---|
| `./assets/x.js` 404，改成 `client/assets/x.js` 才能加载 | `assets/` 被放进了 `.../dist/client/assets/`，而 `index.html` 在 `.../dist/` —— 上传时多套了一层目录 |
| 两种写法都 404 | 页面 URL 的目录和文件实际位置对不上 |

**正确处理**：把目录拍平（让 `index.html` 和 `assets/` 同级），然后把 `index.html` 里的路径还原成 `./assets/...`。
不要用 `client/assets/` 兜着 —— 那是把上传结构的问题固化进产物里。

---

## 1. 前置：目标机装 .NET 10 运行时

框架依赖版（fd）体积约 4MB，但**必须**目标机有 .NET 10 运行时。

```bash
# 宝塔「软件商店」→ .NET 项目管理器 → 安装 10.x 运行时
# 或 SSH 手动装（Ubuntu 22.04/24.04）
wget https://dot.net/v1/dotnet-install.sh -O dotnet-install.sh
bash dotnet-install.sh --channel 10.0 --runtime aspnetcore --install-dir /usr/share/dotnet
ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet
dotnet --list-runtimes   # 应看到 Microsoft.AspNetCore.App 10.x
```

> ⚠️ 本项目是 **net10.0**。宝塔的 .NET 管理器若还没支持 .NET 10，就按上面的脚本手动装，或者改用自包含发布（`dotnet publish ... --self-contained true`）。

---

## 2. 上传产物

用宝塔「文件」管理器，把 `publish\linux-x64-fd\` **整个目录**的内容上传到：

```
/www/wwwroot/fungame/
```

上传后的结构（关键部分）：

```
/www/wwwroot/fungame/
├── FunGame.Testing-v3.WebAPI.dll     ← 启动入口
├── appsettings.json                  ← Urls 已默认 http://localhost:11030
├── webui/dist/                       ← 挂在 /
├── webui-client/dist/                ← 挂在 /client/
├── webui-solo/dist/                  ← 挂在 /solo/
├── OshimaGameModules/                ← 模组配置与内容
└── rounds_archive.zip                ← 回合存档
```

```bash
chown -R www:www /www/wwwroot/fungame
```

> 存档目录必须可写，否则模拟/保存会失败。

---

## 3. 启动后端（只监听回环）

### 方式一：进程守护管理器（推荐）

宝塔「软件商店」→ 安装 **进程守护管理器**（Supervisor）→ 添加守护进程：

| 配置项 | 值 |
|---|---|
| 名称 | `fungame` |
| 运行目录 | `/www/wwwroot/fungame` |
| 启动命令 | `dotnet FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:11030` |
| 进程数量 | 1 |
| 运行用户 | `www` |

> `appsettings.json` 里 `"Urls": "http://localhost:11030"`，所以 `--urls` 省略也能跑；显式写上更清楚，换端口也只改这一处。

### 方式二：systemd（SSH）

```ini
# /etc/systemd/system/fungame.service
[Unit]
Description=FunGame Testing WebAPI
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/www/wwwroot/fungame
ExecStart=/usr/bin/dotnet /www/wwwroot/fungame/FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:11030
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now fungame
journalctl -u fungame -f          # 看日志
curl -s http://127.0.0.1:11030/api/meta | head -c 200   # 自检
```

> **11030 不要对外放行**，只开 80/443 给 nginx。

---

## 4. 配置站点与 nginx

### 4.0 如果你已经在用「宝塔默认生成的整站反代」——**不用改 nginx**

线上 `fun.milimoe.com` 那份就是宝塔默认生成的，长这样（关键几行）：

```nginx
root  /www/wwwroot/fungame-testing;
index index.html index.htm default.htm default.html;

location / {
    proxy_pass http://127.0.0.1:11976;          # ← 端口按你实际的填
    proxy_set_header Host 127.0.0.1:$server_port;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Scheme $scheme;
    proxy_connect_timeout 30s;
    proxy_read_timeout 86400s;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

这份配置对本项目的**结论**：

| 项 | 结论 |
|---|---|
| WebSocket 升级头 | ✅ 已有（`Upgrade` / `Connection` / `proxy_http_version 1.1`），**不用再单独加 `location /ws/`** |
| WS 长连接超时 | ✅ `proxy_read_timeout 86400s`，单人模式不会中途被掐 |
| 静态后缀规则截胡 | ✅ 没有 `location ~ .*\.(js\|css)$`，不存在「`/client/assets/*.js`（或 `/solo/assets/*.js`）被当静态文件 404」的问题 |
| `location /` 全量反代 | ⚠️ **所有请求都进后端**，`root` / `index` 实际没被用到 → 文件放在服务器哪个目录无所谓，**访问路径完全由后端决定** |
| 端口 | ⚠️ `proxy_pass` 里的端口必须与后端 `--urls` **完全一致**（当前是 `11976`，不是文档里示例的 `11030`）。二选一：改 nginx，或 `dotnet ... --urls http://127.0.0.1:11976` |
| `Host` 头被改写 | ⚠️ `proxy_set_header Host 127.0.0.1:$server_port;` 会把 Host 改成 `127.0.0.1:443`。本项目不生成绝对 URL，**当前无影响**；但这份配置**没发** `X-Forwarded-Host` / `X-Forwarded-Proto`（只发了非标准的 `X-Host` / `X-Scheme`），将来若要生成绝对链接，需要补这两个标准头 |
| 非 WS 请求也被送 `Connection: upgrade` | 小瑕疵，宝塔默认行为，实测无影响。想更严谨就把 `Connection` 换成按 `$http_upgrade` 映射（见 4.1） |

**所以在这份配置下，你唯一要做的是：把后端换成新版（带 `/client/` 与 `/solo/` 托管），然后用 `https://fun.milimoe.com/client/`、`https://fun.milimoe.com/solo/` 访问。nginx 一个字都不用动。**

### 4.1 全新站点（或想自己写配置）

宝塔「网站」→「添加站点」：域名填 `fun.milimoe.com`，PHP 版本选 **纯静态**（不需要 PHP），站点目录可填 `/www/wwwroot/fungame`。

然后进入站点 →「配置文件」，把 nginx 配置替换/调整为下面这版（保留宝塔自动生成的 `#SSL-START/#SSL-END` 和日志段落即可）：

```nginx
# WebSocket 升级映射；必须写在 http 上下文（宝塔站点配置本身就是 http 上下文，放文件顶部即可）
map $http_upgrade $fungame_conn_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name fun.milimoe.com;
    # ... 宝塔自动生成的 ssl_certificate / ssl_certificate_key 保持不动 ...

    access_log /www/wwwlogs/fun.milimoe.com.log;

    # WebSocket：必须单独放，且不能被任何静态规则截胡
    location /ws/ {
        proxy_pass http://127.0.0.1:11030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $fungame_conn_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 单人模式是长连接对局，超时必须放宽，否则会打到一半被 nginx 掐断
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
        proxy_buffering off;      # WS 必须关缓冲
    }

    # 其余全部（前端静态文件 + REST）都交给后端
    location / {
        proxy_pass http://127.0.0.1:11030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_connect_timeout 30s;
    }
}
```

### ⚠️ 一定要删掉宝塔默认的静态后缀规则

宝塔创建的纯静态站点会自带这几段，**它们会先于 `location /` 命中，把 `/client/assets/*.js`、`/solo/assets/*.js` 直接 404**：

```nginx
# 这两段必须删除或注释掉，否则 /client/ 与 /solo/ 页面白屏
# location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)$ { ... }
# location ~ .*\.(js|css)?$ { ... }
```

同理，如果站点目录里放了宝塔默认的 `index.html`/`404.html`，也一并删掉，避免 nginx 用 `index` 抢先响应 `/`。

改完 → 「保存」→ 「重载配置」。

---

## 5. 验证

| 检查项 | 期望 |
|---|---|
| `http://fun.milimoe.com/` | 回合回放 / 职业规划界面 |
| `http://fun.milimoe.com/client/` | 测试客户端（测试中心 / 房间 / 战斗对局 / 回放） |
| `http://fun.milimoe.com/solo/` | 单人模式，开局即可选角色 → 开始单人战斗 |
| `http://fun.milimoe.com/api/meta` | JSON（回合数等） |
| 单人模式连接状态 | 界面显示已连接（WS 握手成功） |
| 浏览器控制台 | 无 CORS 报错、无 `wss://` 握手失败 |

---

## 6. 关于跨域（CORS）

**结论：同源部署后根本不需要 CORS，跨域不会报错。**

原因：

1. 前端（`https://fun.milimoe.com/client/`、`https://fun.milimoe.com/solo/`）与后端（`https://fun.milimoe.com/api`、`wss://fun.milimoe.com/ws/solo`）**同一个源**，浏览器不触发预检。
2. 前端默认 API 地址是 `window.location.origin`（见 `webui-client/src/baseUrl.ts` 与 `webui-solo/src/baseUrl.ts`）—— 只有在本机 `localhost` 开发时才回落到 `http://localhost:11030`。所以换域名、换 HTTPS 都不用改代码，也**不会**出现"页面在 A 域名、请求发去 B 地址"的跨域。
3. 即便如此，WebAPI 侧仍保留了兜底策略（`WebAPI/Program.cs:84`）：

   ```csharp
   options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
   ```

   即从**别的来源**（例如你本地的 `localhost:5174` 调试、或另一个域名）直连线上后端也不会被拦。

需要留意的两点：

- **不要**改成 `AllowCredentials()` + 具体域名，除非同时把前端 `fetch` 都加上 `credentials: 'include'` —— 当前用的是 Bearer Token，不带 Cookie，现状最省事。
- **WebSocket 不受 CORS 限制**，它只看 `Origin` 头且 ASP.NET Core 默认不校验；真正会挂掉 WS 的是 nginx 少了 `Upgrade`/`Connection` 头和 `proxy_read_timeout` 太短（上面的配置已处理）。

---

## 方案 B：前端走宝塔纯静态站（备用）

不想让 WebAPI 托管静态文件时：

1. 站点目录填 `/www/wwwroot/fun.milimoe.com`，把 `publish\client-webui\` 的内容传进去。
   单人模式同理另建一个站点（或子目录），传 `publish\solo-webui\` 的内容。
2. `location /` 保持 nginx 自己发静态文件（**保留**默认静态规则）。
3. 只加两条反代，`/api` 之外还要带上 `/ws`：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:11030;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /ws/ {
    proxy_pass http://127.0.0.1:11030;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $fungame_conn_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
```

> 相对路径构建 + 同源默认地址，所以方案 A 与方案 B 用的是**同一份前端产物**，不需要分别构建。

---

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| `/client/`（或 `/solo/`）页面白屏、`assets/*.js` 404 | 没删宝塔默认的 `location ~ .*\.(js\|css)$` 静态规则（见 §4） |
| 502 Bad Gateway | 后端没起来，或 nginx 代理端口与 `--urls` 不一致。`curl 127.0.0.1:11030/api/meta` 自检 |
| 单人模式连上就断 / 打到一半掉线 | nginx 缺 `Upgrade` 头，或 `proxy_read_timeout` 默认 60s 掐了长连接 |
| 端口 11030 被占用 | 换端口：`--urls http://127.0.0.1:11031`，nginx 两处 `proxy_pass` 同步改 |
| 「模拟未产生新存档」 | 运行目录不可写：`chown -R www:www /www/wwwroot/fungame` |
| 页面一直白屏 / 转圈"打不开"，Network 里卡在 `fonts.googleapis.com` | Google Fonts 国内被墙。**源码里已改成非阻塞加载**（`media="print" onload="this.media='all'"`），字体下不到会回落到系统衬线字体，不影响功能。若用的是旧产物就重新构建一次；也可以把字体文件自托管或直接删掉那两行 `<link>` |
| 手改了产物里的 `index.html` 资源路径，重新构建又变回去 | 别改产物。用构建参数：`VITE_ASSET_PREFIX=client/ npm run build`（单人模式用 `VITE_ASSET_PREFIX=solo/`，见 §0 的表） |
| 更新版本 | 重新跑 `publish-linux.bat`，覆盖上传。**建议保留服务器上的 `rounds_archive.zip`**，不要用本地的覆盖（除非要重置存档） |
| 想看后端日志 | Supervisor：「进程守护管理器」→ 对应进程 → 日志；systemd：`journalctl -u fungame -f` |

---

## 附：Linux 自包含发布（不装 .NET 运行时）

```bash
dotnet publish WebAPI/FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 \
  --self-contained true -o publish/linux-x64
```

产物约 100MB，但目标机**无需**安装运行时，直接：

```bash
chmod +x /www/wwwroot/fungame/FunGame.Testing-v3.WebAPI
/www/wwwroot/fungame/FunGame.Testing-v3.WebAPI --urls http://127.0.0.1:11030
```

> 自包含版**不能**用 `dotnet xxx.dll` 启动（会报 hostpolicy 错误），必须直接跑可执行文件。
