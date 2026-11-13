#!/usr/bin/env node
/**
 * .vue 文件类型检查（含未使用变量等 noUnused* 规则）。
 *
 * vue-tsc 由用户按需安装（pnpm install 时随 devDependencies 落地）；
 * 未安装时跳过并给出一行提示，避免门禁在依赖未同步的机器上误红。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const win = process.platform === 'win32'
const bin = join(ROOT, 'node_modules', '.bin', win ? 'vue-tsc.cmd' : 'vue-tsc')

if (!existsSync(bin)) {
  console.log('vue-tsc 未安装，跳过 .vue 类型检查（pnpm install 后自动生效）')
  process.exit(0)
}

// Windows 需 shell:true 解析 .cmd（此时路径要带引号防空格）；posix 必须 shell:false
// 且不带引号——引号会被当成文件名的一部分（CI 在 Ubuntu 上曾因此 ENOENT 挂掉）
const result = spawnSync(win ? `"${bin}"` : bin, ['--noEmit', '-p', 'tsconfig.vue.json'], {
  stdio: 'inherit',
  shell: win,
  cwd: ROOT,
})
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('.vue 类型检查通过')
