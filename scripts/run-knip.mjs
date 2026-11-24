#!/usr/bin/env node
/**
 * knip 未使用代码/依赖检查的跨平台包装器。
 *
 * 背景（2026-11-24）：knip 6.48.0 搭配 oxc-parser 0.156.0 时默认开启
 * experimentalRawTransfer，后者每次 parseSync 都会 new ArrayBuffer(6 GiB)
 * （2 GiB 数据区 + 4 GiB 对齐），Windows 上该虚拟内存分配频繁失败：
 *   RangeError: Array buffer allocation failed
 * knip 官方在 dist/typescript/ast-nodes.js 内置了逃生开关
 * KNIP_DISABLE_RAW_TRANSFER=1，关闭后走普通 parseSyncBinding 路径，
 * 检查结果一致，仅解析稍慢。
 *
 * 用 Node 包装器而非 shell 前缀（VAR=1 knip），是因为 Windows 的 pnpm scripts
 * 默认走 cmd.exe，不认 POSIX 的环境变量前缀语法；直接以 node 执行 bin/knip.js
 * 还能绕开 .cmd shim，Windows / PowerShell / POSIX bash 行为完全一致。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const knipBin = join(ROOT, 'node_modules', 'knip', 'bin', 'knip.js')

if (!existsSync(knipBin)) {
  console.error('knip 未安装，请先执行 pnpm install')
  process.exit(1)
}

const result = spawnSync(process.execPath, [knipBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env, KNIP_DISABLE_RAW_TRANSFER: '1' },
})
if (result.error) {
  console.error(result.error)
  process.exit(1)
}
process.exit(result.status ?? 1)
