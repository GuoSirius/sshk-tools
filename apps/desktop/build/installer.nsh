; 安装 / 卸载前先结束运行中的 sshk-tools 进程（用户 2026-11-18：每次安装都提示
; 「关闭应用失败」须手动卸载，根治）。
;
; 背景：本应用的「关闭」路径是交互式的——默认点关闭弹确认框，开了「最小化到托盘」
; 则直接隐藏到托盘，进程都不会退出。NSIS 默认检测（发 WM_CLOSE → 等窗口消失）
; 在这两种行为下必然超时，触发 appCannotBeClosed 页面。
;
; 方案：electron-builder 的 .onInit 顺序是 customInit → 安装 Section 的
; CHECK_APP_RUNNING（卸载器为 customUnInit → un.checkAppRunning），因此在检测
; 发生前 taskkill 强制结束进程，默认检测找不到进程即静默通过。
; Electron/SQLite 对进程被杀均有崩溃恢复设计（WAL、原子写配置），强杀安全。
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
