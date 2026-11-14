import { createHash, verify as cryptoVerify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import {
  canLoadInMain,
  now,
  OFFICIAL_PUBLIC_KEYS,
  assertAllowedFiles,
  checkZipSlip,
  validateToolPackage,
  type ImportedPublicKey,
  type InstalledPackageRecord,
  type InstallPreview,
  type ToolDescriptor,
} from '@sshk/shared'

/**
 * 运行时工具包安装器（#35 阶段二核心）：
 * .sshktool（zip）→ 结构校验 → 契约校验 → 整包 SHA-256（TOFU）→ Ed25519 验签
 * → 解压到 runtime-tools/packages/<id>/<version>/ → installed.json 原子登记。
 *
 * 本切片交付「安装 / 列表 / 卸载 / 运行时清单读取」闭环；
 * utilityProcess 沙箱加载与运行时插件动态 import 排阶段三。
 */

export interface RuntimeDeps {
  /** app.getPath('userData')，由宿主传入（模块不直接依赖 electron，便于单测） */
  userDataDir: string
  /** 设置中心导入的第三方公钥 */
  importedKeys?: ImportedPublicKey[]
}

const RUNTIME_DIR = 'runtime-tools'
const PACKAGES_DIR = 'packages'
const INSTALLED = 'installed.json'
const MANIFEST_FILE = 'tool.manifest.json'
/** 包内签名文件名：两行 —— keyId、base64 签名 */
const SIGNATURE_FILE = 'SIGNATURE'

/**
 * 规范 manifest 文本：剔除 package.signature 后重新序列化。
 * 签名值本身写在 manifest 里，若不剔除就构成「签名覆盖签名自身」的循环依赖；
 * 口径与 scripts/lib/tool-package.mjs::canonicalManifestText 严格一致（见 trust.ts 规范）。
 */
function canonicalManifestText(raw: string): string {
  const obj = JSON.parse(raw) as Record<string, unknown>
  const pkg = obj.package as Record<string, unknown> | undefined
  if (pkg) delete pkg.signature
  return JSON.stringify(obj, null, 2) + '\n'
}

export function runtimeRoot(deps: RuntimeDeps): string {
  return join(deps.userDataDir, RUNTIME_DIR)
}
function installedPath(deps: RuntimeDeps): string {
  return join(runtimeRoot(deps), INSTALLED)
}
function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
export function readInstalled(deps: RuntimeDeps): Record<string, InstalledPackageRecord> {
  if (!existsSync(installedPath(deps))) return {}
  try {
    return JSON.parse(readFileSync(installedPath(deps), 'utf8')) as Record<string, InstalledPackageRecord>
  } catch {
    return {}
  }
}
function writeInstalled(deps: RuntimeDeps, records: Record<string, InstalledPackageRecord>): void {
  // 原子写：tmp + rename，避免中断留下半份 installed.json
  const final = installedPath(deps)
  mkdirSync(runtimeRoot(deps), { recursive: true })
  const tmp = `${final}.tmp`
  writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf8')
  renameSync(tmp, final)
}

/**
 * Ed25519 验签（纯函数）。规范签名对象见 packages/shared/src/trust.ts：
 *   payload = 规范 manifest 原文（剔除 package.signature）+ '\n'
 *           + 其余文件（排除 manifest 自身与 SIGNATURE）的 name:sha256 排序清单
 * manifest 由第一行原文整体覆盖，因此不参与哈希清单；否则签名值写回 manifest 会造成循环依赖。
 */
export function verifySignature(input: {
  manifestRaw: string
  files: { name: string; sha256: string }[]
  signature: { keyId: string; algorithm: string; value: string }
  officialKeys: readonly { keyId: string; pem: string }[]
  importedKeys: ImportedPublicKey[]
}): { valid: boolean; trusted: boolean; reason?: string } {
  if (input.signature.algorithm !== 'ed25519') {
    return { valid: false, trusted: false, reason: `签名算法仅支持 ed25519：${input.signature.algorithm}` }
  }
  const allKeys = [
    ...input.officialKeys,
    ...input.importedKeys.map((k) => ({ keyId: k.keyId, pem: k.pem })),
  ]
  const key = allKeys.find((k) => k.keyId === input.signature.keyId)
  if (!key) return { valid: false, trusted: false, reason: `未找到公钥 ${input.signature.keyId}（neither 官方内置 nor 用户导入）` }
  try {
    const covered = new Set([MANIFEST_FILE, SIGNATURE_FILE])
    const listed = input.files
      .filter((f) => !covered.has(f.name))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => `${f.name}:${f.sha256}`)
    const payload = [canonicalManifestText(input.manifestRaw), ...listed].join('\n')
    const valid = cryptoVerify(null, Buffer.from(payload, 'utf8'), key.pem, new Uint8Array(Buffer.from(input.signature.value, 'base64')))
    return { valid, trusted: valid, reason: valid ? undefined : '签名与内容不匹配（包被篡改或签名损坏）' }
  } catch (err) {
    return { valid: false, trusted: false, reason: `验签失败：${(err as Error).message}` }
  }
}

export interface InstallResult {
  record: InstalledPackageRecord
  manifest: ToolDescriptor
  warnings: string[]
}

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0（忽略预发布后缀） */
function versionCompare(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

// InstallPreview 定义在 @sshk/shared/types（分层约束：shared 不可反向依赖 apps/desktop），此处仅转发
export type { InstallPreview }

/**
 * 安装前预览：不写盘，仅做冲突与升降级裁决，供 UI 在写盘前征求用户意见（D-C / D-D）。
 * - builtin-conflict：该 id 已作为内置工具分发，禁止重复安装外部包
 * - downgrade：新版本低于已装版本，需用户显式抉择
 */
export function previewInstall(zipPath: string, deps: RuntimeDeps, opts: { builtinIds?: string[] } = {}): InstallPreview {
  const entries = unzipSync(readFileSync(zipPath))
  const manifestEntry = Object.entries(entries).find(([n, data]) => n === 'tool.manifest.json' && data instanceof Uint8Array)
  if (!manifestEntry) throw new Error('包内缺少 tool.manifest.json')
  const manifest = JSON.parse(Buffer.from(manifestEntry[1] as Uint8Array).toString('utf8')) as ToolDescriptor
  const id = manifest.id
  if (opts.builtinIds?.includes(id)) return { status: 'builtin-conflict', id }
  const installed = readInstalled(deps)[id]
  const newVersion = manifest.package?.version ?? ''
  if (!installed) return { status: 'fresh', id, newVersion }
  const cmp = versionCompare(newVersion, installed.version)
  if (cmp > 0) return { status: 'upgrade', id, newVersion, installedVersion: installed.version }
  if (cmp < 0) return { status: 'downgrade', id, newVersion, installedVersion: installed.version }
  return { status: 'reinstall', id, newVersion, installedVersion: installed.version }
}

/** 安装一个 .sshktool 包；任何一步失败抛错且不留半装状态（先解压到临时目录再原子改名） */
export function installPackage(zipPath: string, deps: RuntimeDeps, opts: { explicitlyTrusted?: boolean; builtinIds?: string[] } = {}): InstallResult {
  const warnings: string[] = []
  const zipBuf = readFileSync(zipPath)
  const packageSha = sha256(zipBuf)
  const entries = unzipSync(zipBuf)
  // fflate 的目录条目值是数组类型，这里只保留文件
  const files = Object.entries(entries)
    .filter(([, data]) => data instanceof Uint8Array)
    .map(([name, data]) => ({ name, data: data as Uint8Array, sha256: sha256(data as Uint8Array) }))

  // L0：结构白名单 + Zip Slip
  const structErrors = assertAllowedFiles(files.map(({ name, data }) => ({ name, size: data.byteLength })))
  for (const name of Object.keys(entries)) {
    const slip = checkZipSlip(name)
    if (slip) structErrors.push(slip)
  }
  if (structErrors.length) throw new Error(`包结构不合规：\n- ${structErrors.slice(0, 8).join('\n- ')}`)

  // manifest + 契约校验
  const manifestEntry = files.find((f) => f.name === MANIFEST_FILE)
  if (!manifestEntry) throw new Error('包内缺少 tool.manifest.json')
  const manifestRaw = Buffer.from(manifestEntry.data).toString('utf8')
  let manifest: ToolDescriptor
  try {
    manifest = JSON.parse(manifestRaw) as ToolDescriptor
  } catch (err) {
    throw new Error(`tool.manifest.json 不是合法 JSON：${(err as Error).message}`)
  }
  const contractErrors = validateToolPackage(manifest)
  if (contractErrors.length) throw new Error(`契约校验失败：\n- ${contractErrors.join('\n- ')}`)
  const pkg = manifest.package!

  // 内建/外部同 id 冲突（D-C）：已作为内置工具随应用分发的，完全禁止重复安装外部同名包
  if (opts.builtinIds?.includes(manifest.id)) {
    throw new Error(`工具「${manifest.id}」已作为内置工具随本应用分发，禁止重复安装同名外部包；如需替换请在「工具与权限」中先禁用内置版本`)
  }

  // L2：签名（可选；main 必须签名——validateToolPackage 已卡）
  let trustLevel: InstalledPackageRecord['trustLevel'] = 'unsigned'
  let effectiveSandbox: 'main' | 'utility' = 'utility'
  const sigEntry = files.find((f) => f.name === SIGNATURE_FILE)
  if (sigEntry && pkg.signature) {
    const [keyId, value] = Buffer.from(sigEntry.data).toString('utf8').trim().split(/\r?\n/)
    const result = verifySignature({
      manifestRaw,
      // 规范签名对象由 verifySignature 统一构造：排除 SIGNATURE 与 manifest 自身
      files: files.filter((f) => f.name !== SIGNATURE_FILE).map(({ name, sha256 }) => ({ name, sha256 })),
      signature: { keyId: keyId ?? pkg.signature.keyId, algorithm: 'ed25519', value: value ?? pkg.signature.value },
      officialKeys: OFFICIAL_PUBLIC_KEYS,
      importedKeys: deps.importedKeys ?? [],
    })
    if (result.valid && result.trusted) {
      trustLevel = OFFICIAL_PUBLIC_KEYS.some((k) => k.keyId === (keyId ?? pkg.signature!.keyId)) ? 'official' : 'user-imported'
      if (canLoadInMain({ signatureValid: true, keyTrusted: true, explicitlyTrusted: Boolean(opts.explicitlyTrusted) })) {
        effectiveSandbox = 'main'
      } else {
        warnings.push('签名有效但缺少用户显式信任，按 utility 沙箱安装')
      }
    } else {
      warnings.push(`签名校验未通过：${result.reason ?? '未知原因'}；按 utility 沙箱安装`)
    }
  } else if (pkg.sandbox === 'main') {
    throw new Error('该包申请 main 权限但包内没有 SIGNATURE 签名文件；未签名包只能以 utility 沙箱安装')
  } else {
    warnings.push('未签名包：以 utility 沙箱安装，能力受限')
  }

  // 解压（临时目录 → 原子改名；升级 = 覆盖旧版本目录）
  const packageDir = join(runtimeRoot(deps), PACKAGES_DIR, manifest.id, pkg.version)
  const staging = `${packageDir}.staging`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const { name, data } of files) {
    if (name === SIGNATURE_FILE) continue
    const target = join(staging, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(data))
  }
  rmSync(packageDir, { recursive: true, force: true })
  mkdirSync(join(packageDir, '..'), { recursive: true })
  renameSync(staging, packageDir)

  const record: InstalledPackageRecord = {
    id: manifest.id,
    version: pkg.version,
    sha256: packageSha,
    trustLevel,
    sandbox: effectiveSandbox,
    installedAt: now(),
    signatureKeyId: pkg.signature?.keyId,
  }
  const records = readInstalled(deps)
  const previous = records[manifest.id]
  if (previous && previous.sha256 !== record.sha256) {
    warnings.push(`检测到与已安装版本（${previous.version}）哈希不同：已按升级覆盖安装，指纹已更新`)
  }
  records[manifest.id] = record
  writeInstalled(deps, records)
  return { record, manifest, warnings }
}

export function listInstalled(deps: RuntimeDeps): InstalledPackageRecord[] {
  return Object.values(readInstalled(deps)).sort((a, b) => a.id.localeCompare(b.id))
}

/** 读取已安装包的渲染层产物（编译后 ESM，默认导出组件）；路径受安装目录约束 */
export function readRenderer(packageId: string, deps: RuntimeDeps): string {
  const record = readInstalled(deps)[packageId]
  if (!record) throw new Error('运行时包 ' + packageId + ' 未安装')
  const manifestPath = join(runtimeRoot(deps), PACKAGES_DIR, record.id, record.version, 'tool.manifest.json')
  if (!existsSync(manifestPath)) throw new Error('运行时包 ' + record.id + ' 清单缺失')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ToolDescriptor
  const rel = manifest.plugin?.renderer
  if (!rel) throw new Error('运行时包 ' + record.id + ' 未声明渲染层')
  const file = join(runtimeRoot(deps), PACKAGES_DIR, record.id, record.version, rel)
  if (!existsSync(file)) throw new Error('渲染层文件缺失：' + rel)
  return readFileSync(file, 'utf8')
}

export function uninstallPackage(id: string, deps: RuntimeDeps): boolean {
  const records = readInstalled(deps)
  const record = records[id]
  if (!record) return false
  rmSync(join(runtimeRoot(deps), PACKAGES_DIR, id), { recursive: true, force: true })
  delete records[id]
  writeInstalled(deps, records)
  return true
}

/** 读取全部已安装包的 manifest（校验通过才返回），供 buildCatalog 合并裁决 */
export function loadRuntimeManifests(deps: RuntimeDeps): { manifests: ToolDescriptor[]; problems: string[] } {
  const problems: string[] = []
  const manifests: ToolDescriptor[] = []
  const records = readInstalled(deps)
  for (const record of Object.values(records)) {
    const manifestPath = join(runtimeRoot(deps), PACKAGES_DIR, record.id, record.version, 'tool.manifest.json')
    if (!existsSync(manifestPath)) {
      problems.push(`${record.id}：清单文件缺失（安装目录被手动改动？）`)
      continue
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ToolDescriptor
      const errors = validateToolPackage(manifest)
      if (errors.length) { problems.push(`${record.id}：${errors[0]}`); continue }
      manifests.push(manifest)
    } catch (err) {
      problems.push(`${record.id}：清单解析失败 ${(err as Error).message}`)
    }
  }
  return { manifests, problems }
}

