# FunGame Server 测试客户端（webui-client）

面向 **FunGame.Server-v3** 的网页版协同测试客户端。基于 **React 19 + Vite 6 + Tailwind CSS v4**，UI 参照 `docs_internal/01-WebUI.txt`、`02-MobileUI.txt` 的二次元幻想风设计稿（深蓝紫底 / 金 / 蓝 / 红），针对 FunGame.Core 战斗系统适配。

## 功能

| 面板 | 说明 |
|---|---|
| **测试中心** | 预设测试用例库（认证 / 用户中心 / 对局回放 / 经济 / 系统 / 管理 / WebSocket / 房间匹配），一键执行；手动请求构造器；结果卡片展示 状态（成功/失败/进行中）、响应时间、错误信息、请求/响应 JSON（可折叠） |
| **战斗对局** | 回合制交互界面：顶部双方阵容 + 金色回合计数器、中央角色战场（HP/MP 条、状态、阵营蓝红配色）、底部「开始行动 / 自动 / ×2 加速」操作区、对局事件流、结算横幅；`match.start` 发起 5 人 AI 对战，`gaming.round` 实时推送 |
| **回放** | 从 `/api/gamerecords` 拉取对局记录 → 元信息 / 回合时间轴 / 单回合完整 RoundRecord / 最终统计 |

支持：登录/注册（JWT）、WebSocket 连接状态监控（含心跳 `system.ping`）、响应式布局（桌面双栏 ↔ 移动端纵向分层）。

## 启动步骤

```bash
# 1. 启动后端 FunGame.Server-v3（默认 http://localhost:5000）
cd C:\milimoe\FunGame.Server-v3
dotnet run --project src/FunGame.Server.Host

# 2. 启动本客户端（http://localhost:5174）
cd C:\milimoe\FunGame.Testing-v3\webui-client
npm install
npm run dev
```

浏览器访问 <http://localhost:5174>。

> 默认账号 `admin / admin123456`（由 Server `appsettings.json` 的 `Bootstrap:Admin` 配置，首次启动生效）。

## 代理说明

`vite.config.ts` 已配置代理，客户端无需处理跨域：

- `/api` → `http://localhost:5000`（REST）
- `/ws` → `ws://localhost:5000`（WebSocket）

如需连接其他地址，直接在页面顶部「服务器」输入框修改（如 `http://192.168.x.x:5000`）。

> CORS：Server 的 `AllowOrigins` 已放行 `http://localhost:5174` 与 `http://127.0.0.1:5174`（`FunGame.Server-v3/src/FunGame.Server.Host/appsettings.json`），因此顶部输入框直连 `http://localhost:5000` 时 REST 请求可直接跨域；走 vite 代理（5174 同源）时则无 CORS 限制。WebSocket 握手不受 CORS 影响。

## 建议测试流程

1. **连通性**：顶部「测试连接」→ 期望 HTTP 401（认证保护正常）
2. **认证**：登录 `admin / admin123456` → 顶部出现用户与角色徽章
3. **REST 用例**：测试中心逐组执行，观察结果卡片（状态 / 耗时 / 错误）
4. **WS 用例**：登录后点「连接 WS」→ 状态变为 `open` → 执行 `system.info`、`room.list` 等
5. **对局**：切到「战斗对局」→「开始行动」→ 观察回合计数与角色 HP 实时更新 → 结算横幅
6. **回放**：切到「回放」→ 选择对局 → 浏览回合时间轴与完整 JSON

## 目录结构

```
webui-client/
├── src/
│   ├── api.ts            # REST 客户端（ApiResponse 解包 + 耗时测量）
│   ├── ws.ts             # WebSocket 客户端（信封协议 + 心跳 + 响应关联）
│   ├── store.tsx         # 全局状态（连接/认证/WS/测试记录/对局事件/战斗状态）
│   ├── testCases.ts      # 预设测试用例库
│   ├── types.ts          # 类型定义（ApiResponse / MessageEnvelope / RoundRecord 等）
│   └── components/
│       ├── TopBar.tsx        # 顶部：服务器地址 + 登录/注册 + WS 连接
│       ├── TestCenter.tsx    # 测试中心（用例执行 + 手动请求）
│       ├── TestResultCard.tsx# 结果卡片（状态/耗时/错误/JSON）
│       ├── JsonView.tsx      # JSON 语法高亮查看器
│       ├── BattleView.tsx    # 战斗面板（回合制交互 + 事件流 + 结算）
│       └── ReplayPanel.tsx   # 回放浏览
```

## 协议速查

- REST：统一 `ApiResponse<T>` 包装（`ok / code / message / data`）
- WS：`MessageEnvelope` 信封（`t` 类型 / `i` 请求序号 / `ok` / `error` / `d` 负载 / `ts` 时间戳）
- 关键消息类型：`system.ping`、`system.info`、`room.list/create/join/chat/start`、`match.start`、`gaming.start/round/over`
- 回合记录（`gaming.round` 的 `d.round`）：PascalCase，与 Core 转换器输出一致（`RoundRecord` 结构，含 `AllCharacters / Checkpoint / Actions / Damages / GameResult`）
