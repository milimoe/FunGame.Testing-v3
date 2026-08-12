# FunGame.Testing-v3

AI 对战模拟器（net10.0 控制台应用）：让 10 个 AI 控制的角色自动对战，逐回合记录战斗数据并归档到 `rounds_archive.zip`（内含 `rounds_data.json`）。

## Web UI（React + Tailwind）

可视化回放台，包含三个面板：

- **赛后统计**：Rating 排行榜（K/D/A、伤害、治疗、胜率）、伤害/治疗对比、队伍结果
- **回合回放**：逐回合浏览行动流（伤害/暴击/闪避/免疫、特效记录、击杀消息），支持自动播放
- **状态快照**：检查点回合的全角色 HP/MP/装备/技能/特效状态

### 架构（单项目）

```
WebAPI/    ASP.NET Core Web API（net10.0）— 唯一项目
│          ├── 模拟器源码（Tests/、OshimaGameModules/、Others/，原 FunGame.Testing-v3 已并入）
│          ├── Services/ArchiveStore.cs — 读取 rounds_archive.zip
│          └── Program.cs — 入口（模块初始化 + API + 静态托管前端）
webui/     React + Vite + TypeScript + Tailwind v4 前端
```

> 原 FunGame.Testing-v3 控制台项目已合并进 WebAPI（`FunGame.Testing-v3.csproj` 已删除），
> 解决方案仅保留 `FunGame.Core` + `FunGame.Testing-v3.WebAPI` 两个项目。

### 启动步骤

```bash
# 1. 启动后端（端口 5000）
cd WebAPI
dotnet run

# 2. 启动前端（端口 5173，已配置 /api 代理到 5000）
cd webui
npm install
npm run dev
```

浏览器访问 <http://localhost:5173>。

### API 列表

| 端点 | 说明 |
|---|---|
| `GET /api/meta` | 存档元信息（回合数、模式、角色、队伍） |
| `GET /api/rounds/summary?from=&to=` | 回合摘要列表（轻量，供时间轴渲染） |
| `GET /api/rounds/{n}` | 单回合完整数据（与存档一致的 JSON 格式） |
| `GET /api/statistics` | 最终统计（Rating 排行榜 + 队伍结果） |
| `POST /api/reload` | 手动重载存档 |
| `POST /api/simulate/team` | 触发一局团队模拟并立即输出存档 |

### 团队模拟

侧边栏「跑一局团队模拟」按钮（或直接调用 `POST /api/simulate/team`）：

- **进程内直接调用**静态模拟类 `FunGameSimulation.StartSimulationGame`（模拟器源码已并入本项目），无需跨进程
- 模拟数据仅存在于方法作用域内，返回后由 GC 回收——服务进程零数据残留
- 模拟结束自动覆盖 `rounds_archive.zip` 并强制重载缓存，前端随后刷新展示新数据
- 并发保护：已有模拟进行中时返回 409

### Ubuntu 部署（Linux x64 自包含）

在 Windows 上执行一次发布脚本（需已装 .NET 10 SDK + Node.js）：

```bash
bash publish-linux.sh
```

产物在 `publish/linux-x64/`（自包含，Ubuntu 无需安装 .NET），包含：

- `FunGame.Testing-v3.WebAPI` — 后端可执行文件
- `FunGame.Testing-v3.WebAPI.dll` + 全部运行时（self-contained）
- `FunGame.Testing-v3.dll` — 模拟类库（进程内调用）
- `webui/dist/` — 前端构建产物（后端自动托管）
- `rounds_archive.zip` — 初始存档

部署：

```bash
# 把 publish/linux-x64 整个目录复制到 Ubuntu
chmod +x FunGame.Testing-v3.WebAPI
./FunGame.Testing-v3.WebAPI
```

浏览器访问 `http://<服务器IP>:5000`（默认监听 `0.0.0.0:5000`，可在 `appsettings.json` 的 `Urls` 修改）。

说明：

- 存档路径：优先 `Archive:ZipPath` 配置，其次发布目录内 `rounds_archive.zip`，最后开发目录（仓库根）
- 每跑一局模拟后存档自动更新；如需重置存档，重新复制 `rounds_archive.zip` 或运行新的模拟
- 前端构建产物变化后需重新执行 `publish-linux.sh`

### 数据刷新

模拟程序每跑完一局会覆盖 `rounds_archive.zip`。后端每次请求都会检测文件时间戳并自动重载；
前端侧边栏也有「重新加载存档」按钮（调用 `/api/reload` 后刷新页面）。

### 生产模式（单后端部署）

```bash
cd webui && npm run build
cd ../WebAPI && dotnet run
```

构建产物 `webui/dist` 会被 WebAPI 自动托管，直接访问 <http://localhost:5000> 即可。

### 常见问题

- **存档路径**：默认读取仓库根目录的 `rounds_archive.zip`，可用 `appsettings.json` 的 `Archive:ZipPath` 覆盖。
- **端口冲突**：后端端口在 `WebAPI/appsettings.json` 的 `Urls` 配置；前端代理目标在 `webui/vite.config.ts`。
