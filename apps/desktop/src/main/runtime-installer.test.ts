import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, type Zippable } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { installPackage, listInstalled, loadRuntimeManifests, uninstallPackage, verifySignature } from './runtime-installer'

const tmpDirs: string[] = []
function makeDeps() {
  const dir = mkdtempSync(join(tmpdir(), 'rt-installer-'))
  tmpDirs.push(dir)
  return { userDataDir: dir, importedKeys: [] }
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const MANIFEST = {
  id: 'third-party',
  name: '第三方工具',
  description: '外部开发者提供',
  category: '扩展',
  icon: 'auto',
  entryRoute: 'home',
  enabled: true,
  visibility: 'managed',
  menus: [{ id: 'home', label: '首页' }],
  plugin: { source: 'external', renderer: 'src/renderer/Page.vue' },
  package: {
    schemaVersion: 1,
    version: '1.0.0',
    requiresHost: { api: '^1.0', capabilities: [] },
    sandbox: 'utility',
    ipcAllowlist: ['llm:providers'],
  },
}

function makeZip(manifest: object, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'rt-pkg-'))
  const zip: Zippable = {
    'tool.manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)),
    'src/renderer/Page.vue': Buffer.from('<template><p>hi</p></template>'),
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])),
  }
  const zipPath = join(dir, 'tool.sshktool')
  const zipped = zipSync(zip)
  writeFileSync(zipPath, zipped)
  return zipPath
}

describe('运行时工具包安装器（#35 阶段二）', () => {
  it('合法 utility 包：安装 → 登记 → 清单可读 → 卸载目录消失', () => {
    const deps = makeDeps()
    const result = installPackage(makeZip(MANIFEST), deps)
    expect(result.record).toMatchObject({ id: 'third-party', version: '1.0.0', trustLevel: 'unsigned', sandbox: 'utility' })
    expect(result.warnings.some((w) => w.includes('未签名包'))).toBe(true)
    expect(listInstalled(deps)).toHaveLength(1)

    const loaded = loadRuntimeManifests(deps)
    expect(loaded.problems).toHaveLength(0)
    expect(loaded.manifests[0]?.id).toBe('third-party')

    expect(uninstallPackage('third-party', deps)).toBe(true)
    expect(listInstalled(deps)).toHaveLength(0)
    expect(loadRuntimeManifests(deps).manifests).toHaveLength(0)
  })

  it('重复安装（升级）：哈希变化给出警告并覆盖，不留旧目录', () => {
    const deps = makeDeps()
    installPackage(makeZip(MANIFEST), deps)
    const upgraded = { ...MANIFEST, package: { ...MANIFEST.package, version: '1.1.0' } }
    const result = installPackage(makeZip(upgraded), deps)
    expect(result.record.version).toBe('1.1.0')
    expect(result.warnings.some((w) => w.includes('升级覆盖'))).toBe(true)
    expect(listInstalled(deps)).toHaveLength(1)
  })

  it('L0：Zip Slip 条目直接拒绝', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-evil-'))
    const zipPath = join(dir, 'evil.sshktool')
    writeFileSync(zipPath, Buffer.from(zipSync({
      'tool.manifest.json': Buffer.from(JSON.stringify(MANIFEST)),
      '../evil.txt': Buffer.from('x'),
    })))
    expect(() => installPackage(zipPath, makeDeps())).toThrow('穿越')
  })

  it('L0/契约：schemaVersion 不匹配拒绝安装', () => {
    const bad = { ...MANIFEST, package: { ...MANIFEST.package, schemaVersion: 99 } }
    expect(() => installPackage(makeZip(bad), makeDeps())).toThrow('schemaVersion')
  })

  it('main 权限必须带签名，未签名申请 main 直接拒绝', () => {
    const bad = { ...MANIFEST, package: { ...MANIFEST.package, sandbox: 'main' } }
    expect(() => installPackage(makeZip(bad), makeDeps())).toThrow('申请 main 权限必须带签名')
  })

  it('Ed25519 验签：正确签名通过、篡改内容失败', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    publicKey.export({ type: 'spki', format: 'pem' })
    const manifestRaw = JSON.stringify(MANIFEST, null, 2)
    const files = [
      { name: 'src/renderer/Page.vue', sha256: createHash('sha256').update('<template><p>hi</p></template>').digest('hex') },
    ]
    const payload = [manifestRaw, ...files.map((f) => `${f.name}:${f.sha256}`)].join('\n')
    const sig = cryptoSign(null, Buffer.from(payload), privateKey)
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const good = verifySignature({
      manifestRaw, files,
      signature: { keyId: 'test-key', algorithm: 'ed25519', value: sig.toString('base64') },
      officialKeys: [], importedKeys: [{ keyId: 'test-key', pem, label: '测试', importedAt: 'x' }],
    })
    expect(good.valid).toBe(true)
    const tampered = verifySignature({
      manifestRaw: manifestRaw.replace('第三方工具', '篡改过的工具'),
      files,
      signature: { keyId: 'test-key', algorithm: 'ed25519', value: sig.toString('base64') },
      officialKeys: [], importedKeys: [{ keyId: 'test-key', pem, label: '测试', importedAt: 'x' }],
    })
    expect(tampered.valid).toBe(false)
    expect(tampered.reason).toContain('签名与内容不匹配')
  })

  it('loadRuntimeManifests：清单被手动删除时给出问题而非崩溃', () => {
    const deps = makeDeps()
    installPackage(makeZip(MANIFEST), deps)
    // 从 installed.json 反推目录并删除清单，模拟外部破坏
    const record = listInstalled(deps)[0]!
    rmSync(join(deps.userDataDir, 'runtime-tools', 'packages', record.id, record.version, 'tool.manifest.json'))
    const loaded = loadRuntimeManifests(deps)
    expect(loaded.manifests).toHaveLength(0)
    expect(String(loaded.problems[0])).toContain('third-party')
  })
})
