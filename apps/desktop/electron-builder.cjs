// Electron 打包配置（M1 应用壳已接入；D6 无签名证书）。
// 2026-11-16 由 electron-builder.yml 迁移为 JS 配置：X5-A 构建裁剪需要按
// 「内建工具名单」动态计算 extraResources（yml 静态结构做不到条件化）。
// 名单来源：electron.vite.config.ts 构建期写入的 .build-selection.json
// （SSHK_BUILD_TOOLS 环境变量 + 依赖闭包的唯一事实源）；文件缺失 = 全量。
// 参考：热更新文档、发布流程文档第九节
// 图标由 scripts/generate-icons.py 生成，位于 build/
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

/** 构建期裁剪结果（mode/ids/pulledIn/excluded）；读取失败一律回退全量 */
function readSelection() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '.build-selection.json'), 'utf8'))
  } catch {
    return { mode: 'all', ids: null, pulledIn: [], excluded: [] }
  }
}
const selection = readSelection()
const included = (id) => selection.mode !== 'list' || (Array.isArray(selection.ids) && selection.ids.includes(id))

/**
 * R11：内建工具系统内容随包发布。每个工具的可发布资源在此登记，
 * 仅当该工具在裁剪名单内才进包（X5-A：未选工具的资源不跟随打包）。
 * 资源放 extraResources 而非 files：位于 asar 之外的 resources 根，
 * 运行时用 process.resourcesPath 读取（打包版系统内容根可写，asar 内不可写）。
 */
const TOOL_ASSETS = [
  // edm-studio 的 builtin 资源位于 monorepo 的 <repo>/tools/edm-studio/assets/edm，
  // 需拷贝到安装包的 resources/edm-studio/assets/edm，与 tools/edm-studio ipc.resolveEdmRoot
  // 的 process.resourcesPath/edm-studio/assets/edm 严格对应（from 相对 apps/desktop 上溯两级）。
  // 基础样式层 reset.css 已收进 edm/css，随本树一并发布。
  { id: 'edm-studio', from: '../../tools/edm-studio/assets/edm', to: 'edm-studio/assets/edm' },
]

const config = {
  appId: 'cn.sshk.tools',
  productName: 'sshk-tools',
  copyright: 'Copyright © 2026 SSHK',

  // 依赖已全部内联进 out/（node_modules 全量排除），没有任何要为 Electron 重编译的原生模块；
  // 关掉 @electron/rebuild（否则它会徒劳 node-gyp 重编译 ssh2 的可选加速模块 cpu-features，
  // 在无 VS 编译链的环境直接构建失败，产物也不会进包）
  npmRebuild: false,

  // asar integrity：默认保留 electron-builder 原生行为（嵌入），不因杀软问题默认禁用。
  // 2026-11-23 实证：此开关与腾讯管家实时扫描锁 exe 无关——关闭杀软时 true/false 均构建成功，
  // 开着杀软时 true/false 均在 rename/unpack 阶段失败。它只是可选逃生阀：某些 CI/受限环境
  // 确实不允许重写 exe 时，才设 SSHK_BUILD_DISABLE_ASAR_INTEGRITY=1。
  // ⚠️ 若将来启用 electronFuses.enableEmbeddedAsarIntegrityValidation，必须保持默认 false，
  // 否则 fuse 校验缺少 integrity 数据会导致应用启动失败。
  disableAsarIntegrity: process.env.SSHK_BUILD_DISABLE_ASAR_INTEGRITY === '1',

  directories: {
    // 安装包产物落到仓库根 dist/（.gitignore 已忽略 dist/）；相对 apps/desktop 上溯两级
    output: '../../dist',
    buildResources: 'build',
  },

  extraResources: [
    ...TOOL_ASSETS.filter((a) => included(a.id)).map(({ from, to }) => ({ from, to })),
    // 管理员模式拖放放行（win32-drop.ts）：koffi 是 N-API 原生模块，无法内联进 JS bundle，
    // 放 asar 外的 resources/koffi，运行时从 process.resourcesPath 动态 require（仅 Windows 用到）。
    { from: 'node_modules/koffi', to: 'koffi' },
  ],

  // electron-vite 的产物目录是 out/，不是 dist/（dist 只放安装包）
  files: [
    'out/**/*',
    'build/**/*',
    'package.json',
    // 主进程已把全部依赖打进 out（dayjs/fflate/electron-updater 均纯 JS 已内联）：
    // node_modules 全量排除，杜绝 @oxc-parser 等构建期原生二进制进包，
    // 根治 mac universal「同文件双架构」报错，并大幅缩小安装包
    '!node_modules/**',
  ],

  // ---------------- Windows ----------------
  win: {
    icon: 'build/icon.ico',
    target: [
      // 发布出 x64 + arm64 双架构；本地测试脚本 pnpm local 仍只构建 x64 保证速度
      { target: 'nsis', arch: ['x64', 'arm64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // 需求：应用始终以最高权限运行 —— 每次启动触发 UAC 提权
    requestedExecutionLevel: 'requireAdministrator',
    // D6：暂无代码签名证书。拿到证书后设置环境变量并取消下面两行注释即可，不改代码。
    // certificateFile: '${env.WIN_CSC_FILE}',
    // certificatePassword: '${env.WIN_CSC_KEY_PASSWORD}',
  },

  nsis: {
    // 安装器命名加 Setup 前缀，与 portable 免安装单文件明确区分，避免用户误下 portable（无安装向导）
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
    // 安装/卸载前 taskkill 结束运行中的应用（脚本见 build/installer.nsh）——
    // 应用关闭路径是交互式的（确认弹框/托盘驻留），NSIS 默认 WM_CLOSE 检测必然超时报「无法关闭」
    include: 'build/installer.nsh',
    oneClick: false,
    allowToChangeInstallationDirectory: true, // 允许用户在安装时选择安装目录
    perMachine: true, // 全机安装：写入 Program Files，需要管理员（UAC）
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'sshk-tools',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    language: '2052', // 简体中文
    multiLanguageInstaller: true,
    deleteAppDataOnUninstall: false, // 卸载保留模板/邮件/海报/配置
  },

  // portable 免安装单文件：双击直接运行、无安装向导，每次启动自解压（首启较慢）。
  // 命名加 Portable 前缀，与上面的 Setup 安装器区分，避免误下载。
  portable: {
    artifactName: '${productName}-Portable-${version}.${ext}',
  },

  // ---------------- macOS ----------------
  // ⚠️ 系统硬限制：macOS 不允许应用配置"永久最高权限"——
  //   DMG 安装无法强制提权；运行时提权只能对单个操作逐次授权（受控提权需独立 Privileged Helper）。
  //   如确需受控提权操作，后续为对应功能单独做 Privileged Helper，不在打包配置层面解决。
  mac: {
    icon: 'build/icon.png', // electron-builder 在 macOS 上自动转 icns
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
    category: 'public.app-category.productivity',
    // 暂无 Developer ID：不签名、不公证，见《首次安装指引》
    hardenedRuntime: false,
  },

  dmg: {
    // dmg 天然可拖拽到任意目录（含「应用程序」）
    window: { width: 540, height: 380 },
  },

  // ---------------- Linux / 国产 OS ----------------
  // ⚠️ 系统硬限制：deb/rpm 由系统包管理器安装（安装本身即 root 权限）；
  //   AppImage 无法在打包层授予永久 root，运行时提权需个别 sudo/polkit。
  linux: {
    icon: 'build/icon.png',
    // 默认取包名 @sshk/desktop，含 / 无法作为 Linux 可执行文件名（AppImage 曾因此构建失败）
    executableName: 'sshk-tools',
    // 桌面入口改用 productName，修 WM_CLASS 窗口关联告警
    syncDesktopName: true,
    target: ['deb', 'rpm', 'AppImage'],
    category: 'Utility',
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // deb/rpm 由系统包管理器决定安装位置；AppImage 用户可放任意目录
  },

  // ---------------- 自动更新 ----------------
  publish: {
    provider: 'github',
    owner: 'GuoSirius',
    repo: 'sshk-tools',
    releaseType: 'release',
  },
}

if (selection.mode === 'list') {
  console.log(`[sshk] extraResources 按内建名单计算：${(selection.ids ?? []).join('、') || '（空）'}`)
}

module.exports = config
