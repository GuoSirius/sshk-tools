# Changelog

## v1.0.0 (2026-11-14)

### ✨ Features
- 对话调试 WorkBuddy 式输入区 + 全高布局(#54)
- pickSave 支持 defaultPath + badge 海报产物目录配置(#55)
- 对话调试升级——多轮/模型记忆/流式Markdown/智能滚动
- loadToolPlugins 接入 utilityProcess 沙箱加载外部 main
- 公钥管理 UI、运行时示例测试包与渲染层契约
- provider 回显修复、全页操作列统一、密钥缓存时序与运行时组件动态加载
- 海报列表合并预览与编辑为单一编辑入口（载入即显示预览）
- 海报列表合并预览与编辑为单一编辑入口
- 预览编辑统一载入与海报全量回显
- utilityProcess 沙箱切片一（协议/宿主/子进程入口）
- 海报页左列自身滚动、右列固定（删 ResizeObserver 方案）
- 关闭应用二次确认（打包版防误触退出）
- vue-router 正解迁移、全表格序号与导出 zip 打包
- 海报导出同时携带 badge 副本与长图
- 海报列表按 head/body/foot 三段式重构
- 表单必填校验机制与页头去重
- vue 检查盲区根治、badge 位置配置化与表格三段式布局
- badge 定位改造、标记核对列、HTML 搜索与海报列表管理端
- 识别块上移表格上方与预览高度实测化
- 路由保持、产物根 dist、开发项降级与图片预览条
- 路径配置统一选择交互与门禁、EDM 切 hidden 形态
- 识别流程重排与生成链路配置接线（修复写死配置）
- 备份全链路、预览铺满、连通持久化与运行时包参与裁决
- 密钥按需回显、开发者工具密钥门与 devOnly 配置机制
- 运行时工具包安装器（阶段二核心）与生成页布局重排
- edm css 基线（base-reset + unocss 原子类 + 汇集管线）
- 工具两类四态、EDM 目录约定与 release 输出精简
- 工具 ID 收敛、vue-tsc 门禁、release 流程与导入包校验层
- 恢复 Windows arm64 发布产物
- badge 工具复用应用级 Provider 与 OCR 版式配置化
- 定稿运行时工具包契约与信任模型（#8 方案落地）
- 应用级 Provider 共享与默认播种，IDE 无关类型解析
- 工具包自包含插件化、多分类标签与 Badge 图片识别
- 应用设置中心、工具级配置与图标权限体系
- 工具目录裁决层与配置分层
- 侧栏收起 hover 浮层与递归多级菜单
- require admin privileges on windows install and run
- add local windows build-test script with cn mirrors
- tool sidebar menus, dark-first paint hardening and ensure-electron postinstall
- add root shortcut scripts for dev, build, pack and dist
- add M4/M5 edm-studio with brand tree, render pipeline, mails and lan share
- add M6 badge-studio with datasource parsing, badge injection and poster capture
- add M7 llm-gateway, model-console tool and os capability ipc
- add M3 foundation packages (repository, backup, ui-kit) with 37 tests
- add M2 release pipeline, install guide and autoUpdater wiring
- add M1 desktop shell with electron-vite HMR and brand assets

### 🐛 Bug Fixes
- 跨平台命令解析 + 提交/推送失败回滚 + dotenv 环境变量体系
- 构建失败自动回滚版本号与 CHANGELOG，同版本可重发
- 打包子进程绕过公司网络 TLS 拦截（证书非必须，绕过优先）
- 交互库换成 @inquirer/prompts，恢复上下箭头选择
- 版本选择改序号菜单，交互全程零光标控制
- 剔除 clack，交互改为内置零依赖确定性渲染，根治上下切换重复行
- 版本选择预览改用 clack 原生 hint，修复 Windows 终端渲染错乱
- 运行时组件 Blob 加载被 CSP 拦截 + 失败重试风暴(#50)
- 运行时工具渲染打通 + 导入后桌面自动刷新(#50)
- 将自身通道从 ipcAllowlist 移出，契约校验通过(#50)
- 修正 secrets.bin 解密根因——decryptStringAsync 返回 {result,shouldReEncrypt} 对象
- 密钥解密 buffer 根因修复与弃用 API 清零
- 搜索定位补水平滚动跟随
- 搜索定位补水平滚动（列号乘等宽字符宽，选中内容水平居中）
- html 搜索定位关闭软换行并按实际行高精确滚动
- op-row 闭合、safeStorage 异步迁移与按钮层级重排
- badge 页 html 搜索定位改用浏览器选区滚动
- html 搜索定位游标逻辑与滚动位置修复
- 位置下拉 null 兜底与海报元数据保存按钮
- 补齐位置配置化、海报名称回路与侧栏自动滚动
- 菜单导航同步、空 head 隐藏与表格三段式主题适配
- paddle 适配器宿主托管与自检诊断（图片不再被当源码执行）
- dev 局域网暴露、旧数据迁移与侧栏头分类滚动
- 修复 window.api 只读崩溃并清理重复 script 与 vision 残留配置
- 渲染层边界脱壳根治 cloned、表格样式与配置持久化修复
- 侧栏收起按钮文案与箭头随展开状态切换
- 侧栏就地平滑展开、弹框统一行为与模型列表 401 回退
- 统一在 preload 边界脱壳响应式对象，修复配置保存克隆报错
- 工具密钥标识校验放宽与模型预设真实列表下拉
- make sandbox preload dependency-free by aliasing shared to ipc constants
- renderer node-module leaks, dark-first paint, no system menu and devtools in dev
- import electron-updater via default export for cjs compat in esm main
- bundle workspace sources into electron build to fix err_module_not_found
- unignore build resources, unify brand assets and approve pnpm build scripts

### ♻ Refactors
- 工具包移除 TOOL_ID 硬编码，改由宿主注入

### 📝 Docs
- 代码签名证书获取与配置 + 1.0.0 门禁闭环台账(#56)
- 台账批次四十五
- 操作列容量约定注释
- 决策看板 D37-D45 与穿插需求台账

### 🔧 Others
- chore(deps): lockfile 同步 @inquirer/prompts@8.8.0
- style(model-console): 对话输入区适当调高（min-height 24→52px，容器内边距加大）
- chore(scripts): check:latest 放行 sheetjs 官方 CDN tarball 安装包(受控例外)
- chore(scripts): pack-runtime-sample 纳入 dist/main.js
- chore(examples): runtime-sample 增加外部 main 声明与打包
- test(desktop): 新增 plugins 单测覆盖外部 main 加载分支
- build(desktop): 主构建显式双入口并导出 readInstalled
- build: 安装包产物落地仓库根 dist/（推翻台账误记的已落地结论）
- chore: 迁移提交门禁到 husky（五步门禁原样迁移）
- chore: 提交门禁补构建校验步骤
- style: 表格操作按钮样式化、tag 标记与斑马纹质感
- style: 全局滚动条主题化定制（细滚动条跟随主题色）
- test: 契约测试补 version 字段
- chore: 同步 lockfile 至 xlsx 0.20.3
- chore: 未使用代码门禁与 xlsx 官方修复版切换
- chore: 收口编辑器项目归属并更新需求台账文档
- style: pin sidebar toggle to footer with icon and independent menu scroll
- chore: adopt ESM-first with CJS compat, TS 6 and M6-first roadmap
- chore: init repository with M0 skeleton

