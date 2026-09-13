# FunGame 单人模式（webui-solo）

**单人模式独立客户端** —— 从 `webui-client` 拆出来的移动端竖版界面，基于 **React 19 + Vite 6 + Tailwind CSS v4**，羊皮纸 / 金色奇幻主题。

单局规则：服务器权威计算，**1 名人类 vs 9 名 AI**（5V5 团队或混战），基于 FunGame.Core v3 `MixGamingQueue`。

## 功能

| 区域 | 说明 |
|---|---|
| **开局设置** | 引擎地址（默认 `http://localhost:11030`）、对局模式（5V5 团队 / 混战）、参战人数、角色等级、技能等级、回合间隔、每队人数、夺冠人头 |
| **顶栏** | 回合 / 用时 / 比分 · 暂停 · 设置 · 终止对局 |
| **左侧** | 行动顺序表（竖条，含玩家决策点） |
| **中央** | 大地图（棋子正上方血条，黄=攻击/施法距离，绿=移动距离） |
| **右侧** | 统一功能按钮列：操作 / 日志 / 队伍 —— 点击弹出右侧小窗，可随时关掉 |
| **底部** | 仅在地图上选目标 / 选格子时出现「确认」条（勾选与确认分离） |

交互约定：移动 / 普攻「勾选 → 看详情 → 确认」；技能 / 爆发技 / 物品点一下直达下级菜单。

## 启动步骤

```bash
# 1. 启动后端 FunGame.Testing-v3 WebAPI（单人局引擎，默认 http://localhost:11030）
cd C:\milimoe\FunGame.Testing-v3\WebAPI
dotnet run

# 2. 启动本客户端（http://localhost:5175）
cd C:\milimoe\FunGame.Testing-v3\webui-solo
npm install
npm run dev
```

浏览器访问 <http://localhost:5175>，点「连接」→「开始单人战斗」。

> 引擎地址也可以在页面里直接改；非本机环境下默认跟随 `window.location.origin`（见 `src/baseUrl.ts`），所以线上同源部署不用配置。

## 代理说明

`vite.config.ts` 已配置代理，本机开发无需处理跨域：

- `/api` → `http://localhost:11030`（REST）
- `/ws` → `ws://localhost:11030`（WebSocket，单人局走 `/ws/solo`）

## 目录结构

```
webui-solo/
├── src/
│   ├── App.tsx           # 入口：整页渲染 SoloPanel（无 Tab 切换）
│   ├── baseUrl.ts        # 默认引擎地址解析（本机回落 localhost:11030，否则同源）
│   ├── index.css         # Tailwind v4 主题（羊皮纸/墨色/金）+ 单人模式浮层动效
│   ├── components/
│   │   ├── SoloPanel.tsx        # 主容器：状态机 + 顶栏 + 三个浮层入口
│   │   ├── SoloMap.tsx          # 大地图（棋子 / 血条 / 距离高亮 / 点选）
│   │   ├── SoloActionPanel.tsx  # 操作小窗（移动 / 普攻 / 技能 / 物品 / 决策）
│   │   ├── SoloQueue.tsx        # 行动顺序表
│   │   ├── SoloRoster.tsx       # 队伍面板
│   │   ├── SoloCharDetail.tsx   # 角色详情
│   │   ├── SoloLog.tsx          # 战斗日志
│   │   ├── SoloTurnBanner.tsx   # 回合 / 轮到你行动 提示
│   │   ├── SoloFloatingPanel.tsx# 通用浮层骨架（抽屉 / 模态）
│   │   └── soloFormat.ts        # 数值格式化
│   └── game/
│       ├── soloTypes.ts   # 单人局协议类型（DTO / 决策请求）
│       ├── soloClient.ts  # 对局通道抽象（当前实现：直连 /ws/solo）
│       └── useSoloGame.ts # React hook：连接 / 开局 / 决策 / 事件流
```

## 协议速查

- 通道：WebSocket `/ws/solo`，REST `/api/solo/*`（暂停 / 排行）
- 决策（服务器下发 → 玩家回包）：`ActionType` / `Skill` / `Item` / `Inquiry` / `Continue` / `Targets` / `TargetGrid` / `TargetGrids`
- 超时未响应时服务器自动托管，正常游玩路径见 `solo-autoplay-check.mjs`（在 `webui-client/` 下，直连 WS 回归）

## 部署

与另外两个前端一起由 WebAPI 托管（`/solo/`），或单独作为静态站上传。详见仓库根目录 `DEPLOY-BT.md`，构建产物由 `publish-linux.bat` / `publish-linux.sh` 生成到 `publish/solo-webui/`。

> 发布脚本会产出两份产物：`publish/solo-webui/`（相对路径，静态站根目录可直接跑）与
> `publish/linux-x64-fd/webui-solo/dist/`（资源带 `solo/` 前缀，WebAPI 托管在 `/solo/`，
> 从 `/solo` 不带斜杠打开也能命中资源）。两者都是同源 API，换域名不用重新构建；
> 不要手改产物里的 `index.html`，要改资源路径用 `VITE_ASSET_PREFIX`（如 `VITE_ASSET_PREFIX=solo/ npm run build`）。
