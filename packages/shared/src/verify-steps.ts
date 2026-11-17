/**
 * U2 验证引导步骤数据（plans/04 §四）——单一数据源。
 * 页内引导（桌面壳「验证引导」）与本目录验证清单文档共用此数据，文档只留历史表格不再双维护。
 * 编号对齐：A/B/C/D/E 组 = EDM待收尾与验证清单 §五；F 组 = 遗留事项与收尾总账 ⏳ 项。
 */

export type VerifyGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'G'

/** 自动判定类别：hostCapability 前端判；其余三类 main 判（verify:autoCheck） */
export type VerifyAutoKind = 'hostCapability' | 'fileExists' | 'catalogState' | 'logScan'

export interface VerifyStep {
  /** 对齐总账编号（A1、E3、F/A-V5…） */
  id: string
  group: VerifyGroup
  title: string
  /** 一句话操作引导（含判定标准） */
  guide: string
  /** 直达入口：route=工具路由 /settings=设置抽屉分组 */
  entry?: { type: 'route' | 'settings'; target: string }
  /** 自动判定（能自动的不让用户肉眼判） */
  auto?: { kind: VerifyAutoKind; spec: string }
  /** 仅打包版可验（如口令双闸 C1-C3）；打包版过滤反向使用 */
  requiresPackaged?: boolean
  /** 关联文档/规划编号 */
  relates?: string
}

export const VERIFY_GROUP_LABELS: Record<VerifyGroup, string> = {
  A: 'A · 上传管理工具',
  B: 'B · 富文本全屏',
  C: 'C · 开发者模式 / 密钥体系',
  D: 'D · EDM 内容管理 / CSS / 编辑器',
  E: 'E · 打包 / 依赖 / 门禁',
  F: 'F · 应用与各工具收尾（总账 ⏳）',
  G: 'G · 弹框与欢迎页走查（2026-11-17）',
  H: 'H · 文件系统（X6）',
}

export const VERIFY_STEPS: VerifyStep[] = [
  // ── A 组：上传管理工具（验证清单 A1-A14）──
  { id: 'A1', group: 'A', title: '打开「上传管理」工具', guide: '顶部无黄色「宿主能力缺失」横幅', entry: { type: 'route', target: 'upload-manager' }, auto: { kind: 'hostCapability', spec: 'upload' }, relates: 'N8/C5/V11' },
  { id: 'A2', group: 'A', title: '远程 profile 主机留空点「测试连接」', guide: '行内显示 ✗ 远程配置不完整 + 黄色提示；主进程终端不打印堆栈', entry: { type: 'route', target: 'upload-manager' }, relates: 'N11/V12' },
  { id: 'A3', group: 'A', title: '同时展开两个 profile 表单', guide: '两个表单同时展开互不折叠', entry: { type: 'route', target: 'upload-manager' }, relates: 'N5' },
  { id: 'A4', group: 'A', title: '云厂商下拉 7 家中文名', guide: '地域/Endpoint 为中文主名 + 灰色真实 ID 副标题', entry: { type: 'route', target: 'upload-manager' }, relates: '3/N9' },
  { id: 'A5', group: 'A', title: '地域输入中文自动纠正', guide: '输入「华东 1（杭州）」回车 → 自动纠正回 oss-cn-hangzhou', entry: { type: 'route', target: 'upload-manager' }, relates: 'N9' },
  { id: 'A6', group: 'A', title: '自定义地域可创建', guide: '输入预置里没有的 ID 可手动创建并保存（allow-create 生效）', entry: { type: 'route', target: 'upload-manager' }, relates: '5' },
  { id: 'A7', group: 'A', title: '密码框查看回填', guide: '点「查看」回填已保存口令；眼睛图标可切换显隐', entry: { type: 'route', target: 'upload-manager' }, relates: 'N3' },
  { id: 'A8', group: 'A', title: '临时口令不落盘', guide: '改口令不保存直接测试 → 测试用临时值；「查看」仍是旧值', entry: { type: 'route', target: 'upload-manager' }, relates: 'N3/N4' },
  { id: 'A9', group: 'A', title: '输入框与按钮对齐', guide: '等高、左右对齐，图标风格统一', entry: { type: 'route', target: 'upload-manager' }, relates: 'N1/N2' },
  { id: 'A10', group: 'A', title: '统一列表新增下拉', guide: '可选远程/云，新增后落到同一张列表', entry: { type: 'route', target: 'upload-manager' }, auto: { kind: 'catalogState', spec: 'upload-manager' }, relates: 'N6' },
  { id: 'A11', group: 'A', title: '列表行操作', guide: '设为默认/编辑/删除；删除弹二次确认；删默认项后自动顺延第一条', entry: { type: 'route', target: 'upload-manager' }, relates: 'N6' },
  { id: 'A12', group: 'A', title: '本地 profile 自动上传', guide: '本地 profile 设默认 → EDM 图片字段选图 → 自动上传 + 回填 URL；目录不存在自动创建', entry: { type: 'route', target: 'upload-manager' }, relates: '4/V7' },
  { id: 'A13', group: 'A', title: '复制图片 URL', guide: '图片字段点「复制图片 URL」→ 剪贴板为刚回填的 URL', entry: { type: 'route', target: 'upload-manager' }, relates: '4' },
  { id: 'A14', group: 'A', title: '真实账号连接测试', guide: '填一组真实 FTP/SFTP 或云账号测试 → ✓ 通过；临时密钥不写进 settings.json', entry: { type: 'route', target: 'upload-manager' }, relates: 'N4/V7' },

  // ── B 组：富文本全屏（验证清单 B1-B7）──
  { id: 'B1', group: 'B', title: '全屏铺满窗口', guide: '内容管理页含富文本的表单点全屏 → 铺满窗口，左侧树/菜单全被遮住，底色不透明', entry: { type: 'route', target: 'edm-studio' }, relates: 'N12/V13' },
  { id: 'B2', group: 'B', title: '全屏 DOM 结构', guide: 'DevTools 查 .rich：body 直接子节点 + is-fullscreen + w-e-full-screen-container，z-index 2147483647', entry: { type: 'route', target: 'edm-studio' }, relates: 'N12' },
  { id: 'B3', group: 'B', title: '全屏内操作正常', guide: '输入文字/切粗体/展开下拉/插图片均正常，下拉面板不被遮挡；暗色下工具栏与悬浮菜单 hover 清晰可读', entry: { type: 'route', target: 'edm-studio' }, relates: 'N12' },
  { id: 'B4', group: 'B', title: '退出全屏归位', guide: '容器回到表单原位置；旧父节点无残留 class；页面无空白遮罩', entry: { type: 'route', target: 'edm-studio' }, relates: 'N12' },
  { id: 'B5', group: 'B', title: '连续进出全屏 3 次', guide: '每次正常，无空白层/抖动，编辑内容不丢', entry: { type: 'route', target: 'edm-studio' }, relates: 'N12' },
  { id: 'B6', group: 'B', title: '深色主题全屏', guide: '重复 B1/B4：底色 #181818，文字与工具栏可读；代码块（查看源码内容）应为深底浅字', entry: { type: 'route', target: 'edm-studio' }, relates: 'N12/V8' },
  { id: 'B7', group: 'B', title: '双实例互不影响', guide: '「富文本双实例」页只全屏实例 A → 实例 B 不受影响，退出后各归各位；切换两实例编辑焦点后引用/代码块/网络图片按钮不再假死禁用', entry: { type: 'route', target: 'template-tool' }, relates: 'N12/V8' },
  { id: 'B8', group: 'B', title: '图片库上传与插入', guide: '工具栏「图片库」→ 默认源按云→远程→本地；选来源（桶可输入、目录逐级展开可选任意层级或手输不存在目录）→ 上传后缩略图预览（点图放大/删除/全选/反选）→ 切到图库页仍能看到本次上传且选中状态一致；切目录/源/桶已选持续累积，同 URL 的图不重复计数；展开「已选清单」可查看各来源并逐项移除或清空；最后一并插入；搜索文件名快速定位；图过多分批渲染滚动加载、图片懒加载；设置切页/重启回显、多实例隔离', entry: { type: 'route', target: 'edm-studio' }, relates: 'C2/R28' },
  { id: 'B9', group: 'B', title: '查看源码', guide: '工具栏「</>」按钮 → Monaco 代码编辑器（高度受控），打开即格式化展示；「格式化」「压缩」按钮生效且 pre/code 空白不被破坏；修改后「应用修改」写回编辑器；复制源码到剪贴板正常', entry: { type: 'route', target: 'template-tool' }, relates: 'R28' },
  { id: 'B10', group: 'B', title: '底部字数状态栏', guide: '编辑器底部显示 字数/字符（含空格数）/段落；选中文字时显示「已选 X 字」；全屏时状态栏沉底不丢', entry: { type: 'route', target: 'template-tool' }, relates: 'R28' },

  // ── C 组：开发者模式 / 密钥体系（验证清单 C1-C6）──
  { id: 'C1', group: 'C', title: '开发者模式口令弹框（打包版）', guide: '打包版开「开发者模式」→ 弹口令输入框；不填/填错开关回弹', entry: { type: 'settings', target: '系统与数据' }, requiresPackaged: true, relates: '10' },
  { id: 'C2', group: 'C', title: '正确口令开启', guide: '输入正确口令 → 开关开启，开发者工具入口出现', entry: { type: 'settings', target: '系统与数据' }, requiresPackaged: true, relates: '10' },
  { id: 'C3', group: 'C', title: '绕过 UI 被拒', guide: '绕过 UI 直接调配置接口开启开发者模式 → 主进程拒绝并提示需先通过访问密钥验证', requiresPackaged: true, relates: '10' },
  { id: 'C4', group: 'C', title: '自动安装开关默认关', guide: '「下载更新后重启自动安装」默认关闭；打开后重启仍保持', entry: { type: 'settings', target: '系统与数据' }, relates: '10' },
  { id: 'C5', group: 'C', title: '访问密钥说明可见', guide: '设置页「应用访问密钥」五套口令对照表可见，说明不联网/不登录/不加密文件/仅本机可见性门禁', entry: { type: 'settings', target: '系统与数据' }, relates: 'N10' },
  { id: 'C6', group: 'C', title: '需访问密钥工具隐藏', guide: '某工具设为「需访问密钥」且未配置 → 列表中隐藏；配置后重新出现', entry: { type: 'settings', target: '工具与权限' }, auto: { kind: 'catalogState', spec: 'grants' }, relates: 'N10' },

  // ── D 组：EDM 内容管理 / CSS / 编辑器（验证清单 D1-D18）──
  { id: 'D1', group: 'D', title: '左侧树默认展开', guide: '内容管理打开 → 默认展开到模板/片段类目层；品牌下顺序 css → 模板 → 片段', entry: { type: 'route', target: 'edm-studio' }, relates: 'U1' },
  { id: 'D2', group: 'D', title: '空示例数据不报 YAML 错', guide: '空示例数据切「表单」→ 不报错，正常出空表单', entry: { type: 'route', target: 'edm-studio' }, relates: '8/V1' },
  { id: 'D3', group: 'D', title: '纯注释/null YAML 容错', guide: '纯注释、null、~ 切换均不报错；真语法错仍明确报错', entry: { type: 'route', target: 'edm-studio' }, relates: '8' },
  { id: 'D4', group: 'D', title: '@shared CSS 提取', guide: '模板源码写 link @shared/a.css 预览 → CSS 提取进 head 样式生效', entry: { type: 'route', target: 'edm-studio' }, relates: 'V6/R28' },
  { id: 'D5', group: 'D', title: 'CSS 引用去重', guide: '同一 CSS 重复引用 + 片段 repeat → head 内去重不重复注入', entry: { type: 'route', target: 'edm-studio' }, relates: 'V6' },
  { id: 'D6', group: 'D', title: '相对路径引用报错', guide: '引用写 ../../a.css → 明确报错并提示改用 @root/@shared/@system/@custom', entry: { type: 'route', target: 'edm-studio' }, relates: 'R28' },
  { id: 'D7', group: 'D', title: '存量资产就近链回退', guide: '无 link 的存量资产预览 → 回退就近链仍能出样式', entry: { type: 'route', target: 'edm-studio' }, relates: 'R28' },
  { id: 'D8', group: 'D', title: 'data: 图片批量上传回写', guide: '富文本插图保存示例数据 → data: 图片批量上传并回写 URL', entry: { type: 'route', target: 'edm-studio' }, relates: 'V9' },
  { id: 'D9', group: 'D', title: '新建同级版本', guide: '版本节点右键「新建版本（同级）」→ 复制全量内容，层级正确', entry: { type: 'route', target: 'edm-studio' }, relates: 'V1/V3' },
  { id: 'D10', group: 'D', title: '另存为类型隔离', guide: '另存为跨根/类型隔离 → 只能落允许的对象类型；自定义根统一 custom-edm', entry: { type: 'route', target: 'edm-studio' }, relates: 'V1/V4' },
  { id: 'D11', group: 'D', title: '自定义模板生成邮件', guide: '用 origin=custom 的模板/片段生成邮件 → 能被正确取用', entry: { type: 'route', target: 'edm-studio' }, relates: 'V5' },
  { id: 'D12', group: 'D', title: 'Monaco 多实例不串', guide: '多 tab + 深色主题 + md↔html 单向互转 → 多实例互不串内容；往返不保真属预期', entry: { type: 'route', target: 'edm-studio' }, relates: 'V8' },
  { id: 'D13', group: 'D', title: '工具设置页左右布局', guide: '非上传工具设置页：左栏分组导航独立滚动、点击定位右栏；右栏独立滚动无空盒；保存条固定；改动出「未保存」提示', entry: { type: 'route', target: 'badge-studio' }, relates: '#27' },
  { id: 'D14', group: 'D', title: '上传工具设置页不受影响', guide: '上传管理工具设置页仍是原样式，未被改成左右布局', entry: { type: 'route', target: 'upload-manager' }, relates: '#27' },
  { id: 'D15', group: 'D', title: '形态 2 二级配置页', guide: '工具包开发模板：「工具配置」展开两个二级菜单；每页左栏只列该页分组、标题为页名；两页内容互不串', entry: { type: 'route', target: 'template-tool' }, relates: '#28' },
  { id: 'D16', group: 'D', title: '形态 2 页级保存隔离', guide: '「模型与调用」改字段保存 → 只落本页；切「路径与输出」改动保存 → 上页不丢；boolean/select 正常渲染持久化', entry: { type: 'route', target: 'template-tool' }, relates: '#28' },
  { id: 'D17', group: 'D', title: '创建工具向导（dev）', guide: '双入口可见（打包版不显示）；分步填写 → JSON 预览实时更新 → 创建后骨架落盘、目录刷新、重启 dev 可加载', entry: { type: 'settings', target: '工具与权限' }, relates: '#29' },
  { id: 'D18', group: 'D', title: '清单编辑器表单化', guide: '「工具与权限 → 配置」：分组/字段/软依赖/defaults/通道行编辑；JSON 预览与保存一致；保存校验通过', entry: { type: 'settings', target: '工具与权限' }, relates: '#29' },

  // ── E 组：打包 / 依赖 / 门禁（验证清单 E1-E5）──
  { id: 'E1', group: 'E', title: 'pnpm verify 全绿', guide: '13 项门禁 + 全部单测通过', auto: { kind: 'fileExists', spec: 'verify-ok' }, relates: '门禁' },
  { id: 'E2', group: 'E', title: 'desktop build 成功', guide: 'pnpm -C apps/desktop build 成功', relates: '门禁' },
  { id: 'E3', group: 'E', title: '完整打包资源落位', guide: 'electron-builder 打包后启动：assets/edm 落在 resources/edm-studio/assets/edm；SFTP 纯 JS 回退可用', requiresPackaged: true, auto: { kind: 'fileExists', spec: 'edm-assets' }, relates: 'E3/C4' },
  { id: 'E4', group: 'E', title: 'Dependabot 不再报安全无解', guide: 'fast-xml-parser ≥ 5.12.0，无 security_update_not_possible', relates: 'N7/C2' },
  { id: 'E5', group: 'E', title: 'husky 门禁拦截', guide: '本地提交触发 pnpm verify + build；不带 close-on-press-escape 的弹框被 check:dialogs 拦下', relates: '11' },

  // ── F 组：应用与各工具收尾（总账 ⏳ 项）──
  { id: 'F/A-V2', group: 'F', title: '自动更新新版进度展示', guide: '更新横幅 + 设置中心进度卡实际渲染（修完新提问题后一并验证）', entry: { type: 'settings', target: '系统与数据' }, relates: 'A-V2' },
  { id: 'F/A-V5', group: 'F', title: '备份导出→清空→导入还原', guide: '备份导出 zip → 清空数据 → 导入还原一致（含 D18 密钥加密迁移）', entry: { type: 'settings', target: '系统与数据' }, relates: 'A-V5/H5' },
  { id: 'F/A-V6', group: 'F', title: '产物目录迁移 6 步', guide: '预检/停写/复制/校验/切换/清理全走通；旧目录绝不递归删', entry: { type: 'settings', target: '系统与数据' }, relates: 'A-V6' },
  { id: 'F/A-V7', group: 'F', title: '右键菜单/开机自启 OS 授权', guide: '三平台各自验：右键菜单项出现、开机自启生效', entry: { type: 'settings', target: '系统与数据' }, relates: 'A-V7' },
  { id: 'F/B-V1', group: 'F', title: '设置页左栏点击定位', guide: '逐个点左栏分组 → 右栏滚动定位且左栏高亮跟随（含反向滚动高亮）', entry: { type: 'route', target: 'badge-studio' }, relates: 'B-V1' },
  { id: 'F/B-V2', group: 'F', title: '形态 2 页级隔离复验', guide: '「模型与调用」改字段保存 → 切「路径与输出」确认自己改动在且上页字段未被带过来 → 再切回双方均在', entry: { type: 'route', target: 'template-tool' }, relates: 'B-V2/D15/D16' },
  { id: 'F/C-V2', group: 'F', title: 'badge 四种数据源导入', guide: 'pickStats 用真实 xlsx/xls/csv/tsv/json 文件导入 → 三类解析齐备结果正确', entry: { type: 'route', target: 'badge-studio' }, relates: 'C-V2' },
  { id: 'F/C-V4', group: 'F', title: 'CodeEditor JSON 只读视图', guide: '海报页 JSON 视图按钮打开 → 内容与格式正确', entry: { type: 'route', target: 'badge-studio' }, relates: 'C-V4' },
  { id: 'F/D-V3', group: 'F', title: '流式打字感核查', guide: '模型对话观察打字感；dev 日志查 chunk#n size gap；打字平滑开关默认开', entry: { type: 'route', target: 'model-console' }, relates: 'D-V3' },
  { id: 'F/D-T2', group: 'F', title: '模型能力供工具调用', guide: 'badge/EDM 的 AI 能力均可用（badge 视觉已验；EDM AI 填充/润色走 D-Q2）', entry: { type: 'route', target: 'edm-studio' }, relates: 'D-T2/D-Q2' },
  { id: 'F/E-V1', group: 'F', title: '本地目录自检', guide: '上传管理工具自检按钮 + 本地 profile 上传回填', entry: { type: 'route', target: 'upload-manager' }, relates: 'E-V1' },
  { id: 'F/E-V2', group: 'F', title: '真实 FTP/SFTP/OSS 连接', guide: '临时密钥不落盘；测试结构化不刷堆栈（N11 已修复验）', entry: { type: 'route', target: 'upload-manager' }, relates: 'E-V2/N11' },
  { id: 'F/E-V3', group: 'F', title: '校验收紧语义', guide: '工具收紧（交集/取小）；未设限字段 undefined', entry: { type: 'route', target: 'upload-manager' }, relates: 'E-V3' },
  { id: 'F/E-V4', group: 'F', title: '内联图片回写', guide: 'saveSample 前 data: 图片批量上传回写 URL', entry: { type: 'route', target: 'edm-studio' }, relates: 'E-V4/T8/V9' },
  { id: 'F/E-V5', group: 'F', title: '能力兜底横幅 + 一键重载', guide: '旧窗口点测试走通用通道或给可操作提示 + 一键重载', entry: { type: 'route', target: 'upload-manager' }, auto: { kind: 'hostCapability', spec: 'callHostApi' }, relates: 'E-V5/N8/V11' },
  { id: 'F/E-V7', group: 'F', title: '打包后 SFTP 纯 JS 回退', guide: '随下次打包顺验：SFTP 连接不因 cpu-features shim 失效', requiresPackaged: true, relates: 'E-V7/C4' },
  { id: 'F/F-T1', group: 'F', title: '打包资源路径验证', guide: '安装目录 resources/edm-studio/assets/edm/ 存在且有品牌内容', requiresPackaged: true, auto: { kind: 'fileExists', spec: 'edm-assets' }, relates: 'F-T1' },
  { id: 'F/F-T2', group: 'F', title: '自定义根跨平台路径', guide: '正式包里自定义内容新建/编辑一次（落 userData/custom-edm）+ dev 同样操作一次（落源码旁）两边正常', requiresPackaged: true, relates: 'F-T2' },

  // ── G 组：2026-11-17 弹框/欢迎页走查（file-picker 通用化 + 全局弹框口径 + 欢迎页卡片 + model-console 表单）──
  // kind 五类（image/document/code/video/all）暂不设项：EDM 图片字段尚未接入 FilePickerDialog（总账 E-T4），接入时随接入项一并新增
  { id: 'G1', group: 'G', title: '图片库新弹框交互定稿', guide: '富文本「图片库」：继续上传/插入所选沉底与关闭同行（关闭最右）；缩略图右上角删除=垃圾桶、移除已选=✕（悬浮红色）；目录下拉首次展开即自动拉取（带 loading，不用先切源）', entry: { type: 'route', target: 'edm-studio' }, relates: 'E-T3/C2' },
  { id: 'G2', group: 'G', title: '弹框全局内缩口径', guide: '任开 2-3 个弹框（如模型控制台新增 Provider、富文本源码查看、图片库）：顶部 12px、左右 16px 单层内缩，header/body/footer 间距均匀，内容不贴灰边、footer 不与 body 出现双内缩错位', relates: 'E-T3' },
  { id: 'G3', group: 'G', title: '欢迎页卡片走查', guide: '回桌面首页：描述最少显示 3 行超出内部滚动（卡片等高不跳动）；超长工具名悬浮时往返滚动显示全名（未超长不动）；标签过多一行内横向滚动', relates: 'E-T3' },
  { id: 'G4', group: 'G', title: '模型控制台表单走查', guide: '重试次数为带加减的整数数字框（0=不重试、上限 5、手输小数收整）；新增 Provider 弹框 680px 双列布局，表单区定高随视口、超长内滚动，新增/编辑切换高度不跳', entry: { type: 'route', target: 'model-console' }, relates: 'E-T3' },

  // ── H 组：文件系统（X6 · plans/08 §八验收清单；只新增不改旧 id）──
  { id: 'H1', group: 'H', title: '进入工具默认文件系统页 + 通道浏览', guide: '打开「上传管理」工具默认落在「文件系统」菜单（上传管理退居第二菜单）；5 个通道均能浏览到与 oss-browser 一致的目录结构（云侧虚拟目录=公共前缀正确呈现）', entry: { type: 'route', target: 'upload-manager' }, auto: { kind: 'hostCapability', spec: 'fs' }, relates: 'X6/F-5' },
  { id: 'H2', group: 'H', title: '新建目录 / 重命名 / 删除即时刷新', guide: 'FTP 与 OSS 上新建目录、重命名、删除文件行为一致且列表即时刷新；递归删除大目录出现传输队列分批进度', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/F-2/F-3' },
  { id: 'H3', group: 'H', title: '大文件上传下载全链路', guide: '上传 100MB 文件：传输队列进度/速度/取消/失败重试全部可用；下载同理（落点 userData/downloads，可一键打开目录）', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/F-4/F-7' },
  { id: 'H4', group: 'H', title: '文本编辑保存写回 + 冲突提示', guide: '文本文件在编辑器打开并保存，oss-browser 侧可见更新；用另一端改文件后再保存 → 提示「远端已变化」，可选覆盖或放弃', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/F-6' },
  { id: 'H5', group: 'H', title: '拖拽上传 + 文件夹递归 + 同名覆盖确认', guide: '从资源管理器拖文件/文件夹进列表 → 保留目录结构入队上传；远端已有同名文件时任务变「待确认」，点覆盖后继续', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/F-7' },
  { id: 'H6', group: 'H', title: '图片预览与新建文件', guide: '双击图片弹层预览（可缩放）；「新建文件」创建空白文本直接进编辑器，保存后远端可见', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/F-6' },
  { id: 'H7', group: 'H', title: '键盘与多选操作', guide: 'Ctrl/Shift 点选、全选、Delete 删除、F2 重命名、Ctrl+C/V/X 剪贴板跨目录粘贴、Backspace 上一级均生效', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/F-5' },
  { id: 'H8', group: 'H', title: '密钥未配置与错误态引导', guide: '未配置密钥的通道给出引导文案；断网/错密码时列表给分类错误（连接失败/认证失败）+ 重试按钮', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/§3.3' },
  { id: 'H9', group: 'H', title: '音视频在线播放（二期）', guide: '双击 mp4/mp3 等媒体文件弹层播放（<video>/<audio> 原生控件）；超过 64MB 引导下载后本地播放；mkv/mov 等不保证可播的扩展无播放入口（只下载）', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/二期' },
  { id: 'H10', group: 'H', title: '跨通道互拷（二期）', guide: '「复制到…」选其它通道 → 目录自动递归展开入队（超 1500 文件截断提示）；剪贴板跨通道粘贴按复制执行（剪切跨通道降级为复制，源保留）；传输队列显示「源 → 目标」；同名冲突待确认可覆盖', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/二期' },
  { id: 'H11', group: 'H', title: '递归搜索（二期）', guide: '搜索框回车触发递归搜索（当前路径前缀内，根=整个通道）；结果横幅显示数量与截断提示，「返回目录」还原；云侧扫描上限 5 万 key、远程限深 6 层', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/二期' },
  { id: 'H12', group: 'H', title: '目录容量统计（二期）', guide: '目录行「统计」或选中单个目录后工具栏「统计」：弹窗显示总大小与文件数；超大目录达扫描上限时明确标注「数值为已扫部分」', entry: { type: 'route', target: 'upload-manager' }, relates: 'X6/二期' },
]

/** 步骤总数（页脚展示用） */
export const VERIFY_STEPS_TOTAL = VERIFY_STEPS.length

/** 单条会话内某步骤的结果 */
export interface VerifyStepResult {
  state: 'pass' | 'fail' | 'skip'
  note?: string
  at: string
}

/** 会话文件结构（userData/verify-sessions/<日期>.json） */
export interface VerifySession {
  date: string
  startedAt: string
  updatedAt: string
  results: Record<string, VerifyStepResult>
}
