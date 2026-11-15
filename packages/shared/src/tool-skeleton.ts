/**
 * 创建工具骨架的纯函数层：请求校验 + 文件映射生成，不触碰磁盘。
 * 磁盘写入由 dev-tools.ts 的 devToolCreate handler 完成（guard 源码仓库 + 目录冲突检查 + mkdir）。
 * 抽成纯函数便于单测，也保证「向导表单 → 骨架文件」逻辑只有一份。
 */
import { TOOL_PACKAGE_SCHEMA_VERSION } from './trust'
import { HOST_API_VERSION } from './trust'
import type { ToolConfigFieldType, ToolConfigGroup, ToolConfigPage } from './types'

const ID_RE = /^[a-z][a-z0-9-]{1,63}$/
const MENU_ID_RE = /^[a-z][a-z0-9-]{0,31}$/

/** 7 项宿主能力（与 ToolManifestDialog 一致） */
export const CREATE_CAPABILITIES = [
  'getToolSecret', 'setToolSecret', 'chat', 'listProviders',
  'chatByProvider', 'listModelsByProvider', 'runLocalOcr',
] as const

export interface CreateToolRequest {
  id: string
  name: string
  description: string
  category: string
  tags?: string[]
  visibility?: string
  menus: { id: string; label: string }[]
  capabilities?: string[]
  ipcAllowlist?: string[]
  configLayout?: 'single' | 'menu'
  configGroups?: ToolConfigGroup[]
  configPages?: ToolConfigPage[]
}

export interface SkeletonFile {
  /** 相对 tools/<id>/ 的路径 */
  path: string
  content: string
}

/** kebab/snake → PascalCase：home → Home，my-page → MyPage */
export function pascalCase(raw: string): string {
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('')
}

/** 校验创建请求；失败抛出带原因的 Error（渲染层直接展示） */
export function assertCreateRequest(req: CreateToolRequest): void {
  if (!ID_RE.test(String(req.id ?? ''))) {
    throw new Error(`工具 id 非法：${String(req.id ?? '')}（小写字母开头，仅小写字母/数字/连字符，2-64 位）`)
  }
  if (!String(req.name ?? '').trim()) throw new Error('工具名称不能为空')
  if (!String(req.description ?? '').trim()) throw new Error('工具描述不能为空')
  if (!Array.isArray(req.menus) || req.menus.length === 0) throw new Error('至少需要一个菜单页面')
  const menuIds = new Set<string>()
  for (const menu of req.menus) {
    if (!MENU_ID_RE.test(String(menu.id ?? ''))) throw new Error(`菜单 id 非法：${String(menu.id ?? '')}`)
    if (!String(menu.label ?? '').trim()) throw new Error(`菜单「${menu.id}」的显示名称不能为空`)
    if (menuIds.has(menu.id)) throw new Error(`菜单 id 重复：${menu.id}`)
    menuIds.add(menu.id)
  }
  for (const group of req.configGroups ?? []) {
    if (!String(group.id ?? '').trim() || !String(group.label ?? '').trim()) {
      throw new Error('配置分组必须填写 id 与名称')
    }
    if (!Array.isArray(group.fields) || group.fields.length === 0) {
      throw new Error(`配置分组「${group.label}」至少需要一个字段`)
    }
    for (const field of group.fields) {
      if (!String(field.key ?? '').trim() || !String(field.label ?? '').trim()) {
        throw new Error(`分组「${group.label}」存在未填写 key / 名称的字段`)
      }
    }
  }
  if (req.configLayout === 'menu') {
    const groupIds = new Set((req.configGroups ?? []).map((group) => group.id))
    for (const page of req.configPages ?? []) {
      if (!String(page.id ?? '').startsWith('config-')) {
        throw new Error(`配置页 id 必须以 config- 开头：${String(page.id ?? '')}`)
      }
      if (!Array.isArray(page.groups) || page.groups.length === 0) {
        throw new Error(`配置页「${page.label ?? page.id}」至少要引用一个分组`)
      }
      for (const gid of page.groups) {
        if (!groupIds.has(gid)) throw new Error(`配置页「${page.id}」引用了不存在的分组：${gid}`)
      }
    }
  }
}

/** 按字段类型推导默认值（defaults 自动生成，新手零手填） */
function defaultValue(type: ToolConfigFieldType, field: { min?: number; options?: { label: string; value: string }[] }): unknown {
  if (type === 'boolean') return false
  if (type === 'number') return field.min ?? 0
  if (type === 'select') return field.options?.[0]?.value ?? ''
  return ''
}

/** 把 `a.b.c` 点路径写入嵌套对象 */
function nestedSet(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] ?? ''
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1] ?? ''] = value
}

export function buildDefaults(groups: ToolConfigGroup[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const group of groups) for (const field of group.fields) {
    nestedSet(out, field.key, defaultValue(field.type, field))
  }
  return out
}

/** 通用默认图标：与模板工具同款风格的抽象文档图标 */
function defaultIcon(name: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <rect x="6" y="6" width="36" height="36" rx="8" fill="#2f6bff"/>
  <path d="M16 17h16M16 25h16M16 33h9" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  <circle cx="34" cy="33" r="3" fill="#ffd166"/>
  <!-- ${name} -->
</svg>
`
}

const MAIN_TEMPLATE = `import type { IpcMain } from 'electron'
import type { ToolHostCapabilities } from '@sshk/shared'

/**
 * 工具主进程入口（builtin 契约：默认导出 (ipcMain, deps) => void）。
 * 需要宿主能力（模型 / 密钥 / OCR）时参考 tools/template-tool 的 host.* 用法。
 * 通道前缀一律用 deps.toolId（源自 manifest.id），不在源码里写死工具 id。
 */
export default function registerToolMain(
  ipcMain: IpcMain,
  deps: { toolId: string; host: ToolHostCapabilities },
): void {
  const ch = (name: string) => \`\${deps.toolId}:\${name}\`

  // 最小示例：ping 通道。新增通道后记得在 tool.manifest.json 的 plugin.channels 里登记。
  ipcMain.handle(ch('ping'), () => \`pong @ \${Date.now()}\`)
}
`

const STATE_TEMPLATE = `import { computed, ref } from 'vue'

/**
 * 工具共享状态（模块级单例）：toolId 由宿主注入（单一来源 = manifest.id），
 * 源码不硬编码工具 id；shell 在 setup 阶段同步注入，页面生命周期晚于注入。
 */
export const toolId = ref('')

function assertId(): string {
  if (!toolId.value) throw new Error('toolId 未由宿主注入（shell 必须先注入 toolId 再渲染页面）')
  return toolId.value
}
const PREFIX = computed(assertId)

/** 调用本工具主进程通道：实际通道 = \`\${toolId}:\${name}\` */
export function call<T = unknown>(name: string, ...args: unknown[]): Promise<T | undefined> {
  return window.api.ipc.invoke(\`\${PREFIX.value}:\${name}\`, ...args) as Promise<T | undefined>
}
`

function firstPageTemplate(id: string, label: string): string {
  return `<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { call } from '../state'

/** 最小可跑示例：主进程 ping + 本工具配置读写。照此页面开始功能开发，替换成你的业务。 */
const pong = ref('')
const greeting = ref('')
const configKey = 'tools.${id}.greeting'

async function load(): Promise<void> {
  pong.value = String(await call<string>('ping') ?? '（主进程未响应）')
  greeting.value = String(await window.api.config.get(configKey) ?? '')
}

async function save(): Promise<void> {
  try {
    await window.api.config.set(configKey, greeting.value)
    ElMessage.success('已保存')
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

onMounted(load)
</script>

<template>
  <div class="starter">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
      这是「${label}」的最小可跑骨架：能调主进程、能读写本工具配置（tools.${id}.*）。
      直接在本文件上替换成你的业务逻辑。
    </el-alert>
    <el-form label-width="90px" size="small">
      <el-form-item label="主进程">
        <el-input :model-value="pong" readonly style="width: 320px" />
      </el-form-item>
      <el-form-item label="问候语">
        <el-input v-model="greeting" style="width: 320px" placeholder="写点什么，保存后会持久化" />
        <el-button size="small" type="primary" @click="save">保存</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.starter { max-width: 560px; }
</style>
`
}

function placeholderPageTemplate(label: string, id: string): string {
  return `<script setup lang="ts">
/** 「${label}」占位页：把内容替换成你的业务逻辑。 */
</script>

<template>
  <el-empty description="「${label}」页面待开发（src/renderer/pages/${pascalCase(id)}Page.vue）" />
</template>
`
}

function shellTemplate(_id: string, name: string, menus: { id: string; label: string }[]): string {
  const imports = menus
    .map((menu) => `import ${pascalCase(menu.id)}Page from './pages/${pascalCase(menu.id)}Page.vue'`)
    .join('\n')
  const map = `const pages: Record<string, unknown> = {\n${menus.map((menu) => `  '${menu.id}': ${pascalCase(menu.id)}Page,`).join('\n')}\n}`
  return `<script setup lang="ts">
import { computed } from 'vue'
import { ToolPageLayout } from '@sshk/ui-kit'
${imports}
import { toolId } from './state'

/**
 * 渲染层页面壳：只负责接收宿主 menu/toolId 并分发到 pages/ 下各页面，业务全部在子页面。
 * 目录约定：src/renderer/<Id>Page.vue 壳 + pages/ 每菜单一页 + state.ts 共享状态。
 */
const props = defineProps<{ menu?: string; toolId?: string }>()
// toolId 单一来源 = manifest.id，经宿主目录裁决后以 prop 注入；源码不兜底硬编码
toolId.value = props.toolId ?? ''

${map}
const active = computed(() => pages[props.menu ?? ''] ?? ${pascalCase(menus[0]?.id ?? 'home')}Page)
</script>

<template>
  <ToolPageLayout :title="'${name}'">
    <component :is="active" :menu="menu" :tool-id="toolId" />
  </ToolPageLayout>
</template>
`
}

function manifestObject(req: CreateToolRequest): Record<string, unknown> {
  const configGroups = req.configGroups ?? []
  const manifest: Record<string, unknown> = {
    id: req.id,
    name: req.name,
    description: req.description,
    category: req.category || '开发',
    tags: req.tags?.length ? req.tags : ['新建'],
    icon: 'auto',
    entryRoute: req.menus[0]?.id ?? 'home',
    enabled: true,
    visibility: req.visibility || 'managed',
    configLayout: req.configLayout === 'menu' ? 'menu' : 'single',
    menus: req.menus,
    plugin: {
      source: 'builtin',
      main: 'src/main/index.ts',
      renderer: `src/renderer/${pascalCase(req.id)}Page.vue`,
      channels: [`${req.id}:ping`],
    },
    dependsOn: [],
    configDeps: [],
    requiredGrant: '',
    configGroups,
    defaults: buildDefaults(configGroups),
    package: {
      schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
      version: '0.0.0',
      requiresHost: {
        api: `^${HOST_API_VERSION.split('.')[0]}.0`,
        capabilities: req.capabilities?.length ? req.capabilities : [],
      },
      sandbox: 'utility',
      ipcAllowlist: req.ipcAllowlist?.length ? req.ipcAllowlist : ['config:get', 'config:set'],
    },
  }
  if (req.configLayout === 'menu' && req.configPages?.length) manifest.configPages = req.configPages
  return manifest
}

function packageJson(req: CreateToolRequest): string {
  const pkg = {
    name: `@sshk/${req.id}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    description: `${req.name}（由「创建工具」向导生成）`,
    exports: {
      '.': './src/index.ts',
      './main': './src/main/index.ts',
      './renderer': `./src/renderer/${pascalCase(req.id)}Page.vue`,
    },
    scripts: { typecheck: 'tsc --noEmit -p tsconfig.json' },
    dependencies: {
      '@sshk/shared': 'workspace:*',
      '@sshk/ui-kit': 'workspace:*',
      'element-plus': 'latest',
      vue: 'latest',
    },
    devDependencies: { typescript: '6' },
    engines: { node: '>=24' },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

/** 生成整套骨架文件映射（不含 tool.manifest.json 以外的运行期产物） */
export function buildSkeletonFiles(req: CreateToolRequest): SkeletonFile[] {
  assertCreateRequest(req)
  const manifest = manifestObject(req)
  const dir = `tools/${req.id}`
  const files: SkeletonFile[] = [
    { path: `${dir}/tool.manifest.json`, content: JSON.stringify(manifest, null, 2) + '\n' },
    { path: `${dir}/package.json`, content: packageJson(req) },
    { path: `${dir}/tsconfig.json`, content: '{\n  "extends": "../../tsconfig.base.json",\n  "include": ["src/**/*.ts", "src/**/*.d.ts"]\n}\n' },
    { path: `${dir}/assets/icon.svg`, content: defaultIcon(req.name) },
    { path: `${dir}/src/main/index.ts`, content: MAIN_TEMPLATE },
    { path: `${dir}/src/renderer/state.ts`, content: STATE_TEMPLATE },
    { path: `${dir}/src/renderer/${pascalCase(req.id)}Page.vue`, content: shellTemplate(req.id, req.name, req.menus) },
  ]
  req.menus.forEach((menu, index) => {
    const pageFile = `${dir}/src/renderer/pages/${pascalCase(menu.id)}Page.vue`
    // 首个菜单给最小可跑示例，其余给占位页
    files.push({ path: pageFile, content: index === 0 ? firstPageTemplate(req.id, menu.label) : placeholderPageTemplate(menu.label, menu.id) })
  })
  return files
}
