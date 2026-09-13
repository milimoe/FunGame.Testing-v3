#!/usr/bin/env bash
# ============================================================
# 发布 FunGame.Testing-v3 的 Linux x64 框架依赖版 (fd) + 前端
#
# 用法：
#   bash publish-linux.sh
#
# 产物结构：
#   publish/linux-x64-fd/            后端 + 前端（整套部署，nginx 只反代一个端口）
#     FunGame.Testing-v3.WebAPI.dll
#     webui/dist/                    回合回放 / 职业规划      → 挂在 /
#     webui-client/dist/             测试客户端              → 挂在 /client/
#                                    资源以绝对子路径 /client/ 引用：/client 与 /client/ 都能命中
#     webui-solo/dist/               单人模式（竖版手游）    → 挂在 /solo/
#                                    资源以绝对子路径 /solo/ 引用：/solo 与 /solo/ 都能命中
#   publish/client-webui/            webui-client 的独立静态站构建（相对路径版）
#   publish/solo-webui/              webui-solo 的独立静态站构建（相对路径版）
#
# 目标机（宝塔 / Ubuntu）需已安装 .NET 10 运行时，然后：
#   dotnet FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:<nginx 里反代的端口>
# ============================================================
set -e
cd "$(dirname "$0")"

echo "==> 1/7 清理旧产物"
rm -rf webui/dist webui-client/dist webui-solo/dist \
  publish/linux-x64-fd publish/client-webui publish/solo-webui

echo "==> 2/7 构建 webui (回合回放 + 职业规划)"
(cd webui && npm install && npm run build)

echo "==> 3/7 构建 webui-client (Server 端点测试客户端, 两份产物)"
# 产物一：相对路径版 → publish/client-webui 独立静态站（站点根目录可直接跑）
(cd webui-client && npm install && npm run build)
mkdir -p publish/client-webui
cp -r webui-client/dist/. publish/client-webui/
# 产物二：资源以绝对子路径 /client/ 引用 → WebAPI 托管。相对路径 ./assets 在 /client
# （不带斜杠）打开时会被解析到 /assets，而相对前缀 client/ 又会在 /client/ 下变成 /client/client/；
# 绝对子路径两种入口都正确命中。
(cd webui-client && VITE_BASE=/client/ npm run build)

echo "==> 4/7 构建 webui-solo (单人模式, 两份产物)"
# 产物一：相对路径版 → publish/solo-webui 独立静态站（站点根目录可直接跑）
(cd webui-solo && npm install && npm run build)
mkdir -p publish/solo-webui
cp -r webui-solo/dist/. publish/solo-webui/
# 产物二：资源以绝对子路径 /solo/ 引用 → WebAPI 托管。相对路径 ./assets 在 /solo
# （不带斜杠）打开时会被解析到 /assets，而相对前缀 solo/ 又会在 /solo/ 下变成 /solo/solo/；
# 绝对子路径两种入口都正确命中。
(cd webui-solo && VITE_BASE=/solo/ npm run build)

echo "==> 5/7 发布后端 (linux-x64 框架依赖, --self-contained false)"
dotnet publish WebAPI/FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 \
  --self-contained false -o publish/linux-x64-fd --no-restore \
  || dotnet publish WebAPI/FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 \
       --self-contained false -o publish/linux-x64-fd

echo "==> 6/7 复制前端产物与存档到发布目录"
mkdir -p publish/linux-x64-fd/webui publish/linux-x64-fd/webui-client publish/linux-x64-fd/webui-solo
cp -r webui/dist publish/linux-x64-fd/webui/dist
cp -r webui-client/dist publish/linux-x64-fd/webui-client/dist
cp -r webui-solo/dist publish/linux-x64-fd/webui-solo/dist

echo "==> 7/7 收尾 复制回合存档"
if [ -f rounds_archive.zip ]; then
  cp rounds_archive.zip publish/linux-x64-fd/rounds_archive.zip
fi

echo ""
echo "整套部署 : 上传 publish/linux-x64-fd 到后端运行目录"
echo "           后端 ContentRoot 下需要有 webui/dist、webui-client/dist 与 webui-solo/dist"
echo "           启动: dotnet FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:<端口>"
echo "                 (端口必须与 nginx proxy_pass 的端口一致)"
echo "           访问: /          -> 回合回放 + 职业规划"
echo "                 /client/   -> 测试客户端（/client 不带斜杠同样可用）"
echo "                 /solo/     -> 单人模式（/solo 不带斜杠同样可用）"
echo "静态站方案: 上传 publish/client-webui 到站点目录"
echo "           上传 publish/solo-webui 到站点目录"
echo ""
echo "注意: 前端已构建为同源 API，域名换了也不用重新构建。"
echo "      publish/client-webui 与 publish/solo-webui 是相对路径产物（独立静态站用）；"
echo "      webui-client / webui-solo 的 WebAPI 托管版资源以绝对子路径 /client/ 与 /solo/ 引用。"
echo "      不要手改产物里的 index.html（下次构建就丢），要改资源路径请用 VITE_BASE / VITE_ASSET_PREFIX。"
