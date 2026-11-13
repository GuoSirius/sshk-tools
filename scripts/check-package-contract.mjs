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
  if (!manifest.package) continue
  contracted += 1
  const where = relative(ROOT, file)
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
  // 只有签名有效 + 公钥可信 + 显式信任才允许 main；契约层先卡住「无签名却要 main」
  if (pkg.sandbox === 'main' && !pkg.signature) {
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
