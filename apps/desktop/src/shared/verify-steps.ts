/**
 * U2 验证引导步骤数据（plans/04 §四）——单一数据源。
 * 页内引导（桌面壳「验证引导」）与本目录验证清单文档共用此数据，文档只留历史表格不再双维护。
 * 编号对齐：A/B/C/D/E 组 = EDM待收尾与验证清单 §五；F 组 = 遗留事项与收尾总账 ⏳ 项。
 * entry.target 口径（P8-4 · A7/CR-08 · CR-25④ 单一定义点）：纯工具引 `@sshk/shared` TOOL_IDS /
 * TEMPLATE_TOOL_ID；应用模块 id（P4-8 三基础模块并入应用本体）引 ./module-ids 的 MODULE_IDS；
 * 'share' = 分享预览路由（非工具 id）与 settings 分组名保留字面量。禁再散写工具/模块 id 字面量。
 */
import { TEMPLATE_TOOL_ID, TOOL_IDS } from '@sshk/shared'
import { MODULE_IDS } from './module-ids'

export type VerifyGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'S' | 'M' | 'T' | 'FM'

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
  A: 'A · 文件管理工具',
  B: 'B · 富文本全屏',
  C: 'C · 开发者模式 / 密钥体系',
  D: 'D · EDM 内容管理 / CSS / 编辑器',
  E: 'E · 打包 / 依赖 / 门禁',
  F: 'F · 应用与各工具收尾（总账 ⏳）',
  G: 'G · 弹框与欢迎页走查（2026-11-17）',
  H: 'H · 文件系统（X6）',
  S: 'S · 常驻分享服务（ShareHub · plans/09）',
  M: 'M · 内容管理（plans/11）',
  T: 'T · 分享管理工具化（plans/12）',
  FM: 'FM · 表单设计（plans/13）',
}

export const VERIFY_STEPS: VerifyStep[] = [
  // ── A 组：文件管理工具（验证清单 A1-A14）──
  { id: 'A1', group: 'A', title: '打开「文件管理」工具', guide: '顶部无黄色「宿主能力缺失」横幅', entry: { type: 'route', target: MODULE_IDS.fileManager }, auto: { kind: 'hostCapability', spec: 'upload' }, relates: 'N8/C5/V11' },
  { id: 'A2', group: 'A', title: '远程 profile 主机留空点「测试连接」', guide: '行内显示 ✗ 远程配置不完整 + 黄色提示；主进程终端不打印堆栈', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N11/V12' },
  { id: 'A3', group: 'A', title: '同时展开两个 profile 表单', guide: '两个表单同时展开互不折叠', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N5' },
  { id: 'A4', group: 'A', title: '云厂商下拉 7 家中文名', guide: '地域/Endpoint 为中文主名 + 灰色真实 ID 副标题', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: '3/N9' },
  { id: 'A5', group: 'A', title: '地域输入中文自动纠正', guide: '输入「华东 1（杭州）」回车 → 自动纠正回 oss-cn-hangzhou', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N9' },
  { id: 'A6', group: 'A', title: '自定义地域可创建', guide: '输入预置里没有的 ID 可手动创建并保存（allow-create 生效）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: '5' },
  { id: 'A7', group: 'A', title: '密码框查看回填', guide: '点「查看」回填已保存口令；眼睛图标可切换显隐', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N3' },
  { id: 'A8', group: 'A', title: '临时口令不落盘', guide: '改口令不保存直接测试 → 测试用临时值；「查看」仍是旧值', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N3/N4' },
  { id: 'A9', group: 'A', title: '输入框与按钮对齐', guide: '等高、左右对齐，图标风格统一', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N1/N2' },
  { id: 'A10', group: 'A', title: '统一列表新增下拉', guide: '可选远程/云，新增后落到同一张列表', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N6' },
  { id: 'A11', group: 'A', title: '列表行操作', guide: '设为默认/编辑/删除；删除弹二次确认；删默认项后自动顺延第一条', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N6' },
  { id: 'A12', group: 'A', title: '本地 profile 自动上传', guide: '本地 profile 设默认 → EDM 图片字段选图 → 自动上传 + 回填 URL；目录不存在自动创建', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: '4/V7' },
  { id: 'A13', group: 'A', title: '复制图片 URL', guide: '图片字段点「复制图片 URL」→ 剪贴板为刚回填的 URL', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: '4' },
  { id: 'A14', group: 'A', title: '真实账号连接测试', guide: '填一组真实 FTP/SFTP 或云账号测试 → ✓ 通过；临时密钥不写进 settings.json', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'N4/V7' },

  // ── B 组：富文本全屏（验证清单 B1-B7）──
  { id: 'B1', group: 'B', title: '全屏铺满窗口', guide: '内容管理页含富文本的表单点全屏 → 铺满窗口，左侧树/菜单全被遮住，底色不透明', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'N12/V13' },
  { id: 'B2', group: 'B', title: '全屏 DOM 结构', guide: 'DevTools 查 .rich：body 直接子节点 + is-fullscreen + w-e-full-screen-container，z-index 2147483647', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'N12' },
  { id: 'B3', group: 'B', title: '全屏内操作正常', guide: '输入文字/切粗体/展开下拉/插图片均正常，下拉面板不被遮挡；暗色下工具栏与悬浮菜单 hover 清晰可读', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'N12' },
  { id: 'B4', group: 'B', title: '退出全屏归位', guide: '容器回到表单原位置；旧父节点无残留 class；页面无空白遮罩', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'N12' },
  { id: 'B5', group: 'B', title: '连续进出全屏 3 次', guide: '每次正常，无空白层/抖动，编辑内容不丢', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'N12' },
  { id: 'B6', group: 'B', title: '深色主题全屏', guide: '重复 B1/B4：底色 #181818，文字与工具栏可读；代码块（查看源码内容）应为深底浅字', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'N12/V8' },
  { id: 'B7', group: 'B', title: '双实例互不影响', guide: '「富文本双实例」页只全屏实例 A → 实例 B 不受影响，退出后各归各位；切换两实例编辑焦点后引用/代码块/网络图片按钮不再假死禁用', entry: { type: 'route', target: TEMPLATE_TOOL_ID }, relates: 'N12/V8' },
  { id: 'B8', group: 'B', title: '图片库上传与插入', guide: '工具栏「图片库」→ 默认源按云→远程→本地；选来源（桶可输入、目录逐级展开可选任意层级或手输不存在目录）→ 上传后缩略图预览（点图放大/删除/全选/反选）→ 切到图库页仍能看到本次上传且选中状态一致；切目录/源/桶已选持续累积，同 URL 的图不重复计数；展开「已选清单」可查看各来源并逐项移除或清空；最后一并插入；搜索文件名快速定位；图过多分批渲染滚动加载、图片懒加载；设置切页/重启回显、多实例隔离', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'C2/R28' },
  { id: 'B9', group: 'B', title: '查看源码', guide: '工具栏「</>」按钮 → Monaco 代码编辑器（高度受控），打开即格式化展示；「格式化」「压缩」按钮生效且 pre/code 空白不被破坏；修改后「应用修改」写回编辑器；复制源码到剪贴板正常', entry: { type: 'route', target: TEMPLATE_TOOL_ID }, relates: 'R28' },
  { id: 'B10', group: 'B', title: '底部字数状态栏', guide: '编辑器底部显示 字数/字符（空格数）/段落；选中文字时显示「已选 X 字符」（字符口径计空格，与「字数」非空白口径不同）；全屏时状态栏沉底不丢', entry: { type: 'route', target: TEMPLATE_TOOL_ID }, relates: 'R28' },

  // ── C 组：开发者模式 / 密钥体系（验证清单 C1-C6）──
  { id: 'C1', group: 'C', title: '开发者模式口令弹框（打包版）', guide: '打包版开「开发者模式」→ 弹口令输入框；不填/填错开关回弹', entry: { type: 'settings', target: '系统与数据' }, requiresPackaged: true, relates: '10' },
  { id: 'C2', group: 'C', title: '正确口令开启', guide: '输入正确口令 → 开关开启，开发者工具入口出现', entry: { type: 'settings', target: '系统与数据' }, requiresPackaged: true, relates: '10' },
  { id: 'C3', group: 'C', title: '绕过 UI 被拒', guide: '绕过 UI 直接调配置接口开启开发者模式 → 主进程拒绝并提示需先通过访问密钥验证', requiresPackaged: true, relates: '10' },
  { id: 'C4', group: 'C', title: '自动安装开关默认关', guide: '「下载更新后重启自动安装」默认关闭；打开后重启仍保持', entry: { type: 'settings', target: '系统与数据' }, relates: '10' },
  { id: 'C5', group: 'C', title: '访问密钥说明可见', guide: '设置页「应用访问密钥」五套口令对照表可见，说明不联网/不登录/不加密文件/仅本机可见性门禁', entry: { type: 'settings', target: '系统与数据' }, relates: 'N10' },
  { id: 'C6', group: 'C', title: '需访问密钥工具隐藏', guide: '某工具设为「需访问密钥」且未配置 → 列表中隐藏；配置后重新出现', entry: { type: 'settings', target: '工具与权限' }, auto: { kind: 'catalogState', spec: 'grants' }, relates: 'N10' },

  // ── D 组：EDM 内容管理 / CSS / 编辑器（验证清单 D1-D18）──
  { id: 'D1', group: 'D', title: '左侧树默认展开', guide: '内容管理打开 → 默认展开到模板/片段类目层；品牌下顺序 css → 模板 → 片段', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'U1' },
  { id: 'D2', group: 'D', title: '空示例数据不报 YAML 错', guide: '空示例数据切「表单」→ 不报错，正常出空表单', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: '8/V1' },
  { id: 'D3', group: 'D', title: '纯注释/null YAML 容错', guide: '纯注释、null、~ 切换均不报错；真语法错仍明确报错', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: '8' },
  { id: 'D4', group: 'D', title: '显式 CSS link 提取', guide: '模板源码写 link @system/css/a.css 预览 → CSS 提取进 head 样式生效', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V6/R28' },
  { id: 'D5', group: 'D', title: 'CSS 引用去重', guide: '同一 CSS 重复引用 + 片段 repeat → head 内去重不重复注入', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V6' },
  { id: 'D6', group: 'D', title: '相对路径引用报错', guide: '引用写 ../../a.css → 明确报错并提示改用 @root/@system/@custom', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'R28' },
  { id: 'D7', group: 'D', title: '存量资产就近链回退', guide: '无 link 的存量资产预览 → 回退就近链仍能出样式', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'R28' },
  { id: 'D8', group: 'D', title: 'data: 图片批量上传回写', guide: '富文本插图保存示例数据 → data: 图片批量上传并回写 URL', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V9' },
  { id: 'D9', group: 'D', title: '新建同级版本', guide: '版本节点右键「新建版本（同级）」→ 复制全量内容，层级正确', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V1/V3' },
  { id: 'D10', group: 'D', title: '另存为类型隔离', guide: '另存为跨根/类型隔离 → 只能落允许的对象类型；自定义根统一 custom-edm', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V1/V4' },
  { id: 'D11', group: 'D', title: '自定义模板生成邮件', guide: '用 origin=custom 的模板/片段生成邮件 → 能被正确取用', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V5' },
  { id: 'D12', group: 'D', title: 'Monaco 多实例不串', guide: '多 tab + 深色主题 + md↔html 单向互转 → 多实例互不串内容；往返不保真属预期', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'V8' },
  { id: 'D13', group: 'D', title: '工具设置页左右布局', guide: '非上传工具设置页：左栏分组导航独立滚动、点击定位右栏；右栏独立滚动无空盒；保存条固定；改动出「未保存」提示', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: '#27' },
  { id: 'D14', group: 'D', title: '上传工具设置页不受影响', guide: '文件管理工具设置页仍是原样式，未被改成左右布局', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: '#27' },
  { id: 'D15', group: 'D', title: '形态 2 二级配置页', guide: '工具包开发模板：「工具配置」展开两个二级菜单；每页左栏只列该页分组、标题为页名；两页内容互不串', entry: { type: 'route', target: TEMPLATE_TOOL_ID }, relates: '#28' },
  { id: 'D16', group: 'D', title: '形态 2 页级保存隔离', guide: '「模型与调用」改字段保存 → 只落本页；切「路径与输出」改动保存 → 上页不丢；boolean/select 正常渲染持久化', entry: { type: 'route', target: TEMPLATE_TOOL_ID }, relates: '#28' },
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
  { id: 'F/A-V8', group: 'F', title: '关闭按钮最小化到托盘（2026-11-18）', guide: '常规设置开关默认关：点关闭弹确认框→确认退出；开启并保存后点关闭=窗口隐藏到托盘、托盘点开可回；关闭「系统托盘」开关时回落确认退出（不会藏丢）', entry: { type: 'settings', target: '常规' }, relates: 'A-V7' },
  { id: 'F/B-V1', group: 'F', title: '设置页左栏点击定位', guide: '逐个点左栏分组 → 右栏滚动定位且左栏高亮跟随（含反向滚动高亮）', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'B-V1' },
  { id: 'F/B-V2', group: 'F', title: '形态 2 页级隔离复验', guide: '「模型与调用」改字段保存 → 切「路径与输出」确认自己改动在且上页字段未被带过来 → 再切回双方均在', entry: { type: 'route', target: TEMPLATE_TOOL_ID }, relates: 'B-V2/D15/D16' },
  { id: 'F/C-V2', group: 'F', title: 'badge 四种数据源导入', guide: 'pickStats 用真实 xlsx/xls/csv/tsv/json 文件导入 → 三类解析齐备结果正确', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'C-V2' },
  { id: 'F/C-V4', group: 'F', title: 'CodeEditor JSON 只读视图', guide: '海报页 JSON 视图按钮打开 → 内容与格式正确', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'C-V4' },
  { id: 'F/D-V3', group: 'F', title: '流式打字感核查', guide: '模型对话观察打字感；dev 日志查 chunk#n size gap；打字平滑开关默认开', entry: { type: 'route', target: MODULE_IDS.modelManager }, relates: 'D-V3' },
  { id: 'F/D-T2', group: 'F', title: '模型能力供工具调用', guide: 'badge/EDM 的 AI 能力均可用（badge 视觉已验；EDM AI 填充/润色走 D-Q2）', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'D-T2/D-Q2' },
  { id: 'F/E-V1', group: 'F', title: '本地目录自检', guide: '文件管理工具自检按钮 + 本地 profile 上传回填', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'E-V1' },
  { id: 'F/E-V2', group: 'F', title: '真实 FTP/SFTP/OSS 连接', guide: '临时密钥不落盘；测试结构化不刷堆栈（N11 已修复验）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'E-V2/N11' },
  { id: 'F/E-V3', group: 'F', title: '校验收紧语义', guide: '工具收紧（交集/取小）；未设限字段 undefined', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'E-V3' },
  { id: 'F/E-V4', group: 'F', title: '内联图片回写', guide: 'saveSample 前 data: 图片批量上传回写 URL', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'E-V4/T8/V9' },
  { id: 'F/E-V5', group: 'F', title: '能力兜底横幅 + 一键重载', guide: '旧窗口点测试走通用通道或给可操作提示 + 一键重载', entry: { type: 'route', target: MODULE_IDS.fileManager }, auto: { kind: 'hostCapability', spec: 'callHostApi' }, relates: 'E-V5/N8/V11' },
  { id: 'F/E-V7', group: 'F', title: '打包后 SFTP 纯 JS 回退', guide: '随下次打包顺验：SFTP 连接不因 cpu-features shim 失效', requiresPackaged: true, relates: 'E-V7/C4' },
  { id: 'F/F-T1', group: 'F', title: '打包资源路径验证', guide: '安装目录 resources/edm-studio/assets/edm/ 存在且有品牌内容', requiresPackaged: true, auto: { kind: 'fileExists', spec: 'edm-assets' }, relates: 'F-T1' },
  { id: 'F/F-T2', group: 'F', title: '自定义根跨平台路径', guide: '正式包里自定义内容新建/编辑一次（落 userData/custom-edm）+ dev 同样操作一次（落源码旁）两边正常', requiresPackaged: true, relates: 'F-T2' },

  // ── G 组：2026-11-17 弹框/欢迎页走查（file-picker 通用化 + 全局弹框口径 + 欢迎页卡片 + 模型管理表单）──
  // kind 五类（image/document/code/video/all）暂不设项：EDM 图片字段尚未接入 FilePickerDialog（总账 E-T4），接入时随接入项一并新增
  { id: 'G1', group: 'G', title: '图片库新弹框交互定稿', guide: '富文本「图片库」：继续上传/插入所选沉底与关闭同行（关闭最右）；缩略图右上角删除=垃圾桶、移除已选=✕（悬浮红色）；目录下拉首次展开即自动拉取（带 loading，不用先切源）', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'E-T3/C2' },
  { id: 'G2', group: 'G', title: '弹框全局内缩口径', guide: '任开 2-3 个弹框（如模型管理新增 Provider、富文本源码查看、图片库）：顶部 12px、左右 16px 单层内缩，header/body/footer 间距均匀，内容不贴灰边、footer 不与 body 出现双内缩错位', relates: 'E-T3' },
  { id: 'G3', group: 'G', title: '欢迎页卡片走查', guide: '回桌面首页：描述最少显示 3 行超出内部滚动（卡片等高不跳动）；超长工具名悬浮时往返滚动显示全名（未超长不动）；标签过多一行内横向滚动', relates: 'E-T3' },
  { id: 'G4', group: 'G', title: '模型管理表单走查', guide: '重试次数为带加减的整数数字框（0=不重试、上限 5、手输小数收整）；新增 Provider 弹框 680px 双列布局，表单区定高随视口、超长内滚动，新增/编辑切换高度不跳', entry: { type: 'route', target: MODULE_IDS.modelManager }, relates: 'E-T3' },

  // ── H 组：文件系统（X6 · plans/08 §八验收清单；只新增不改旧 id）──
  { id: 'H1', group: 'H', title: '进入工具默认文件系统页 + 通道浏览', guide: '打开「文件管理」工具默认落在「文件系统」菜单（文件管理退居第二菜单）；5 个通道均能浏览到与 oss-browser 一致的目录结构（云侧虚拟目录=公共前缀正确呈现）', entry: { type: 'route', target: MODULE_IDS.fileManager }, auto: { kind: 'hostCapability', spec: 'fs' }, relates: 'X6/F-5' },
  { id: 'H2', group: 'H', title: '新建目录 / 重命名 / 删除即时刷新', guide: 'FTP 与 OSS 上新建目录、重命名、删除文件行为一致且列表即时刷新；递归删除大目录出现传输队列分批进度', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/F-2/F-3' },
  { id: 'H3', group: 'H', title: '大文件上传下载全链路', guide: '上传 100MB 文件：传输队列进度/速度/取消/失败重试全部可用；下载同理（落点 userData/downloads，可一键打开目录）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/F-4/F-7' },
  { id: 'H4', group: 'H', title: '文本编辑保存写回 + 冲突提示', guide: '文本文件在编辑器打开并保存，oss-browser 侧可见更新；用另一端改文件后再保存 → 提示「远端已变化」，可选覆盖或放弃', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/F-6' },
  { id: 'H5', group: 'H', title: '拖拽上传 + 文件夹递归 + 同名覆盖确认', guide: '从资源管理器拖文件/文件夹进列表 → 保留目录结构入队上传；远端已有同名文件时任务变「待确认」，点覆盖后继续', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/F-7' },
  { id: 'H6', group: 'H', title: '图片预览与新建文件', guide: '双击图片弹层预览（可缩放）；「新建文件」创建空白文本直接进编辑器，保存后远端可见', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/F-6' },
  { id: 'H7', group: 'H', title: '键盘与多选操作', guide: 'Ctrl/Shift 点选、全选、Delete 删除、F2 重命名、Ctrl+C/V/X 剪贴板跨目录粘贴、Backspace 上一级均生效', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/F-5' },
  { id: 'H8', group: 'H', title: '密钥未配置与错误态引导', guide: '未配置密钥的通道给出引导文案；断网/错密码时列表给分类错误（连接失败/认证失败）+ 重试按钮', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§3.3' },
  { id: 'H9', group: 'H', title: '音视频在线播放（二期）', guide: '双击 mp4/mp3 等媒体文件弹层播放（<video>/<audio> 原生控件）；超过在线预览上限（可配，默认 100MB，0=不限，入口：更多▾→上限设置）引导下载后本地播放；mkv/mov 等不保证可播的扩展无播放入口（只下载）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/二期' },
  { id: 'H10', group: 'H', title: '跨通道互拷（二期）', guide: '「复制到…」选其它通道 → 目录自动递归展开入队（超 1500 文件截断提示）；剪贴板跨通道粘贴按复制执行（剪切跨通道降级为复制，源保留）；传输队列显示「源 → 目标」；同名冲突待确认可覆盖', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/二期' },
  { id: 'H11', group: 'H', title: '递归搜索（二期）', guide: '搜索框回车触发递归搜索（当前路径前缀内，根=整个通道）；结果横幅显示数量与截断提示，「返回目录」还原；云侧扫描上限 5 万 key、远程限深 6 层', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/二期' },
  { id: 'H12', group: 'H', title: '目录容量统计（二期）', guide: '目录行「统计」或选中单个目录后工具栏「统计」：弹窗显示总大小与文件数；超大目录达扫描上限时明确标注「数值为已扫部分」', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/二期' },
  { id: 'H13', group: 'H', title: '拖拽上传（管理员/普通权限均可）', guide: '资源管理器拖文件/图片进文件系统页出蓝色遮罩、鼠标为复制光标、松手入队上传；管理员与普通权限运行行为一致（不再区分 UIPI，病根是 dragenter 未 preventDefault）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6' },
  { id: 'H14', group: 'H', title: '验证标记随代码同步', guide: '验证引导里标记 pass/fail + 填备注 → dev 下会话文件落在 docs/verify-sessions/<日期>.json（git status 可见，随代码提交同步到其它设备/成员；打包版本地留存）', entry: { type: 'settings', target: '系统与数据' }, relates: 'U2' },
  { id: 'H15', group: 'H', title: '复制/移动到目标目录回显与跨通道移动', guide: '复制到/移动到弹框：第二次打开时手输框与下拉显示同一个目录；目标通道选其它通道 → 复制走跨通道入队、移动=复制成功删源（源通道须可写）；云目录复制/移动按文件递归展开不再报「检查 Bucket 与目录」', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6' },
  { id: 'H16', group: 'H', title: 'Badge Studio HTML 高亮与模板下载', guide: '选择压缩版 minified.html → 单行不再显示「Rendering paused」，点「格式化」换行后高亮正常；「模板下载」主按钮直接下 Excel（含填写说明 sheet），箭头可选 CSV/JSON；最近使用改下拉（每项尾部删、右侧清空）', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'E-T5' },
  { id: 'H17', group: 'H', title: '更新流程（dev 测试模式）', guide: 'dev 设 SSHK_DEV_UPDATE_TEST=1 且本地 package.json 版本改旧 → 顶栏显示下载进度条横幅（可关闭），完成出「立即更新」；点已下载按钮不再回退到「检查中」；点安装仅提示不真装；验完改回版本号', entry: { type: 'settings', target: '系统与数据' }, relates: 'U2' },
  { id: 'H18', group: 'H', title: '分享链接跨重启有效', guide: '分享海报/邮件生成链接 → 关闭应用重新打开（TTL 未过）→ 原链接仍可访问；点重新生成 → 旧链接失效（新 token）；72h 到期链接自动 404', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'C-T1' },
  { id: 'H19', group: 'H', title: '扩展列与列设置（§十一）', guide: '本地/SFTP 通道在「更多 ▾ → 列设置…」可开创建时间/权限/用户组列（备注默认显示）；FTP/云通道无数据列自动隐藏不出「—」；显隐配置跨重启记忆', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§十一' },
  { id: 'H20', group: 'H', title: '行操作列定版与行级粘贴', guide: '行操作按 下载(文件)→链接(文件)→粘贴(目录,剪贴板有内容才出)→复制→移动→重命名→删除→更多▾；目录行「粘贴」直接落进该目录；行「更多」按条目类型/通道实时显隐（压缩解压仅本地、转换仅文本、权限仅本地/SFTP）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§十一' },
  { id: 'H21', group: 'H', title: '备注与收藏夹（§十一）', guide: '行/选中「设置备注…」确认后生效、备注列显示，留空清除；重命名/移动后备注跟随；「添加收藏」进收藏夹抽屉，跨通道「前往」直达目标目录', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§十一' },
  { id: 'H22', group: 'H', title: '编辑权限与属性（§十一）', guide: '本地/SFTP 单选文件或目录「编辑权限…」：rwx 勾选与八进制双向联动，点修改后二次确认才写入并刷新列表；「属性」弹框按通道如实展示名称/路径/大小/时间/权限/用户组/备注（含编辑入口）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§十一' },
  { id: 'H23', group: 'H', title: '文本编码/换行符转换与压缩解压（§十一）', guide: '本地/SFTP/云对文本文件「转换编码/换行符…」：自动检测源编码 → 确认后写回并提示实际判定结果；本地通道「压缩为 zip…」（多选也支持）与「解压到新目录」（zip 文件才出），解压结果在同级新目录', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§十一' },
  { id: 'H24', group: 'H', title: '必填红星与弹框自动聚焦', guide: '各处新建/编辑表单必填项（通道名称/Bucket/AccessKey ID、主机、品牌 code/名称、模板/片段名称、邮件名称、海报名等）显示红星并在保存时拦截空值；所有弹框打开后输入框自动聚焦，不用先点一下', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'U1' },
  { id: 'H25', group: 'H', title: '压缩上限设置与 Windows 路径修复（§十一）', guide: '「更多 ▾ → 压缩上限设置…」可调单次压缩/解压的文件数与容量上限（默认 3000 个 / 500MB），保存后立即生效并跨重启记忆；Windows 下拖拽或系统弹框选择文件/文件夹上传不再报「路径不允许包含反斜杠」', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/§十一' },
  { id: 'H32', group: 'H', title: '流式递归搜索与列表细节修正', guide: '搜索框回车触发递归搜索：结果边扫边显示（横幅显示已找到数量/已扫描目录数），不再长时间空白；收藏星标固定在名称列末尾（未收藏 hover 才显、已收藏常显实心），复选与操作列没有额外背景色；网格视图卡片右键弹出完整操作菜单（不是小黑框），点菜单项执行对应操作', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6' },
  { id: 'H33', group: 'H', title: '路径契约根治与复制下载增强', guide: '所有路径统一显示 /a/b/c（根 /），手输 a/b 自动补前导 /；复制到根目录：目标目录留空或填 / 均合法；同源同目录复制弹重命名框，重名继续弹直到改名或取消；工具栏「复制（剪贴板）」配「粘贴」按钮，行内「复制」为弹框直落；下载支持选中目录递归展开（上限在「更多▾→上限设置」可配：上传默认 10000、下载默认 0 不限制，0=不限）；搜索框输入即在当前目录过滤，回车递归搜索时当前目录命中始终保留', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6' },
  { id: 'H41', group: 'H', title: '上限拆分与搜索体验（2026-11-18）', guide: '「更多 ▾ → 上限设置…」：上传/下载文件数上限分开设置（默认上传 10000、下载 0 不限），设 0 生效为不限制；搜索扫描页数默认 500、0=不限，超出才提示「已达扫描上限」；搜索横幅左侧有旋转加载图标（搜索中转圈，结束即消失）；复制到/移动到目录下拉首位是「/（根目录）」可直接圈选', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6' },
  { id: 'H42', group: 'H', title: '收藏确认与粘贴询问（2026-11-18）', guide: '取消收藏（星标/菜单/收藏夹移除）均先弹确认（禁遮罩禁 ESC），确认后才移除；剪贴板复制后点「粘贴」→ 粘贴指令完成弹「是否清空剪贴板」：清空=按钮恢复无内容态，保留=可继续粘到别处', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6' },
  // ── H34-H40：传输队列可控化与分片/断点续传（plans/10）──
  { id: 'H34', group: 'H', title: '传输队列悬浮面板（plans/10）', guide: '传输队列变为悬浮面板：无遮罩，列表可滚动/右键/翻目录；拖拽手柄可移动（收起后摘要条仍可见可拖），「回到默认位置」可复位；位置/展开态跨重启记忆；resize 不出界', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },
  { id: 'H35', group: 'H', title: '全局与单条传输控制（plans/10）', guide: '面板工具栏 ▶全部开始/⏸全部暂停/⏹全部停止/↻失败重试/🗑清理已完结；全部暂停→在途任务在检查点停下（UI 显示「暂停中…」）→全部开始续跑；单条按状态显隐（开始/暂停/继续/停止/重试/覆盖/移除）；危险操作均有二次确认（禁遮罩禁 ESC）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },
  { id: 'H36', group: 'H', title: '分栏与搜索过滤（plans/10）', guide: '面板「全部/上传/下载/其它」分栏计数为「完成数/总数」；名称搜索即时过滤；收起态摘要计数同步；传输设置在「更多 ▾ → 传输设置…」可调分片参数并跨重启记忆', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },
  { id: 'H37', group: 'H', title: '大文件上传分片（plans/10）', guide: '上传 >50MB（阈值可改）到 OSS/S3 走分片（进度显示片数），其余通道回落单流；暂停/停止后服务端无残留 uploadId（停止即清理）；失败重试从已传片续传（「断点续传」标记 + 片数）；分片大小自动满足 10000 片上限', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },
  { id: 'H38', group: 'H', title: '大文件下载分片续传（plans/10）', guide: '下载大文件走 Range 分片（本地/SFTP/OSS/S3），临时 .sshkpart 不覆盖正式目标；暂停保留临时文件，点继续从中断区间续传完成；重启应用后恢复为「已暂停」，点继续可续传；FTP 等无 Range 通道回落单流', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },
  { id: 'H39', group: 'H', title: '队列持久化（plans/10）', guide: '只持久化未完结的上传/下载：重启后恢复为「已暂停」不自动续跑（面板可见）；copy/cross/delete 不写盘；源文件变更后续传自动废弃检查点重传；通道失效任务有明确错误提示，可移除或恢复配置后重试', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },
  { id: 'H40', group: 'H', title: '遗留分片清理（plans/10）', guide: '面板/传输设置显示服务端遗留 uploadId 数并可手动清理（二次确认）；分片设置（阈值默认 50MB / 片 5MB / 并发 3）实时生效、跨重启记忆', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'X6/plans10' },

  // ── S 组：常驻分享服务（ShareHub · plans/09；单例多路由，替代旧 ShareServer）──
  { id: 'S1', group: 'S', title: '冷启动 autoStart 开 → 运行中', guide: '设置 →「分享服务」tab：服务状态显示「运行中 · 端口 xxxxx」，展示 IP 为自动优选地址', entry: { type: 'settings', target: 'share' }, auto: { kind: 'hostCapability', spec: 'shareHub' }, relates: 'ShareHub/§3.1' },
  { id: 'S2', group: 'S', title: 'autoStart 关 → 已停止', guide: '「随应用启动」关 → 保存 → 重启应用：服务状态显示「已停止」，路由仍保留（点启动即恢复）', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.1' },
  { id: 'S3', group: 'S', title: 'badge 海报分享 → 局域网可访问', guide: 'Badge Studio 点「分享」→ 生成链接 + 二维码 → 手机/另一台设备访问可打开海报；多 IP 下拉可切换', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'ShareHub/§六-C' },
  { id: 'S4', group: 'S', title: 'EDM 产物分享 → 局域网可访问', guide: 'EDM 邮件页点「分享产物」→ 链接 + 二维码 → 局域网访问可列出/打开 outputs 产物', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'ShareHub/§六-C' },
  { id: 'S5', group: 'S', title: 'TTL 到期 → 404 + 列表摘除', guide: '创建短 TTL 路由（0.01h）→ 到期后访问 404，「路由管理」列表不再显示该条', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.2' },
  { id: 'S6', group: 'S', title: '重启应用 → 未过期链接继续可用', guide: '分享生成链接 → 重启应用 → 原链接仍可访问（token 属于路由不随进程，状态文件 resume）', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.1' },
  { id: 'S7', group: 'S', title: '重新生成 → 旧链失效', guide: 'ShareDialog 点「重新生成」→ 新 token → 旧链接立即 404', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'ShareHub/§3.2' },
  { id: 'S8', group: 'S', title: '停止 → 全失效，重启 → 恢复', guide: '点「停止」→ 所有链接失效；点「启动」→ 未过期路由链接恢复可用（路由表保留）', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.1' },
  { id: 'S9', group: 'S', title: '撤销单条 → 仅该链失效', guide: '「路由管理」撤销一条 → 仅该链接失效，其它路由正常', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.4' },
  { id: 'S10', group: 'S', title: '穿越 .. → 404', guide: '在分享链接后拼 `/../../etc/passwd` → 返回 404，无法越出 root', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.2' },
  { id: 'S11', group: 'S', title: '端口被占 → 回落 + 告警', guide: '「监听端口」填一个被占用端口保存 → 服务回落到随机端口并告警，状态显示实际端口', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.1' },
  { id: 'S12', group: 'S', title: 'IP 自动 / 下拉 / 手输三种生效', guide: '自动优选显示 10.x 优先；下拉选检测 IP 生成对应链接；手输合法 IPv4 生效，格式非法（如 abc/999.1.1.1）保存被拦截且不覆盖原值', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§四' },
  { id: 'S13', group: 'S', title: '分享密码 → 无访问密钥拒绝', guide: '带 password 创建分享 → 不带 ?ak= 访问 403，带正确访问密钥（ak）可访问', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'ShareHub/§六-D' },
  { id: 'S14', group: 'S', title: '二维码扫码可开', guide: 'ShareDialog 链接旁二维码 → 手机扫码直达分享页（第三方 qrcode 包生成）', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'ShareHub/§六-D' },
  { id: 'S15', group: 'S', title: '文件系统安全分享 → 可撤销有 TTL', guide: '文件管理本地通道行「安全分享」→ ShareDialog 生成可撤销/有 TTL 链接；裸外链「链接」按钮仍可用（两种并存）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'ShareHub/§六-C' },
  { id: 'S16', group: 'S', title: '停止并清空 → 状态文件删除', guide: '点「停止并清空」（二次确认）→ hub-state.json 删除、路由列表空；重启后无分享路由', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§3.1' },
  { id: 'S17', group: 'S', title: '永久有效 → tag 改文案颜色、URL 不变', guide: 'ShareDialog 点「永久有效」→ 剩余时间 tag 变「永久有效」（warning 色），链接地址不变；重启应用后仍可访问', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'ShareHub/§3.2' },
  { id: 'S18', group: 'S', title: '续期 TTL 累加 / 更新 TTL 重置', guide: '剩余约 48h 时点「续期 TTL」填 72 → 剩余约 120h（URL 不变）；点「更新 TTL」填 5 → 从当前重新计时为约 5h', entry: { type: 'route', target: TOOL_IDS.badgeStudio }, relates: 'ShareHub/§3.2' },
  { id: 'S19', group: 'S', title: 'TTL 数字框默认取应用设置、整数约束', guide: '设置默认时长改 12 → 打开分享弹框数字框显示 12；输入小数被取整；设置页端口/时长输入小数保存被拦截', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§五' },
  { id: 'S20', group: 'S', title: '自动分配端口跨重启沿用', guide: '设置端口 0（自动）→ 启动后记录实际端口 → 重启应用端口不变（链接稳定）；被占回落新端口后 autoPort 自动更新；固定端口（默认 56789）直接生效', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/§五' },
  { id: 'S21', group: 'S', title: '挂载目录三行卡片（2026-11-18）', guide: '设置 →「分享服务」→ 挂载目录：每项圆角卡片三行——行1 目录显示+选择目录+「允许访问目录」复选框（关=目录列表 404，具体文件路径仍可达）；行2 挂载点输入框（沾满剩余空间）+「启用」开关（关=整目录 404）；行3 地址+复制+删除；挂载点留空保存随机生成并记住；保存即生效无需重启', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/挂载目录' },
  { id: 'S22', group: 'S', title: '代理规则（2026-11-18）', guide: '「代理规则」区块：每项三行卡片——行1 目标地址（示例占位）+「保留原始 Host」复选框（默认保留，❓有场景解释）；行2 路径前缀+启用开关；行3 代理地址+复制+删除。访问 http://IP:端口/前缀/… 全方法（含 POST 请求体）转发到目标地址；转发带 X-Forwarded-For/Host/Proto（覆盖式防伪造）；目标不限网络；保存即生效', entry: { type: 'settings', target: 'share' }, relates: 'ShareHub/代理规则' },

  // ── T 组：分享管理工具化与日志链路改造（plans/12 · 2026-11-19）──
  { id: 'T1', group: 'T', title: '工具入口与五菜单页', guide: '工具列表出现「分享管理」→ 默认进路由管理；访问日志/服务配置/挂载管理/代理管理四个菜单页均可达（服务/挂载/代理以菜单页承载）', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §4.1' },
  { id: 'T2', group: 'T', title: '跨工具全量路由可见可管', guide: 'badge/edm/file-manager 各建一条分享 → 分享管理路由管理页可见全部（工具过滤下拉含各 toolId）；可撤销/续期任意工具的路由（跨工具特权=不传 toolId 软约束）', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §六①' },
  { id: 'T3', group: 'T', title: '路由表更新时间列', guide: '路由表含「更新时间」列；续期/改 TTL/切换允许索引/分享弹框重新生成后该列刷新；访问命中不刷新；创建时间不变', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §十一①' },
  { id: 'T4', group: 'T', title: '访问日志持久化重启仍在', guide: '访问几条分享链接 → 访问日志页有记录 → 重启应用 → 历史仍在（NeDB shareLogs，随备份 zip 导出）', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §七' },
  { id: 'T5', group: 'T', title: '时间范围快捷+自选', guide: '日志页时间范围：快捷（近1h/24h/7天/全部）与自选起止（EP daterange）都生效；自选按自然日闭区间，查询结果与筛选一致', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §8.2/§十二③' },
  { id: 'T6', group: 'T', title: '导出 CSV 随筛选', guide: '带筛选条件点「导出 CSV」→ 文件名 share-logs-<时间戳>.csv，Excel 打开中文不乱码（BOM），7 列（时间/来源IP/路径/状态码/命中路由ID/归属工具/标签）；已撤销路由的工具/标签列留空', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §六④/§十一⑤' },
  { id: 'T7', group: 'T', title: '单条/批量删除 + 仅清空', guide: '列操作「删除」/勾选「批量删除」/「仅清空访问日志」全部二次确认（禁遮罩禁 ESC）且生效；删除后记录消失且不因 flush 写回', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §十一⑥' },
  { id: 'T8', group: 'T', title: '日志容量可设置', guide: '服务配置页日志容量卡片：条数（1~100000 默认 5000）/天数（1~365 默认 30），保存即时生效跨重启；非法输入回弹默认并提示', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §六③/§十二④' },
  { id: 'T9', group: 'T', title: '应用设置瘦身为两卡片', guide: '设置→分享服务 tab 仅剩服务状态+基础设置两卡片（挂载/代理/路由/日志四段无残留）；按钮文案为「停止服务并清空全部路由」且确认框注明不影响访问日志', entry: { type: 'settings', target: 'share' }, relates: 'plans/12 §4.2/§十二⑤' },
  { id: 'T10', group: 'T', title: '两处入口同键一致', guide: '服务配置页改端口/时长/IP/开关保存 → 应用设置 tab 刷新后同值；反向亦一致（同键 app.shareHub.* 天然一致）', entry: { type: 'route', target: MODULE_IDS.shareManager }, relates: 'plans/12 §4.2' },

  // ── M 组：内容管理（plans/11，C1-C14）──
  { id: 'M1', group: 'M', title: 'CRUD + 名称必填 + label 不换行', guide: '文件管理→内容管理：新建/编辑/复制另存/删除均正常；名称空时保存禁用；表单一行 label 自动右对齐不换行', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C1' },
  { id: 'M2', group: 'M', title: '字数入库正确', guide: '写一篇中英混排文章保存 → 列表字数＝非空白字符数（中西文逐字符计 1，如「ab 中文」计 4），刷新后仍正确（入库字段非现算）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C12/H1' },
  { id: 'M3', group: 'M', title: '分享状态列自己/公用颜色与 tip', guide: '行分享后显示「复制链接」+ 自己的(primary)；顶部分享内容后显示公用的(warning)；可访问/已失效颜色正确', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C2' },
  { id: 'M4', group: 'M', title: '复制链接优先级（自己优先、失效回落）', guide: '本行有存活 B 票→复制直达单篇；撤销后回落 C 公用总链；都没有→提示生成', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C3' },
  { id: 'M5', group: 'M', title: '编辑弹框默认最大化 + 四态控件', guide: '点编辑→弹框默认最大化；最小化收为可拖拽悬浮条点击复原；最大化/还原、全屏、关闭均生效', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C4' },
  { id: 'M6', group: 'M', title: '富文本全屏与弹框全屏互不改写', guide: '弹框最大化态点富文本工具栏全屏→正文铺满且盖住弹框 header；退出富文本全屏→回到弹框最大化态，二者状态未串', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C5' },
  { id: 'M7', group: 'M', title: '图片库注入可用且图片外链', guide: '编辑弹框富文本点「图片库」→列表/上传可用（本地+远程/云来源）；插图后文章 HTML 只存外链不落库', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C6/S2' },
  { id: 'M8', group: 'M', title: '三件套导出内容齐全、MD 可读', guide: '导出→ZIP 含 原始内容.html / 阅读页.html / 内容.md 三份；MD 文本可读（往返不保真已声明）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C7' },
  { id: 'M9', group: 'M', title: '批量操作 + 二次确认', guide: '勾选多行→批量删除/批量导出三件套/HTML/MD 生效；删除类弹二次确认（禁遮罩禁 ESC）', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C8' },
  { id: 'M10', group: 'M', title: '状态流转与公用列表过滤', guide: '新建=草稿；发布→已发布并进入公用总链列表；下线→从公用列表消失且二次确认', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C9' },
  { id: 'M11', group: 'M', title: 'contents 随备份 zip 进出', guide: '系统设置导出备份→zip 的 data/ 含 contents.db；清空后导入备份→文章恢复', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C10' },
  { id: 'M12', group: 'M', title: '单篇活链接 ?ak= 可达 + 删除后 404', guide: '行分享→手机/另一设备访问链接（带 ?ak=）可读到最新正文；设置口令时无 ak 返回 403；删除文章后同链接 404 不悬空', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C11/C13/H2' },
  { id: 'M13', group: 'M', title: '图片库单一实现三处共用', guide: '内容管理 / EDM / 模板工具的图片库来源与上传行为一致（同一份 @sshk/file-picker 桥接），无工具内重复实现', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 C14/S2' },
  { id: 'M14', group: 'M', title: 'editorMode 双容器 + dev 铁律', guide: 'app.modules.fileManager.editorMode=dialog 用弹框壳、=page 用整页壳（文件管理>工具设置切换，P4-8c 键迁移），两壳共用 ContentEditorCore（切换只换容器）；dev 下两种模式代码路径全量可达，配置仅决定打包版默认', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: 'plans/11 #8/S4' },
  { id: 'M15', group: 'M', title: '定时发布 + 列表筛选 + 默认根目录（2026-11-19）', guide: '状态选「定时发布」仅当前以后可选时分秒；到点自动翻已发布；列表顶部搜索/时间/标签/分享/发布五重筛选；复制/移动/解压弹框默认根目录回显；分页信息中文展示', entry: { type: 'route', target: MODULE_IDS.fileManager }, relates: '2026-11-19 用户反馈 6 项' },

  // ── FM 组：表单设计（plans/13，2026-11-23）──
  { id: 'FM1', group: 'FM', title: '模块入口与工具配置页', guide: '应用管理→表单设计三菜单齐全；工具设置页「嵌套深度上限」默认 5、改 0 保存后重启仍为 0（0=无限制）', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 B1' },
  { id: 'FM2', group: 'FM', title: '表单 CRUD 与双层校验', guide: '新建表单：名称空时停留不发请求且红 tip；设计器加字段/改类型/拖拽排序/红字校验；保存后列表字段数/版本正确', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 B1' },
  { id: 'FM3', group: 'FM', title: '预览展开复合控件', guide: '表单设计器「复合控件」下拉插入内置控件 → 预览弹框展开为原子字段并可填写；删除引用的控件后该表单保存/预览报「不存在」', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 C' },
  { id: 'FM4', group: 'FM', title: '内置控件只读 + 自定义 CRUD', guide: '控件管理：内置两行（联系人组/产品卡）只读、删除按钮禁用；自定义控件新建/编辑/删除正常；key 重复/非法格式前端拦截不发请求', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 C' },
  { id: 'FM5', group: 'FM', title: '删除拦截（引用反查）', guide: '被表单引用的自定义控件点删除 → 报「被表单 X 引用，请先解除引用」；解除引用后可删除', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 C' },
  { id: 'FM6', group: 'FM', title: '深度上限配置生效', guide: '嵌套引用超上限的控件保存报「超过配置上限（N 层）」；上限改 0（无限制）后同结构可保存但循环引用仍被拦截', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 C/工具配置' },
  { id: 'FM7', group: 'FM', title: 'EDM 从表单库导入', guide: 'EDM 内容管理→版本节点→示例数据→设计模式「从表单库导入」：选表单导入字段（复合控件已物化）；已有字段时先确认覆盖；保存字段定义写入 meta.yaml，重开回显', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: 'plans/13 D' },
  { id: 'FM8', group: 'FM', title: 'forms/formControls 随备份进出', guide: '系统设置导出备份→zip data/ 含 forms.db 与 formControls.db；清空后导入备份→表单与控件恢复', entry: { type: 'route', target: MODULE_IDS.formManager }, relates: 'plans/13 B1' },
  { id: 'FM9', group: 'FM', title: 'EDM AI 助手工具级 Provider/模型', guide: 'EDM 工具配置页「AI 助手」组：Provider 默认（跟随应用激活）+ 模型覆盖留空；单独指定 Provider/填模型后 AI 填充/润色按指定调用（日志 llm chat start models 可核）', entry: { type: 'route', target: TOOL_IDS.edmStudio }, relates: '需求 2026-11-23' },
]

/** 步骤总数（页脚展示用） */
export const VERIFY_STEPS_TOTAL = VERIFY_STEPS.length

/** 单条会话内某步骤的结果 */
export interface VerifyStepResult {
  /** 判定状态；清除判定后可缺省（仅保留 note/at），表示回到未判定 */
  state?: 'pass' | 'fail' | 'skip'
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
