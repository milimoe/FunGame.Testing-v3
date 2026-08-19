@echo off
:: ============================================================
:: 发布 FunGame.Testing-v3 WebAPI + WebUI 的 Linux x64 框架依赖版 (fd)
:: (在 Windows 上交叉编译，产物在 publish/linux-x64-fd，约 4MB)
:: 目标机需已安装 .NET 10 运行时
:: 复制到 Ubuntu/宝塔后直接运行:
::   dotnet FunGame.Testing-v3.WebAPI.dll
:: 访问 http://<服务器IP>:5000
:: ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==^> 1/5 清理旧的 WebUI 与发布产物
if exist webui\dist rmdir /s /q webui\dist
if exist publish\linux-x64-fd rmdir /s /q publish\linux-x64-fd

echo ==^> 2/5 构建前端 (webui/dist)
pushd webui
call npm install
if errorlevel 1 (
  echo [错误] npm install 失败
  popd
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo [错误] npm run build 失败
  popd
  exit /b 1
)
popd

echo ==^> 3/5 发布后端 (linux-x64 框架依赖, --self-contained false, 需目标机装 .NET 10)
dotnet publish WebAPI\FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 --self-contained false -o publish\linux-x64-fd
if errorlevel 1 (
  echo [错误] dotnet publish 失败
  exit /b 1
)

echo ==^> 4/5 复制前端产物与存档到发布目录
if not exist publish\linux-x64-fd\webui mkdir publish\linux-x64-fd\webui
xcopy /e /i /y webui\dist publish\linux-x64-fd\webui\dist
if exist rounds_archive.zip (
  copy /y rounds_archive.zip publish\linux-x64-fd\rounds_archive.zip
)

echo ==^> 5/5 完成
echo.
echo 发布产物: publish\linux-x64-fd (框架依赖版, 约 4MB, 需目标机安装 .NET 10 运行时)
echo 部署方法: 将 publish\linux-x64-fd 整个目录复制到 Ubuntu/宝塔, 然后执行:
echo   dotnet FunGame.Testing-v3.WebAPI.dll
echo 浏览器访问: http://^^<服务器IP^^>:5000

endlocal
