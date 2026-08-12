# 宝塔面板部署指南（.NET 网站 / 反向代理）

本指南针对已生成的 `publish/linux-x64` 自包含发布版（Ubuntu 无需安装 .NET）。

> ⚠️ 关键前提：本项目是 **net10.0**，宝塔的 .NET 项目管理器可能不支持安装 .NET 10 运行时。
> 自包含发布版已包含全部运行时，**不依赖系统 .NET**，两种方案都可用。

## 0. 上传发布产物

1. 在 Windows 上执行 `bash publish-linux.sh` 生成 `publish/linux-x64/`（已生成）
2. 用宝塔「文件」管理器，把 `publish/linux-x64/` **整个目录**上传到服务器，建议路径：
   ```
   /www/wwwroot/fungame/
   ```
   （上传后目录结构：`/www/wwwroot/fungame/FunGame.Testing-v3.WebAPI` 等文件）

---

## 方案 A：Nginx 反向代理 + 进程守护（推荐）

后端监听内网端口，Nginx 负责对外 80/443 和域名。**不依赖宝塔的 .NET 支持**。

### A1. 创建网站

1. 宝塔面板 → 「网站」→「添加站点」
2. 域名填你的域名（或服务器 IP），**PHP 版本选择「纯静态」**，提交创建
3. 站点目录随意（静态文件由后端提供，这里只是占位域名）

### A2. 配置反向代理

1. 进入该站点 → 「反向代理」→「添加反向代理」
2. 配置：
   - 代理名称：`fungame`
   - 目标 URL：`http://127.0.0.1:5000`
   - 提交后点「配置文件」确认（或直接使用生成的默认配置即可）

### A3. 启动后端进程

用宝塔「进程守护管理器」（软件商店安装，Supervisor）：

1. 软件商店 → 安装「进程守护管理器」
2. 添加守护进程：
   ```
   名称:          fungame
   运行目录:      /www/wwwroot/fungame
   启动命令:      ./FunGame.Testing-v3.WebAPI --urls http://127.0.0.1:5000
   进程数量:      1
   运行用户:      www
   ```
3. 保存并启动，状态应为「运行中」

> 也可以改用 systemd（宝塔设置 → 添加计划任务时不行，需 SSH），方式见文末附录。

### A4. 验证

- 浏览器访问 `http://你的域名/` 应看到 WebUI
- 访问 `http://你的域名/api/meta` 应返回 JSON（回合数等）
- 点击侧边栏「跑一局团队模拟」验证模拟流程

### A5. 防火墙/安全组

- 只放行 **80 / 443**（Nginx）
- **5000 端口无需对外放行**（仅内网反代使用），避免直接暴露

---

## 方案 B：宝塔「.NET 项目」站点类型（推荐给已支持 .NET 10 的宝塔）

宝塔能管理 .NET 10 时，用**框架依赖版**发布产物 `publish/linux-x64-fd`（约 4MB），
宝塔自动用 `dotnet` 托管，与宝塔 .NET 站点表单完全匹配。

### B1. 生成框架依赖版（Windows 上执行一次）

```bash
dotnet publish WebAPI/FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 --self-contained false -o publish/linux-x64-fd
mkdir -p publish/linux-x64-fd/webui
cp -r webui/dist publish/linux-x64-fd/webui/dist
cp rounds_archive.zip publish/linux-x64-fd/rounds_archive.zip
```

（已生成，直接上传 `publish/linux-x64-fd/` 整个目录到 `/www/wwwroot/fungame/`）

### B2. 添加 .NET 项目站点

1. 宝塔「软件商店」安装/打开「.NET 项目管理器」，确认已安装 **.NET 10.x 运行时**
2. 「网站」→「添加站点」→ 站点类型选 **「.NET 项目」**
3. 表单填写：

   | 配置项 | 值 |
   |---|---|
   | 项目目录（运行目录） | `/www/wwwroot/fungame` |
   | **启动命令（dll 路径）** | `/www/wwwroot/fungame/FunGame.Testing-v3.WebAPI.dll` |
   | **项目端口** | `5000` |
   | .NET 版本 | 选择已安装的 10.x |
   | 运行地址 | `127.0.0.1`（配反向代理）或 `0.0.0.0`（直连） |
   | 启动类型 | 自动 |

4. 提交后宝塔自动创建 systemd 服务并启动

### B3. 域名访问

- 宝塔会自动为 .NET 站点生成 Nginx 反向代理（域名 → `127.0.0.1:5000`），创建时填域名即可
- 直连模式则访问 `http://服务器IP:5000`（需安全组放行 5000）

### B4. 验证

同 A4。若端口对外不可访问，检查宝塔安全组放行该端口，或加反向代理走 80/443。

---

## 常见问题

| 问题 | 解决 |
|---|---|
| 提示 `Permission denied` 无法启动 | 文件管理器右键 `FunGame.Testing-v3.WebAPI` → 权限 → 勾选执行（或 SSH 执行 `chmod +x`） |
| 端口 5000 被占用 | 换端口：启动命令加 `--urls http://127.0.0.1:5001`，反代目标同步改 |
| 模拟按钮提示「模拟未产生新存档」 | 运行目录没有写权限。确认守护进程/站点的运行目录是 `/www/wwwroot/fungame` 且 www 用户可写（`chown -R www:www /www/wwwroot/fungame`） |
| 页面能开但数据是旧的 | 存档在 `rounds_archive.zip`。模拟新一局后前端自动刷新；或点「重新加载存档」 |
| 更新版本 | 重新在 Windows 跑 `publish-linux.sh`，上传覆盖（**建议保留服务器上的 `rounds_archive.zip`，不要用本地的覆盖**，除非你想重置存档） |
| 想用系统 .NET 跑 | 自包含版不能 `dotnet xxx.dll`（会报 hostpolicy 错误）。若要用 dotnet 命令运行，需改发布为框架依赖版（见附录） |

---

## 附录：systemd 方式（SSH，不依赖宝塔表单）

```bash
# /etc/systemd/system/fungame.service（自包含版）
[Unit]
Description=FunGame Testing WebUI
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/www/wwwroot/fungame
ExecStart=/www/wwwroot/fungame/FunGame.Testing-v3.WebAPI --urls http://127.0.0.1:5000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

框架依赖版将 ExecStart 改为：
`ExecStart=/usr/bin/dotnet /www/wwwroot/fungame/FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:5000`

```bash
systemctl daemon-reload
systemctl enable --now fungame
journalctl -u fungame -f   # 查看日志
```
