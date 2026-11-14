/**
 * 开发者工具（仅源码开发环境可用）：工具清单编辑、构建、导出分发包、门禁校验。
 *
 * 安全约束：
 *  - 只有能定位到「含 pnpm-workspace.yaml + tools/ 的仓库根目录」时才启用；打包版自动禁用
 *  - 所有工具 id 走 ID_RE 校验，路径由 join(root, 'tools'|'examples', id) 生成，杜绝路径穿越
 *  - 外部命令均为固定字符串 + 数组参数，不把用户输入拼进 shell
 *  - manifest 写回前做最小契约校验，并用 tmp + rename 原子落盘
 */
import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IPC_CHANNELS } from '@sshk/shared'

const ID_RE = /^[a-z][a-z0-9-]{1,63}$/
const OUTPUT_LIMIT = 12000

export interface DevState {
  available: boolean
  repoRoot: string | null
  reason: string
}

export interface DevCommandResult {
  ok: boolean
  output: string
}

function findRepoRoot(): string | null {
  for (const start of [app.getAppPath(), process.cwd()]) {
    let dir = start
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(join(dir, 'tools'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

function run(cmd: string, args: string[], cwd: string): Promise<DevCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', windowsHide: true })
    let output = ''
    const append = (buf: Buffer): void => {
      output += buf.toString()
      if (output.length > OUTPUT_LIMIT * 2) output = output.slice(-OUTPUT_LIMIT)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (err) => resolve({ ok: false, output: `${output}\n${err.message}` }))
    child.on('close', (code) => resolve({ ok: code === 0, output: output.slice(-OUTPUT_LIMIT) }))
  })
}

function assertId(raw: unknown): string {
  const value = String(raw ?? '')
  if (!ID_RE.test(value)) throw new Error(`工具 id 非法：${value}`)
  return value
}

function manifestPath(root: string, id: string): string {
  for (const base of ['tools', 'examples']) {
    const file = join(root, base, id, 'tool.manifest.json')
    if (existsSync(file)) return file
  }
  throw new Error(`未找到工具 ${id} 的 tool.manifest.json（期望 tools/${id}/ 或 examples/${id}/）`)
}

/** 写回前的最小契约校验：id 必须等于目录名、必填字段齐全 */
function validateManifest(raw: string, id: string): string {
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new Error(`manifest 不是合法 JSON：${(err as Error).message}`)
  }
  if (obj.id !== id) throw new Error(`manifest.id 必须等于目录名 ${id}（当前 ${String(obj.id)}）`)
  for (const key of ['name', 'description']) {
    if (typeof obj[key] !== 'string' || !(obj[key] as string).trim()) throw new Error(`${key} 不能为空`)
  }
  if (!Array.isArray(obj.menus) || obj.menus.length === 0) throw new Error('menus 至少需要一项')
  return JSON.stringify(obj, null, 2) + '\n'
}

export function registerDevTools(onManifestSaved?: (file: string) => unknown): DevState {
  const root = findRepoRoot()
  const state: DevState = root
    ? { available: true, repoRoot: root, reason: '' }
    : { available: false, repoRoot: null, reason: '当前为打包版或未找到源码仓库，开发者工具不可用' }

  const guard = (): string => {
    if (!root) throw new Error(state.reason)
    return root
  }

  ipcMain.handle(IPC_CHANNELS.devState, () => state)

  ipcMain.handle(IPC_CHANNELS.devManifestGet, (_event, rawId: unknown) => {
    const repo = guard()
    return readFileSync(manifestPath(repo, assertId(rawId)), 'utf8')
  })

  ipcMain.handle(IPC_CHANNELS.devManifestSet, (_event, rawId: unknown, raw: unknown) => {
    const repo = guard()
    const id = assertId(rawId)
    const file = manifestPath(repo, id)
    const normalized = validateManifest(String(raw ?? ''), id)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, normalized, 'utf8')
    renameSync(tmp, file)
    // 内建工具（tools/）写盘后原地重载内存清单并重建目录，渲染层拿到新 payload 立即刷新；
    // examples/ 外部源码不参与目录，无需重载
    const catalog = /[/\\]tools[/\\]/.test(file) && onManifestSaved ? onManifestSaved(file) : undefined
    return { ok: true, output: `已写入 ${file}`, catalog }
  })

  ipcMain.handle(IPC_CHANNELS.devVerify, async () => run('pnpm', ['verify'], guard()))
  ipcMain.handle(IPC_CHANNELS.devBuild, async () => run('pnpm', ['build'], guard()))

  ipcMain.handle(IPC_CHANNELS.devBuildExternal, async (_event, rawId: unknown) => {
    const repo = guard()
    return run('node', ['scripts/build-external.mjs', assertId(rawId)], repo)
  })

  ipcMain.handle(IPC_CHANNELS.devPack, async (_event, rawId: unknown, sign: unknown) => {
    const repo = guard()
    const id = assertId(rawId)
    const parts: string[] = []
    if (sign === true) {
      const signed = await run('node', ['scripts/sign-tool.mjs', id], repo)
      parts.push(signed.output)
      if (!signed.ok) return { ok: false, output: parts.join('\n') }
    }
    const packed = await run('node', ['scripts/pack-tool.mjs', id], repo)
    parts.push(packed.output)
    return { ok: packed.ok, output: parts.join('\n') }
  })

  return state
}
