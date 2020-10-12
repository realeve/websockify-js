@echo on 
pkg "./websockify/websockify.js" --targets "latest-win-x86" --out-path ws
del .\ws\ws.exe
rename .\ws\*.exe ws.exe
echo 打包完成
@pause