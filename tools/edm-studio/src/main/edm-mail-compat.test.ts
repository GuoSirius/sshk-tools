/**
 * 迁移资产邮件兼容不变量（plans/14 批次 6 + unocss 规范化）：
 * ① 源码层禁止 ::before/::after、结构性伪类、hover、absolute/transform/calc、阴影等邮件不兼容写法；
 * ② 渐变只允许 background-image + 同规则 background-color 纯色回落；
 * ③ 关键视觉（标题装饰、斑马纹）必须落到真实元素，而非伪元素/结构选择器；
 * ④ reset.css 只保留基础层与真实装饰基类，原子类不重复定义（统一由 unocss 运行时生成）；
 * ⑤ njk 不再用「伪 unocss」数字/颜色类（h-24/color-333/border-rd-10），改 arbitrary value/property；
 * ⑥ 关键 arbitrary class 能被 unocss 生成且 juice 内联为真实像素/纯色（不靠 CSS 变量 alpha）；
 * ⑦ unocss 生成带 CSS 变量的同名 class（color-blue / bg-white 等）必须有品牌 css 兜底定义，
 *    且 default njk 必须 link 合并后的 brand.css —— 否则 Tailwind 默认色 + var() 会泄漏到内联结果。
 * ⑧ 框架自动注入仅 normalize.css（构建期内联）+ uno；reset.css（邮件适配）由 default njk 显式 link；见 edm-assets.test.ts。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { createGenerator } from '@unocss/core'
import presetWind3 from '@unocss/preset-wind3'
import juice from 'juice'
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

  it('reset.css 只保留基础层与真实装饰基类，不重复定义原子类', () => {
    const css = readFileSync(path.join(EDM_ROOT, 'css', 'reset.css'), 'utf8')
    const classDefs = [...css.matchAll(/^\.([\w-]+)\s*\{/gm)].map((m) => m[1])
    // 仅允许 title-mark 一个真实装饰基类；ExternalClass 因 juice 全内联剥除已删除（#205），其余交 unocss
    expect(classDefs.sort()).toEqual(['title-mark'])
  })

  it('njk 无伪 unocss 数字/颜色类，均改用 arbitrary 语法', () => {
    const files = walk(EDM_ROOT).filter((f) => f.endsWith('.njk'))
    // #206 起 w-100/h-100 已统一为 unocss 等价的 w-full/h-full（unocss 的 -100 是 25rem≠100%），禁用检测纳入
    const legacy = /(?:^|\s)(?:h-\d+|w-100|pt-\d+|pb-\d+|px-\d+|py-\d+)(?:\s|$)|border-rd-\d+|color-(?:333|white|orange|red)(?:\s|$)/g
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      // 只检查 class="..." 内的 token，避免误伤文案里的数字
      for (const m of text.matchAll(/class="([^"]*)"/g)) {
        const cls = m[1] ?? ''
        expect(legacy.test(cls), `${path.relative(EDM_ROOT, file)} 仍含伪 unocss 类：${cls}`).toBe(false)
        legacy.lastIndex = 0
      }
    }
  })

  it('关键 arbitrary class 经 unocss + juice 内联为真实像素/纯色，无 CSS 变量 alpha', async () => {
    const cls = ['h-[24px]', 'pb-[5px]', 'pt-[8px]', 'rounded-[10px]', '[color:#333]']
    const uno = await createGenerator({ presets: [presetWind3({ preflight: false })] })
    const { css } = await uno.generate(cls.join(' '), { preflights: false })
    const inlined = juice.inlineContent(`<div class="${cls.join(' ')}">x</div>`, css)
    const normalized = inlined.replace(/\s*:\s*/g, ':').replace(/;\s*"/, '"')
    expect(normalized).toContain('height:24px')
    expect(normalized).toContain('padding-bottom:5px')
    expect(normalized).toContain('padding-top:8px')
    expect(normalized).toContain('border-radius:10px')
    expect(normalized).toContain('color:#333')
    expect(normalized).not.toContain('--un-text-opacity')
    // 白色单独验（同元素多个 color 类后者会覆盖前者）
    const whiteCss = (await uno.generate('[color:#fff]', { preflights: false })).css
    expect(juice.inlineContent('<div class="[color:#fff]">x</div>', whiteCss).replace(/\s*:\s*/g, ':')).toContain('color:#fff')
  })

  it('unocss 带 CSS 变量的同名 class 必须有品牌 css 兜底，且 njk 都 link 了 brand.css', async () => {
    const uno = await createGenerator({ presets: [presetWind3({ preflight: false })] })
    for (const brand of ['elabscience', 'procell']) {
      const brandDir = path.join(EDM_ROOT, brand)
      const njkFiles = walk(brandDir).filter((f) => f.endsWith('.njk'))
      expect(njkFiles.length, `${brand} 未找到 default njk`).toBeGreaterThan(0)

      // ① 所有 default njk 必须 link 合并后的 brand.css，否则品牌兜底定义进不了 bundle；
      //    旧 palette/components link 出现即视为漏改（#204 合并后防漏断言）
      for (const file of njkFiles) {
        const text = readFileSync(file, 'utf8')
        expect(text, `${path.relative(EDM_ROOT, file)} 未 link brand.css，品牌色将被 unocss 默认值覆盖`)
          .toMatch(/href="@root\/[^"]+\/css\/brand\.css"/)
        expect(text, `${path.relative(EDM_ROOT, file)} 仍 link 已合并旧文件`).not.toMatch(/css\/(?:palette|components)\.css/)
      }
      // ② 品牌级 css/ 目录只应保留合并后的 brand.css（版本私有 css/ 不在本断言范围）
      const brandCssDir = path.join(brandDir, 'css')
      expect(readdirSync(brandCssDir).filter((f) => f.endsWith('.css')).sort()).toEqual(['brand.css'])

      // ③ 收集该品牌 njk 实际用到的 class，找出 unocss 会生成 CSS 变量的那些
      const used = new Set<string>()
      for (const file of njkFiles) {
        for (const m of readFileSync(file, 'utf8').matchAll(/class="([^"]*)"/g)) {
          for (const c of (m[1] ?? '').split(/\s+/)) if (c) used.add(c)
        }
      }
      const { css: unoCss } = await uno.generate([...used].join(' '), { preflights: false })
      const risky = unoCss
        .split('\n')
        .filter((line) => line.includes('--un-'))
        .map((line) => line.match(/^\.([^{]+)\{/)?.[1]?.replace(/\\/g, ''))
        .filter((name): name is string => Boolean(name))
      expect(risky.length, `${brand} 未检出需兜底的 class，测试可能已失效`).toBeGreaterThan(0)

      // ④ 每个 risky class 必须在品牌 css（brand.css 已收编 palette + brand-utils）中有定义
      const linkedCss = [path.join(EDM_ROOT, 'css', 'reset.css'), ...walk(brandDir).filter((f) => f.endsWith('.css'))]
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n')
      for (const name of risky) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expect(new RegExp(`\\.${escaped}\\s*[,{:]`, 'm').test(linkedCss),
          `${brand} 的 .${name} 由 unocss 生成但无品牌 css 兜底，将泄漏 Tailwind 默认色与 var()`).toBe(true)
      }
    }
  })
})
