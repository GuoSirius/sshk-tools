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
 * 版本实体 ID 解析（口径唯一来源，与 edm-seed 生成规则同步维护；mail.ts 目录推导共用本函数）。
 * system = frgv|tplv _ sys _ <brand> _ <fam…> _ <dir>；custom = cus _ frgv|tplv _ <brand> _ <fam…> _ <dir>。
 * dir 段 = 实体 label（缺省 'default'）；族名可含下划线，故按 label 后缀剥离而非段数切分。
 * 解析失败（结构不符 / 前缀与 kind 不匹配）返回 null，调用侧回退播种快照并告警。
 */
export function parseVersionEntityId(
  id: string,
  kind: 'fragment' | 'template',
  origin: string | undefined,
  label: string | undefined,
): { brandCode: string; familyCode: string; versionDirName: string } | null {
  const dirName = label || 'default'
  const suffix = `_${dirName}`
  // 至少 prefix/sys/brand/fam 四段才认定尾部是 dir，防「族名=default 的短 ID」被误剥
  const hasDir = id.endsWith(suffix) && id.split('_').length >= 5
  const parts = (hasDir ? id.slice(0, -suffix.length) : id).split('_')
  const expect = kind === 'fragment' ? 'frgv' : 'tplv'
  let brandCode: string | undefined
  if (origin === 'custom') {
    if (parts[0] === 'cus' && parts[1] === expect) brandCode = parts[2]
  } else {
    if (parts[0] === expect && parts[1] === 'sys') brandCode = parts[2]
  }
  const familyCode = parts.slice(3).join('_')
  if (!brandCode || !familyCode) return null
  return { brandCode, familyCode, versionDirName: hasDir ? dirName : '' }
}

/**
 * 从 repo 版本实体 ID 反查四级 meta（权限/品牌校验已在调用侧完成）。
 * 与 mail.ts resolveEntitiesCss 共用 parseVersionEntityId，缺失一律 graceful 降级为空 meta。
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
  const parsed = parseVersionEntityId(id, kind, origin, label)
  if (!parsed) return {}
  const versionDir = path.join(sourceRoot, parsed.brandCode, kind, parsed.familyCode, parsed.versionDirName)
  return resolveRenderMeta({ sourceRoot, brandCode: parsed.brandCode, kind, familyCode: parsed.familyCode, versionDir })
}
