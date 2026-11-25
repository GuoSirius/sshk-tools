/**
 * 渲染元数据反查（2026-11-25 修订 1/13）：
 * favicon 等四级 meta 的真相源是磁盘 meta.yaml（repo 实体无此字段），
 * 渲染 IPC 按版本目录反查四级 meta，作为入参传进 core 渲染层（render.ts / compose.ts）。
 * 读取一律 graceful 降级：缺 meta.yaml / 非法 YAML 不阻断渲染，回落空对象由 buildRenderMeta 兜底。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as yaml from 'js-yaml'
import type { RenderMeta, RenderMetaLevel } from '../core/render-meta.js'

export interface MetaResolvePoint {
  /** 内容来源根（系统 assets/edm 或自定义 userData/custom-edm） */
  sourceRoot: string
  brandCode: string
  /** 'fragment' | 'template' */
  kind: string
  familyCode: string
  /** 版本目录绝对路径（单版本折叠时 = 族目录） */
  versionDir: string
}

async function readMetaLevel(file: string): Promise<RenderMetaLevel | undefined> {
  try {
    const raw = yaml.load(await fs.readFile(file, 'utf8')) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return undefined
    const code = typeof raw['code'] === 'string' ? raw['code'] : ''
    const name = typeof raw['name'] === 'string' ? raw['name'] : ''
    const favicon = typeof raw['favicon'] === 'string' ? raw['favicon'] : undefined
    return { code, name, ...(favicon ? { favicon } : {}) }
  } catch {
    return undefined
  }
}

/** 按版本目录反查四级 meta（品牌 / 类型 / 族 / 版本）；缺失层级省略，交给 buildRenderMeta 兜底 */
export async function resolveRenderMeta(p: MetaResolvePoint): Promise<RenderMeta> {
  const brandDir = path.join(p.sourceRoot, p.brandCode)
  const catDir = path.join(brandDir, p.kind)
  const familyDir = path.join(catDir, p.familyCode)
  const [brand, type, family, version] = await Promise.all([
    readMetaLevel(path.join(brandDir, 'meta.yaml')),
    readMetaLevel(path.join(catDir, 'meta.yaml')),
    readMetaLevel(path.join(familyDir, 'meta.yaml')),
    readMetaLevel(path.join(p.versionDir, 'meta.yaml')),
  ])
  return {
    ...(brand ? { brand } : {}),
    ...(type ? { type } : {}),
    ...(family ? { family } : {}),
    ...(version ? { version } : {}),
  }
}

/**
 * 从 repo 版本实体 ID 反查四级 meta（权限/品牌校验已在调用侧完成）。
 * ID 口径（edm-seed）：system=tplv|frgv_sys_<brand>_<fam>_<dir>；custom=cus_tplv|frgv_<brand>_<fam>_<dir>。
 * 与 mail.ts resolveEntitiesCss 的目录推导保持同一份规则，缺失一律 graceful 降级为空 meta。
 */
export async function resolveMetaByVersionId(
  id: string,
  kind: 'fragment' | 'template',
  origin: string | undefined,
  label: string | undefined,
  resolveContentRoot: (source: string) => string,
): Promise<RenderMeta> {
  const isCustom = origin === 'custom'
  const sourceRoot = resolveContentRoot(isCustom ? 'custom' : 'system')
  const prefix = kind === 'fragment' ? (isCustom ? 'frgv' : 'frg') : (isCustom ? 'tplv' : 'tpl')
  const parts = id.split('_')
  const pos = parts.indexOf(prefix)
  const start = pos >= 0 ? pos + (isCustom ? 1 : 2) : -1
  const brandCode = start >= 0 ? (parts[start] ?? '') : ''
  const familyCode = start >= 0 ? parts.slice(start + 1).join('_') : ''
  if (!brandCode || !familyCode) return {}
  const versionDir = path.join(sourceRoot, brandCode, kind, familyCode, label || 'default')
  return resolveRenderMeta({ sourceRoot, brandCode, kind, familyCode, versionDir })
}
