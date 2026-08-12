#!/usr/bin/env bash
# ============================================================
# 发布 FunGame.Testing-v3 WebUI 的 Linux x64 自包含版本
# 产物在 publish/linux-x64，复制到 Ubuntu 后直接运行：
#   ./FunGame.Testing-v3.WebAPI
# 访问 http://<服务器IP>:5000
# ============================================================
set -e
cd "$(dirname "$0")"

echo "==> 1/4 构建前端 (webui/dist)"
(cd webui && npm run build)

echo "==> 2/4 发布后端 (linux-x64 自包含，无需安装 .NET)"
rm -rf publish/linux-x64
dotnet publish WebAPI/FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 --self-contained true -o publish/linux-x64

echo "==> 3/4 复制前端产物与存档到发布目录"
mkdir -p publish/linux-x64/webui
cp -r webui/dist publish/linux-x64/webui/dist
cp rounds_archive.zip publish/linux-x64/rounds_archive.zip

echo "==> 4/4 完成"
echo ""
echo "发布产物: publish/linux-x64"
echo "部署方法: 将 publish/linux-x64 整个目录复制到 Ubuntu，然后执行:"
echo "  chmod +x FunGame.Testing-v3.WebAPI"
echo "  ./FunGame.Testing-v3.WebAPI"
echo "浏览器访问: http://<服务器IP>:5000"
