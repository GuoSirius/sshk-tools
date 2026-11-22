import { existsSync, readFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { safeStorage } from 'electron'
import { AppError } from '@sshk/shared'
import { logger } from './logger'

/**
 * 密钥库单一实现（A2/Q-02 · P1-2）：secrets.bin（safeStorage）读写唯一收口。
 *
 * 此前 services.ts 的 loadSecrets/saveSecrets 有三个竞态：
 * ① 所有写入口 fire-and-forget 并发 saveSecrets —— 整文件 last-write-wins 互相覆盖；
 * ② 启动窗口 secretsCache===null 时 currentSecrets() 返回临时空对象，此时写入会被
 *    loadSecrets 完成后的 cache 整体覆盖 → 丢密钥；
 * ③ read-modify-write 无互斥。
 *
 * 本类收口：
 * - 写队列串行（Promise 链），任何时刻只有一个加密落盘在途；
 * - 写前强制 await load()（幂等共享同一 Promise），消灭启动窗口竞态；
 * - mutate 收到的是快照拷贝，mutate 完成 → 加密 → 写盘成功 → 才 commit cache（失败不改内存）；
 * - 失败 onError 落盘日志并向上抛（IPC 路径经 handleOk 变 toast，渲染层可见）。
 */
export class SecretsStore {
  private cache: Record<string, string> | null = null
  private loadPromise: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly onError: (msg: string) => void = () => { /* 默认静默 */ },
  ) {}

  /** 启动预载（幂等；并发调用共享同一次解密） */
  load(): Promise<void> {
    if (this.cache) return Promise.resolve()
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.doLoad()
    return this.loadPromise
  }

  private async doLoad(): Promise<void> {
    if (!existsSync(this.file)) { this.cache = {}; return }
    try {
      const raw = readFileSync(this.file)
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        // 静默丢密钥会表现为「重启后配置失效」，必须把原因留在日志里
        logger.warn('secrets', 'safeStorage 不可用，本次无法解密 secrets.bin（密钥仍在磁盘）')
        this.cache = {}
        return
      }
      // Electron 的 decryptStringAsync 解析为 { result, shouldReEncrypt } 对象（非 string/Buffer），
      // 误用 plain.toString() 会得到 "[object Object]" 导致 JSON 解析失败。
      const decrypted = await safeStorage.decryptStringAsync(raw)
      const plain = typeof decrypted === 'string' ? decrypted : (decrypted as { result: string }).result
      this.cache = JSON.parse(plain) as Record<string, string>
      // 密钥已轮换：用当前密钥重新加密落盘，避免下次启动仍需重填。
      // 重加密失败不影响本次会话（cache 已就绪），只留告警
      if ((decrypted as { shouldReEncrypt?: boolean })?.shouldReEncrypt) {
        try {
          await this.writeSnapshot({ ...(this.cache ?? {}) })
        } catch (err) {
          logger.warn('secrets', `密钥轮换重加密失败（下次启动仍需重填）：${(err as Error).message}`)
        }
      }
    } catch (err) {
      // F-05（2026-11-22 复核）：半截文件/解密失败都表现为「重启后密钥全空」，必须 error 级留痕
      logger.error('secrets', `secrets.bin 读取/解密失败（文件可能损坏或密钥环境变化，需重填密钥）：${(err as Error).message}`)
      this.cache = {}
    }
  }

  /** 同步读缓存（启动预载后恒可用）；写路径必须走 set */
  snapshot(): Record<string, string> { return this.cache ?? {} }

  /**
   * 写入口（串行队列）：mutate 收到快照拷贝；加密落盘成功才 commit。
   * reject 时队列继续可用（onError 已落盘日志）。
   */
  set(mutate: (secrets: Record<string, string>) => void): Promise<void> {
    const run = this.queue.then(async () => {
      await this.load()
      const next = { ...(this.cache ?? {}) }
      mutate(next)
      await this.writeSnapshot(next)
      this.cache = next
    })
    // 队列链吞掉单次失败（保证后续写不被毒化），但本次 run 照常 reject 给调用方
    this.queue = run.catch((err) => { this.onError((err as Error).message) })
    return run
  }

  private async writeSnapshot(secrets: Record<string, string>): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new AppError('当前系统不支持凭据加密（safeStorage 不可用），无法保存密钥')
    }
    // encryptString 已弃用（Electron 45+ 警告）：encryptStringAsync + 异步写盘
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(secrets))
    // F-05（2026-11-22 复核）：tmp+rename 原子写（与 FsTransferStore.save 同口径）——此前直接
    // 覆写，落盘中途崩溃/断电留下半截文件，下次启动 JSON.parse 失败 → 全部密钥静默丢失
    const tmp = `${this.file}.tmp`
    try {
      await writeFile(tmp, encrypted)
      await rename(tmp, this.file)
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => { /* 清理失败忽略，主错误向上抛 */ })
      throw err
    }
  }
}
