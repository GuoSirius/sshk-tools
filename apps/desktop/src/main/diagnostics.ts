import { platform, arch, release, totalmem } from 'node:os'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, screen } from 'electron'
import { zipSync, type Zippable } from 'fflate'
import { listOutputFiles } from '@sshk/repository'
import { getEnvHas } from '@sshk/shared'
import {
  TOOL_IDS,
  format,
  normalizeUploadConfig,
  now,
  type DiagnosisData,
  type ToolCatalogPayload,
  type ToolPluginStatus,
} from '@sshk/shared'
import type { AppServices } from './services'
import { logger } from './logger'

/**
 * N1 一键诊断报告（plans/04）：把「截图 + 终端输出」产品化。
 * 采集 7 类信息：版本 / 平台 / env 变量名 / 密钥布尔 / 工具快照 / 产物占用 / 近 3 天日志。
 * 脱敏红线与 H3 一致：env 只列名与是否已设置，密钥只出布尔，绝不采集任何明文。
 */

const LOG_RECENT_DAYS = 3
const ENV_PREFIX_RE = /^(SSHK_|NODE_|ELECTRON_|GH_TOKEN|WIN_CSC|APPLE_)/

/** 读取单个日志文件的 warn/error 行数与最近 error 行（行内已在落盘时脱敏） */
function scanLogFile(file: string): { warn: number; error: number; errors: string[] } {
  let warn = 0
  let error = 0
  const errors: string[] = []
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.includes('[WARN ]')) warn++
      if (line.includes('[ERROR]')) {
        error++
        if (errors.length < 20) errors.push(line.slice(0, 400))
      }
    }
  } catch { /* 忽略单个文件读取失败 */ }
  return { warn, error, errors }
}

/** 工具快照直接复用目录裁决结果（buildCatalog 的 payload 已含可见性/插件/依赖/告警） */
function buildToolRows(catalog: ToolCatalogPayload, pluginStatus: Record<string, ToolPluginStatus>): DiagnosisData['tools'] {
  return catalog.tools.map((tool) => {
    const plugin = pluginStatus[tool.id]
    return {
      id: tool.id,
      name: tool.name,
      enabled: tool.enabled,
      visible: tool.visible,
      visibility: tool.visibility,
      grant: tool.requiredGrant ?? '',
      plugin: !plugin
        ? (tool.pluginError ? `失败：${tool.pluginError}` : '无主进程插件')
        : (plugin.loaded ? '已加载' : `失败：${plugin.error ?? '未知原因'}`),
      dependsOn: [...tool.dependsOn],
      warnings: [...tool.warnings],
    }
  })
}

/** 主入口：采集诊断数据（各段独立容错，保证整体可用；永不包含敏感明文） */
export function collectDiagnostics(
  services: AppServices,
  pluginStatus: Record<string, ToolPluginStatus>,
  catalog: ToolCatalogPayload,
): DiagnosisData {
  const cfg = services.config

  // ── env：只列变量名与是否已设置（SSHK_/NODE_/ELECTRON_/签名/发布相关前缀）──
  const env = Object.keys(process.env)
    .filter((name) => ENV_PREFIX_RE.test(name))
    .sort()
    .map((name) => ({ name, set: Boolean(process.env[name]?.trim()) }))

  // ── 密钥布尔：访问密钥 / 开发者口令 / Provider 密钥 / 上传 Profile 密钥 ──
  let providers: DiagnosisData['secrets']['providers'] = []
  try {
    providers = services.host.listProviders().map((p) => ({ id: p._id, name: p.name, hasApiKey: p.hasApiKey }))
  } catch { /* 保持空 */ }
  let uploads: DiagnosisData['secrets']['uploads'] = []
  try {
    const uploadCfg = normalizeUploadConfig(cfg.get('app.upload'))
    uploads = [...uploadCfg.remote.profiles, ...uploadCfg.cloud.profiles].map((p) => ({
      id: p.id,
      name: p.name,
      hasSecret: Boolean(services.host.getToolSecret(TOOL_IDS.fileManager, p.id)),
    }))
  } catch { /* 保持空 */ }
  const secrets = {
    accessKey: cfg.get('app.accessKeyHash') != null,
    devtoolsKey: cfg.get('app.devtoolsKeyHash') != null || getEnvHas('SSHK_APP_DEVTOOLS_KEY'),
    providers,
    uploads,
  }

  // ── 产物目录占用 ──
  let outputs: DiagnosisData['outputs'] = { root: services.outputRoot, files: 0, totalMB: '0.0', largest: [] }
  try {
    const stats = listOutputFiles(services.outputRoot)
    const total = stats.reduce((acc, s) => acc + s.size, 0)
    outputs = {
      root: services.outputRoot,
      files: stats.length,
      totalMB: (total / 1024 / 1024).toFixed(1),
      largest: [...stats]
        .sort((a, b) => b.size - a.size)
        .slice(0, 20)
        .map((s) => ({ rel: s.rel, kb: Math.round(s.size / 1024) })),
    }
  } catch { /* 保持默认 */ }

  // ── 近 3 天日志 ──
  const logs: DiagnosisData['logs'] = { dir: logger.logDir(), files: [], recentErrors: [] }
  try {
    const dir = logger.logDir()
    const cutoffName = `sshk-${format(new Date(Date.now() - LOG_RECENT_DAYS * 86_400_000), 'YYYY-MM-DD')}.log`
    for (const name of readdirSync(dir).filter((n) => /^sshk-\d{4}-\d{2}-\d{2}\.log$/.test(n) && n >= cutoffName).sort()) {
      const scan = scanLogFile(join(dir, name))
      logs.files.push({ name, sizeKB: Math.round(statSync(join(dir, name)).size / 1024), warn: scan.warn, error: scan.error })
      logs.recentErrors.push(...scan.errors)
    }
    logs.recentErrors = logs.recentErrors.slice(-20)
  } catch { /* 日志目录不存在时保持空 */ }

  return {
    generatedAt: now(),
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron ?? '',
      node: process.versions.node ?? '',
      locale: app.getLocale?.() ?? '',
    },
    platform: {
      os: platform(),
      arch: arch(),
      release: release(),
      memoryGB: (totalmem() / 1024 ** 3).toFixed(1),
      displays: screen.getAllDisplays().map((d) => ({ w: d.size.width, h: d.size.height, scale: d.scaleFactor })),
    },
    env,
    secrets,
    tools: buildToolRows(catalog, pluginStatus),
    outputs,
    logs,
  }
}

/** report.md 生成：结构化数据 → 人类可读 Markdown（发给开发者的报障附件） */
export function buildReportMd(d: DiagnosisData): string {
  const lines: string[] = []
  lines.push('# sshk-tools 诊断报告')
  lines.push('')
  lines.push(`- 生成时间：${d.generatedAt}`)
  lines.push(`- 应用版本：v${d.app.version}（${d.app.packaged ? 'packaged' : 'dev'}）· Electron ${d.app.electron} / Node ${d.app.node}`)
  lines.push(`- 平台：${d.platform.os} ${d.platform.release}（${d.platform.arch}）· 内存 ${d.platform.memoryGB} GB`)
  lines.push(`- 显示器：${d.platform.displays.map((s) => `${s.w}x${s.h}@${s.scale}x`).join('、') || '未知'}`)
  lines.push('')

  lines.push('## 环境变量（只列名，值永不采集）')
  lines.push('')
  if (d.env.length) {
    lines.push('| 变量名 | 已设置 |', '')
    lines.push('|---|---|')
    for (const e of d.env) lines.push(`| ${e.name} | ${e.set ? '✓' : '—'} |`)
  } else {
    lines.push('（无相关变量）')
  }
  lines.push('')

  lines.push('## 密钥配置状态（布尔，不含内容）')
  lines.push('')
  lines.push(`- 应用访问密钥：${d.secrets.accessKey ? '已配置' : '未配置'}`)
  lines.push(`- 开发者工具口令：${d.secrets.devtoolsKey ? '已配置' : '未配置'}`)
  if (d.secrets.providers.length) {
    lines.push(`- 模型 Provider 密钥：${d.secrets.providers.map((p) => `${p.name}(${p.hasApiKey ? '✓' : '未配置'})`).join('、')}`)
  }
  if (d.secrets.uploads.length) {
    lines.push(`- 上传 Profile 密钥：${d.secrets.uploads.map((p) => `${p.name}(${p.hasSecret ? '✓' : '未配置'})`).join('、')}`)
  }
  lines.push('')

  lines.push(`## 工具快照（${d.tools.length} 个）`)
  lines.push('')
  lines.push('| 工具 | 启用 | 可见 | 插件 | 权限 | 硬依赖 |')
  lines.push('|---|---|---|---|---|---|')
  for (const t of d.tools) {
    lines.push(`| ${t.name}（${t.id}） | ${t.enabled ? '✓' : '✗'} | ${t.visible ? '✓' : '✗'} (${t.visibility}) | ${t.plugin} | ${t.grant || '公开'} | ${t.dependsOn.join('、') || '—'} |`)
  }
  const warned = d.tools.filter((t) => t.warnings.length > 0)
  if (warned.length) {
    lines.push('')
    for (const t of warned) for (const w of t.warnings) lines.push(`- ⚠ ${t.id}：${w}`)
  }
  lines.push('')

  lines.push(`## 产物目录占用（${d.outputs.files} 个文件 · ${d.outputs.totalMB} MB）`)
  lines.push('')
  lines.push(`- 根目录：${d.outputs.root}`)
  if (d.outputs.largest.length) {
    lines.push('- 最大 20 个文件：')
    for (const f of d.outputs.largest) lines.push(`  - ${f.rel}（${f.kb} KB）`)
  }
  lines.push('')

  lines.push(`## 最近 ${LOG_RECENT_DAYS} 天日志（完整文件见 zip 内 logs/）`)
  lines.push('')
  lines.push(`- 目录：${d.logs.dir}`)
  for (const f of d.logs.files) lines.push(`  - ${f.name}：${f.sizeKB} KB · warn ${f.warn} · error ${f.error}`)
  if (d.logs.recentErrors.length) {
    lines.push('')
    lines.push('### 最近 error 摘录（已脱敏）')
    lines.push('```')
    for (const e of d.logs.recentErrors) lines.push(e)
    lines.push('```')
  }
  lines.push('')
  return lines.join('\n')
}

/** 产出 zip：report.md + 近 3 天完整日志；路径必须来自用户保存对话框 */
export function exportDiagnosisZip(d: DiagnosisData, outZipPath: string): { file: string; logs: number } {
  const target = String(outZipPath ?? '')
  if (!/\.zip$/i.test(target)) throw new Error('保存路径必须是 .zip')
  const entries: Zippable = {
    'report.md': new TextEncoder().encode(buildReportMd(d)),
  }
  let logCount = 0
  try {
    const dir = logger.logDir()
    const cutoffName = `sshk-${format(new Date(Date.now() - LOG_RECENT_DAYS * 86_400_000), 'YYYY-MM-DD')}.log`
    for (const name of readdirSync(dir)) {
      if (!/^sshk-\d{4}-\d{2}-\d{2}\.log$/.test(name) || name < cutoffName) continue
      entries[`logs/${name}`] = new Uint8Array(readFileSync(join(dir, name)))
      logCount++
    }
  } catch { /* 日志缺失不阻断报告 */ }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, zipSync(entries, { level: 6 }))
  logger.info('diagnostics', `诊断报告已导出：${target}（日志 ${logCount} 个）`)
  return { file: target, logs: logCount }
}
