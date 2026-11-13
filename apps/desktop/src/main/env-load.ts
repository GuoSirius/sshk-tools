/**
 * 环境变量统一加载（必须作为主进程第一个 import）：读取仓库根目录 .env（模板见 .env.example）。
 * 解析用 dotenv，不自己实现；dotenv 默认不覆盖已存在的真实环境变量。
 * dev 时 cwd=apps/desktop，向上两级找根目录 .env；打包后无 .env，静默跳过。
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'

for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) {
    config({ path: p, quiet: true })
    break
  }
}
