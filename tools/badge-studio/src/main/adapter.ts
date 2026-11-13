import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PaddleOCR 适配器的宿主托管：
 * 脚本源码在构建期以文本打进 bundle（import.meta.glob raw），运行时幂等落盘到
 * userData/adapters/ —— dev 与打包后路径一致，用户配置里不需要也不应该写适配器路径。
 */

const SCRIPTS = import.meta.glob('../../scripts/*.py', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** 解析出的适配器脚本名 → 源码 */
export const ADAPTER_SCRIPTS: Record<string, string> = Object.fromEntries(
  Object.entries(SCRIPTS).map(([file, text]) => [file.split('/').pop() ?? file, text]),
)

/** 幂等写出全部脚本，返回 paddleocr_adapter.py 的绝对路径（electron 仅主进程可用，动态取） */
export async function ensureAdapterScript(): Promise<string> {
  const { app } = await import('electron')
  const dir = join(app.getPath('userData'), 'adapters')
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(ADAPTER_SCRIPTS)) {
    writeFileSync(join(dir, name), text, 'utf8')
  }
  return join(dir, 'paddleocr_adapter.py')
}

/**
 * 组装 OCR 命令参数（纯函数便于单测）：
 * 用户模板只需要 {image}；适配器脚本路径由宿主注入——
 * 用户显式写了 .py 脚本则尊重用户，否则自动前置适配器路径。
 */
export function withAdapterArgs(userArgs: string[], adapterPath: string): string[] {
  const hasScript = userArgs.some((arg) => arg.toLowerCase().endsWith('.py'))
  return hasScript ? userArgs : [adapterPath, ...userArgs]
}
