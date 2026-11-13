/**
 * 打包示例运行时测试包：node scripts/pack-runtime-sample.mjs
 * 产物 examples/runtime-sample.sshktool → 设置中心导入即可端到端验证运行时链路
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
// fflate 声明在 apps/desktop 依赖里，用 createRequire 就近解析
const req = createRequire(fileURLToPath(new URL('../apps/desktop/package.json', import.meta.url)))
const { zipSync } = req('fflate')

const zip = zipSync({
  'tool.manifest.json': readFileSync(root + 'examples/runtime-sample/tool.manifest.json'),
  'dist/page.js': readFileSync(root + 'examples/runtime-sample/dist/page.js'),
  'dist/main.js': readFileSync(root + 'examples/runtime-sample/dist/main.js'),
})
writeFileSync(root + 'examples/runtime-sample.sshktool', Buffer.from(zip))
console.log('已打包 examples/runtime-sample.sshktool（设置中心 → 运行时工具包 → 导入安装）')
