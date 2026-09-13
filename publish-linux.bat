@echo off
:: ============================================================
:: 发布 FunGame.Testing-v3 的 Linux x64 框架依赖版 (fd) + 前端
::
:: 用法：
::   publish-linux.bat
::
:: 产物结构：
::   publish\linux-x64-fd\            后端 + 前端（整套部署，nginx 只反代一个端口）
::     FunGame.Testing-v3.WebAPI.dll
::     webui\dist\                    回合回放 / 职业规划      → 挂在 /
::     webui-client\dist\             测试客户端              → 挂在 /client/
::                                    资源以绝对子路径 /client/ 引用：/client 与 /client/ 都能命中
::     webui-solo\dist\               单人模式（竖版手游）    → 挂在 /solo/
::                                    资源以绝对子路径 /solo/ 引用：/solo 与 /solo/ 都能命中
::   publish\client-webui\            webui-client 的独立静态站构建（相对路径版，站点根目录可直接跑）
::   publish\solo-webui\              webui-solo 的独立静态站构建（相对路径版，站点根目录可直接跑）
::
:: 目标机（宝塔 / Ubuntu）需已安装 .NET 10 运行时，然后：
::   dotnet FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:<nginx 里反代的端口>
::
:: 注意：本脚本用 goto 标签做错误处理（cmd 解析带转义括号的多行
::       if/else 分支块会失效，两分支都执行），不要改成多行 if/else。
:: ============================================================
setlocal
cd /d "%~dp0"

echo ==^> 1/7 清理旧的前端产物与发布目录
if exist webui\dist rmdir /s /q webui\dist
if exist webui-client\dist rmdir /s /q webui-client\dist
if exist webui-solo\dist rmdir /s /q webui-solo\dist
if exist publish\linux-x64-fd rmdir /s /q publish\linux-x64-fd
if exist publish\client-webui rmdir /s /q publish\client-webui
if exist publish\solo-webui rmdir /s /q publish\solo-webui

echo ==^> 2/7 构建 webui 回合回放 + 职业规划
pushd webui
call npm install
if errorlevel 1 goto err_webui_install
call npm run build
if errorlevel 1 goto err_webui_build
popd

echo ==^> 3/7 构建 webui-client 测试客户端 两份产物
pushd webui-client
call npm install
if errorlevel 1 goto err_client_install
:: 产物一：相对路径版 → publish\client-webui 独立静态站（站点根目录可直接跑）
call npm run build
if errorlevel 1 goto err_client_build
popd
if not exist publish\client-webui mkdir publish\client-webui
xcopy /e /i /y webui-client\dist publish\client-webui >nul
if errorlevel 1 goto err_copy
pushd webui-client
:: 产物二：资源以绝对子路径 /client/ 引用 → WebAPI 托管。相对路径 ./assets 在 /client
:: （不带斜杠）打开时会被解析到 /assets（落回根路径的回合回放站），而相对前缀 client/ 又会
:: 在 /client/（带斜杠）下变成 /client/client/；绝对子路径两种入口都正确命中。
set VITE_BASE=/client/
call npm run build
set VITE_BASE=
if errorlevel 1 goto err_client_build
popd

echo ==^> 4/7 构建 webui-solo 单人模式 两份产物
pushd webui-solo
call npm install
if errorlevel 1 goto err_solo_install
:: 产物一：相对路径版 → publish\solo-webui 独立静态站（站点根目录可直接跑）
call npm run build
if errorlevel 1 goto err_solo_build
popd
if not exist publish\solo-webui mkdir publish\solo-webui
xcopy /e /i /y webui-solo\dist publish\solo-webui >nul
if errorlevel 1 goto err_copy
pushd webui-solo
:: 产物二：资源以绝对子路径 /solo/ 引用 → WebAPI 托管。相对路径 ./assets 在 /solo
:: （不带斜杠）打开时会被解析到 /assets（落回根路径的回合回放站），而相对前缀 solo/ 又会
:: 在 /solo/（带斜杠）下变成 /solo/solo/；绝对子路径两种入口都正确命中。
set VITE_BASE=/solo/
call npm run build
set VITE_BASE=
if errorlevel 1 goto err_solo_build
popd

echo ==^> 5/7 发布后端 linux-x64 框架依赖 需目标机装 .NET 10
dotnet publish WebAPI\FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 --self-contained false -o publish\linux-x64-fd --no-restore
if not errorlevel 1 goto step6
echo       --no-restore 失败 尝试恢复依赖后重新发布
dotnet publish WebAPI\FunGame.Testing-v3.WebAPI.csproj -c Release -r linux-x64 --self-contained false -o publish\linux-x64-fd
if errorlevel 1 goto err_publish

:step6
echo ==^> 6/7 复制前端产物进发布目录 WebAPI 直接托管
if not exist publish\linux-x64-fd\webui mkdir publish\linux-x64-fd\webui
xcopy /e /i /y webui\dist publish\linux-x64-fd\webui\dist >nul
if errorlevel 1 goto err_copy
if not exist publish\linux-x64-fd\webui-client mkdir publish\linux-x64-fd\webui-client
xcopy /e /i /y webui-client\dist publish\linux-x64-fd\webui-client\dist >nul
if errorlevel 1 goto err_copy
if not exist publish\linux-x64-fd\webui-solo mkdir publish\linux-x64-fd\webui-solo
xcopy /e /i /y webui-solo\dist publish\linux-x64-fd\webui-solo\dist >nul
if errorlevel 1 goto err_copy

echo ==^> 7/7 收尾 复制回合存档
if exist rounds_archive.zip copy /y rounds_archive.zip publish\linux-x64-fd\rounds_archive.zip >nul

echo ==^> 完成
echo.
echo 整套部署 : 上传 publish\linux-x64-fd 到后端运行目录
echo            后端 ContentRoot 下需要有 webui\dist、webui-client\dist 与 webui-solo\dist
echo            启动: dotnet FunGame.Testing-v3.WebAPI.dll --urls http://127.0.0.1:^<端口^>
echo                  端口必须与 nginx proxy_pass 的端口一致
echo            访问: /          回合回放 + 职业规划
echo                  /client/   测试客户端 （/client 不带斜杠同样可用）
echo                  /solo/     单人模式 （/solo 不带斜杠同样可用）
echo 静态站方案: 上传 publish\client-webui 到站点目录
echo             上传 publish\solo-webui 到站点目录
echo.
echo 注意: 前端已构建为同源 API，域名换了也不用重新构建。
echo       publish\client-webui 与 publish\solo-webui 是相对路径产物（独立静态站用）；
echo       webui-client / webui-solo 的 WebAPI 托管版资源以绝对子路径 /client/ 与 /solo/ 引用。
echo       不要手改产物里的 index.html（下次构建就丢），要改资源路径请用 VITE_ASSET_PREFIX。
goto :eof

:err_webui_install
echo [错误] webui 的 npm install 失败
popd
exit /b 1

:err_webui_build
echo [错误] webui 的 npm run build 失败
popd
exit /b 1

:err_client_install
echo [错误] webui-client 的 npm install 失败
popd
exit /b 1

:err_client_build
echo [错误] webui-client 的 npm run build 失败
popd
exit /b 1

:err_solo_install
echo [错误] webui-solo 的 npm install 失败
popd
exit /b 1

:err_solo_build
echo [错误] webui-solo 的 npm run build 失败
popd
exit /b 1

:err_publish
echo [错误] dotnet publish 失败
exit /b 1

:err_copy
echo [错误] 复制产物失败
exit /b 1

endlocal
