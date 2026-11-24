/**
 * 迁移资产邮件兼容不变量（plans/14 批次 6）：
 * ① 源码层禁止 ::before/::after、结构性伪类、hover、absolute/transform/calc、阴影等邮件不兼容写法；
 * ② 渐变只允许 background-image + 同规则 background-color 纯色回落；
 * ③ 关键视觉（标题装饰、斑马纹）必须落到真实元素，而非伪元素/结构选择器。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { loadEdmModel } from './edm-manifest'
import { renderSystemPreview, type SystemSelector } from '../core/system-css'

const EDM_ROOT = fileURLToPath(new URL('../../assets/edm', import.meta.url))
const OUTPUT = mkdtempSync(path.join(tmpdir(), 'sshk-edm-mail-compat-'))
afterAll(() => rmSync(OUTPUT, { recursive: true, force: true }))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'v1') continue // 旧演示资产按计划原样保留，不纳入迁移纪律
      out.push(...walk(full))
    } else if (entry.isFile() && /\.(css|njk)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const FORBIDDEN: Array<{ re: RegExp; label: string }> = [
  { re: /::(before|after)\b/, label: '伪元素' },
  { re: /:(hover|focus|active|visited)\b/, label: '交互伪类' },
  { re: /:nth-(child|of-type|last-child|first-child)\b/, label: '结构性伪类' },
  { re: /\bbox-shadow\s*:/, label: '阴影' },
  { re: /position\s*:\s*(absolute|fixed)/, label: '绝对定位' },
  { re: /\btransform\s*:/, label: '变换' },
  { re: /\bcalc\s*\(/, label: 'calc 计算' },
  { re: /background-blend-mode\s*:/, label: '混合模式' },
  { re: /background\s*:\s*linear-gradient/, label: '渐变 shorthand（需拆为 background-image）' },
]

describe('EDM 迁移资产邮件兼容性', () => {
  it('default 资产源码不含邮件不兼容写法，渐变均有纯色回落', () => {
    const files = walk(EDM_ROOT)
    expect(files.length).toBeGreaterThan(50)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const rel = path.relative(EDM_ROOT, file).replace(/\\/g, '/')
      for (const { re, label } of FORBIDDEN) {
        expect(re.test(text), `${rel} 仍含${label}`).toBe(false)
      }
      if (file.endsWith('.css')) {
        for (const block of text.split('}')) {
          if (!block.includes('linear-gradient')) continue
          expect(block, `${rel} 的渐变规则缺少 background-color 纯色回落`).toMatch(/background-color\s*:/)
        }
      }
    }
  })

  it('标题装饰与斑马纹落到真实元素', async () => {
    const model = await loadEdmModel(EDM_ROOT)
    for (const brand of model.brands) {
      const sel = (familyCode: string): SystemSelector => ({
        brandCode: brand.code,
        kind: 'fragment',
        familyCode,
        versionDir: 'default',
      })
      const preview = async (familyCode: string) =>
        (await renderSystemPreview(EDM_ROOT, sel(familyCode), { outputRoot: OUTPUT })).html

      const literature = await preview('literature')
      expect(literature).toContain('title-mark-square')
      expect(literature).toContain('stripe-row')

      const productTable = await preview('product-table')
      expect(productTable.match(/class="stripe-row"/g)?.length).toBe(2)

      if (brand.code === 'procell') {
        for (const family of ['cta-strip', 'image-card', 'bullet-list', 'how-to-order']) {
          expect(await preview(family)).toContain('title-mark-rectangle')
        }
      }
    }
  })
})
