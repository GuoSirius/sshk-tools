; 安装 / 卸载前先结束运行中的 sshk-tools 进程（用户 2026-11-18：每次安装都提示
; 「关闭应用失败」须手动卸载，根治）。
;
; 背景：本应用的「关闭」路径是交互式的——默认点关闭弹确认框，开了「最小化到托盘」
; 则直接隐藏到托盘，进程都不会退出。electron-builder 默认检测（PowerShell CIM 按
; 路径找进程 → 优雅关闭 → 强杀 → MessageBox 重试）在这两种行为下必然走向
; appCannotBeClosed 页面；PowerShell 被策略限制时还会退化成不含 /F 的 taskkill。
;
; 方案（三个 hook 全覆盖）：
; 1. customCheckAppRunning —— 完全替换默认检测（模板 !ifmacrodef 分支），安装器与
;    卸载器共用：纯 taskkill /F 循环强杀，无任何 MessageBox，超时后静默继续；
; 2. customInit —— .onInit 里再杀一次：覆盖「升级安装」路径，因为该路径会 ExecWait
;    旧版本自带的旧卸载器（其内部还是旧版检测逻辑，进程残留会让它退非 0，重试
;    5 次后同样弹「无法关闭」）；
; 3. customUnInit —— 卸载器 .onInit 同理提前清场。
; Electron/SQLite 对进程被杀均有崩溃恢复设计（WAL、原子写配置），强杀安全。
!macro customCheckAppRunning
  Push $R0
  Push $R1
  DetailPrint `正在结束运行中的 ${PRODUCT_NAME}…`
  StrCpy $R1 0
  ${While} $R1 < 10
    nsExec::Exec `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $R0
    Sleep 400
    nsExec::Exec `$SYSDIR\cmd.exe /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | $SYSDIR\findstr.exe /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R0 ; 0 = 仍在运行，非 0 = 已退出
    ${If} $R0 != 0
      ${Break}
    ${EndIf}
    IntOp $R1 $R1 + 1
  ${EndWhile}
  Pop $R1
  Pop $R0
!macroend

!macro customInit
  nsExec::Exec 'taskkill /F /T /IM sshk-tools.exe'
  Pop $R0
  Sleep 500
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /T /IM sshk-tools.exe'
  Pop $R0
  Sleep 500
!macroend
