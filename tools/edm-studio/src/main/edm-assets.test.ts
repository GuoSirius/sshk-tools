/**
 * 迁移资产不变量测试（plans/14）：系统内容库所有版本
 * ① 可渲染（sample 严格填充，无未定义字段 / 无 njk 残留）；
 * ② 显式 link 在预览侧被剥离并注入 <style>；
 * ③ 仅 richtext 字段允许 `| safe`（slot_* 例外）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import nunjucks from 'nunjucks'
import { loadEdmModel } from './edm-manifest'
import { renderSystemCompose, renderSystemPreview, type SystemSelector } from '../core/system-css'

const EDM_ROOT = fileURLToPath(new URL('../../assets/edm', import.meta.url))
const OUTPUT = mkdtempSync(path.join(tmpdir(), 'sshk-edm-assets-'))
afterAll(() => rmSync(OUTPUT, { recursive: true, force: true }))

describe('系统 EDM 资产迁移不变量', () => {
  it('所有版本：显式 link 生效、njk 全字段可渲染、safe 仅用于 richtext', async () => {
    const model = await loadEdmModel(EDM_ROOT)
    const env = new nunjucks.Environment(null, { autoescape: true, throwOnUndefined: true })
    const versions: Array<{ sel: SystemSelector; html: string; sample: Record<string, unknown>; fields: unknown[]; dir: string }> = []
    for (const brand of model.brands) {
      for (const [kind, families] of [['fragment', brand.fragments], ['template', brand.templates]] as const) {
        for (const fam of families) {
          for (const v of fam.versions) {
            versions.push({
              sel: { brandCode: brand.code, kind, familyCode: fam.code, versionDir: v.dir },
              html: readFileSync(v.sourcePath, 'utf8'),
              sample: (v.sample ?? {}) as Record<string, unknown>,
              fields: (v.meta as unknown as { fields?: unknown[] }).fields ?? [],
              dir: v.dir,
            })
          }
        }
      }
    }
    expect(versions.length).toBeGreaterThanOrEqual(10)

    for (const v of versions) {
      // njk 严格渲染：sample 必须覆盖模板用到的全部字段（slot_* 由组合引擎注入，单版本预览 tolerated）
      if (v.sel.kind === 'fragment') {
        expect(() => env.renderString(v.html, v.sample)).not.toThrow()
      }
      const preview = await renderSystemPreview(EDM_ROOT, v.sel, { outputRoot: OUTPUT })
      // #188 纪律针对 css link（须剥离内联）；favicon 等 head link 是合法功能标签，不在剥离范围
      expect(preview.html).not.toContain('<link rel="stylesheet"')
      expect(preview.html).not.toContain('{{')
      expect(preview.html).toContain('<style>')

      if (v.dir !== 'default') continue // v1 为旧演示资产，不纳入迁移纪律校验
      // 框架自动注入仅 normalize.css + uno；reset.css（基础样式层）等一切 css 必须显式 link
      expect(v.html).toMatch(/<link rel="stylesheet" href="@system\/css\/reset\.css"\s*\/?\s*>/)
      expect(preview.html).toContain('mso-table-lspace') // reset.css 经显式 link 解析后确实内联
      type FieldLike = { key?: string; type?: string; itemFields?: FieldLike[] }
      const fields = v.fields as FieldLike[]
      const declared = new Set(fields.filter((f) => f.type === 'richtext').map((f) => f.key))
      const loopFields = new Map<string, string>()
      for (const m of v.html.matchAll(/\{%\s*for\s+(it\d+)\s+in\s+(\w+)\s*%\}/g)) {
        if (m[1] && m[2]) loopFields.set(m[1], m[2])
      }
      for (const m of v.html.matchAll(/\{\{\s*([a-zA-Z_][\w]*)\s*\|\s*safe\s*\}\}/g)) {
        const key = m[1] ?? ''
        if (key.startsWith('slot_')) continue
        if (/^it\d+$/.test(key)) {
          const fk = loopFields.get(key)
          const item = fields.find((f) => f.key === fk)?.itemFields?.some((i) => i.type === 'richtext')
          expect(item, `${v.sel.brandCode}/${v.sel.familyCode}: ${fk} 的列表项未声明为 richtext`).toBe(true)
          continue
        }
        expect(declared.has(key), `${v.sel.brandCode}/${v.sel.familyCode}: ${key} 未声明为 richtext`).toBe(true)
      }
    }
  })

  it('双品牌组合预览：header + banner + literature + footer 可拼成完整邮件', async () => {
    const model = await loadEdmModel(EDM_ROOT)
    for (const brand of model.brands) {
      expect(brand.fragments.length).toBeGreaterThanOrEqual(26) // 4~7 基础/series + 22 母版模式族
      const sel = (kind: string, familyCode: string): SystemSelector => ({ brandCode: brand.code, kind, familyCode, versionDir: 'default' })
      const composed = await renderSystemCompose(EDM_ROOT, sel('template', 'standard'), [
        { selector: sel('fragment', 'header'), slot: 'header' },
        { selector: sel('fragment', 'banner'), slot: 'body', order: 1 },
        { selector: sel('fragment', 'literature'), slot: 'body', order: 2 },
        { selector: sel('fragment', 'footer'), slot: 'footer' },
      ], { outputRoot: OUTPUT })
      expect(composed.html).not.toContain('<link rel="stylesheet"')
      expect(composed.html).not.toContain('{{')
      expect(composed.html).toContain(brand.code === 'elabscience' ? 'Elabscience' : 'Procell')
      expect(composed.html).toContain('Connect with us')
      expect(composed.html).toContain('<style>')
    }
  })
})
