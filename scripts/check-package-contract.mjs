#!/usr/bin/env node
/**
 * 运行时工具包契约门禁（零依赖，本轮只校验字段，不实现安装）。
 *
 * builtin 工具可以不填 package；一旦填了（外部导入包），必须满足：
 * schemaVersion 与宿主一致、sandbox 合法、ipcAllowlist 只含已声明通道、
 * requiresHost 结构完整、签名算法只能是 ed25519。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const trustSrc = readFileSync(join(ROOT, 'packages/shared/src/trust.ts'), 'utf8')
const ipcSrc = readFileSync(join(ROOT, 'packages/shared/src/ipc.ts'), 'utf8')
const SCHEMA = Number(/TOOL_PACKAGE_SCHEMA_VERSION\s*=\s*(\d+)/.exec(trustSrc)?.[1] ?? 0)
const CHANNELS = new Set([...ipcSrc.matchAll(/:\s*'([a-z][A-Za-z0-9:_-]+)'/g)].map((m) => m[1]))
const errors = []
let manifests = 0
let contracted = 0

const toolsDir = join(ROOT, 'tools')
for (const name of existsSync(toolsDir) ? readdirSync(toolsDir) : []) {
  const file = join(toolsDir, name, 'tool.manifest.json')
  if (!existsSync(file)) continue
  manifests += 1
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  const where = relative(ROOT, file)
  // 同类交互统一：路径/目录类配置必须用 dir / file 类型（渲染成 选择+可改，不许裸 string 手填）
  for (const group of manifest.configGroups ?? []) {
    for (const field of group.fields ?? []) {
      const label = field.label ?? ''
      const pathLike = !/文件名|filename/i.test(field.key + ' ' + label) && /dir|目录|路径|path|file|文件/i.test(field.key + ' ' + label)
      const isPathType = field.type === 'dir' || field.type === 'file'
      if (pathLike && !isPathType && field.type === 'string') {
        errors.push(`${where}: 路径类字段 ${field.key} 应用 dir / file 类型（选择+可改），不要 string 手填`)
      }
    }
  }
  if (!manifest.package) continue
  contracted += 1
  const pkg = manifest.package
  if (pkg.schemaVersion !== SCHEMA) errors.push(`${where}: schemaVersion 应为 ${SCHEMA}`)
  if (pkg.sandbox !== 'main' && pkg.sandbox !== 'utility') errors.push(`${where}: sandbox 非法`)
  if (!pkg.requiresHost || typeof pkg.requiresHost.api !== 'string' || !Array.isArray(pkg.requiresHost.capabilities)) {
    errors.push(`${where}: requiresHost.api / capabilities 缺失`)
  }
  if (!Array.isArray(pkg.ipcAllowlist)) errors.push(`${where}: ipcAllowlist 必须是数组`)
  else for (const channel of pkg.ipcAllowlist) {
    if (!CHANNELS.has(channel)) errors.push(`${where}: 未声明的 IPC 通道 ${channel}`)
  }
  if (pkg.signature && pkg.signature.algorithm !== 'ed25519') {
    errors.push(`${where}: 签名算法仅支持 ed25519`)
  }
  // 只有签名有效 + 公钥可信 + 显式信任才允许 main；契约层先卡住「无签名却要 main」。
  // 本规则约束的是【外部分发】清单；tools/ 内置源码清单的信任来自随应用构建（代码审查），
  // 允许声明 package 契约作为开发模板（内外零差异），签名要求由运行时安装链
  // （runtime-installer::verifySignature + check:signature）在分发侧执行。
  if (pkg.sandbox === 'main' && !pkg.signature && manifest.plugin?.source !== 'builtin') {
    errors.push(`${where}: 申请 main 权限必须带签名（见信任决策矩阵）`)
  }
}

console.log('运行时工具包契约检查')
console.log(`  扫描清单         : ${manifests}`)
console.log(`  带 package 契约  : ${contracted}（builtin 可缺省）`)
console.log(`  宿主 schema/api  : ${SCHEMA}`)
if (!SCHEMA || CHANNELS.size === 0) errors.push('宿主契约常量解析失败')
if (errors.length) {
  console.error('\n发现违规：')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
}
console.log('  结论             : 通过')
