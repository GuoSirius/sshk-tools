import { describe, expect, it } from 'vitest'
import { parseVersionEntityId } from './render-meta.js'

/**
 * 版本实体 ID 解析（2026-11-25 用户反馈修复）：
 * 旧实现前缀用 'tpl'/'frg' 去 indexOf，与实际 'tplv'/'frgv' 不符，
 * system 版本目录推导恒失败 → css 解析、meta 反查全部回退播种快照。
 */
describe('parseVersionEntityId 版本实体 ID 解析', () => {
  it('system 模板版本：tplv_sys_<brand>_<fam>_<dir>', () => {
    expect(parseVersionEntityId('tplv_sys_elabscience_standard_default', 'template', 'system', 'default')).toEqual({
      brandCode: 'elabscience',
      familyCode: 'standard',
      versionDirName: 'default',
    })
  })

  it('system 片段版本：frgv_sys_<brand>_<fam>_<dir>（dir=v1）', () => {
    expect(parseVersionEntityId('frgv_sys_elabscience_banner_v1', 'fragment', 'system', 'v1')).toEqual({
      brandCode: 'elabscience',
      familyCode: 'banner',
      versionDirName: 'v1',
    })
  })

  it('custom 片段版本：cus_frgv_<brand>_<fam>_<dir>，族名不被 dir 污染', () => {
    expect(parseVersionEntityId('cus_frgv_procell_header_default', 'fragment', 'custom', 'default')).toEqual({
      brandCode: 'procell',
      familyCode: 'header',
      versionDirName: 'default',
    })
  })

  it('族名含下划线：label 后缀剥离，中段完整保留', () => {
    expect(parseVersionEntityId('tplv_sys_elabscience_arrow_strip_v2', 'template', 'system', 'v2')).toEqual({
      brandCode: 'elabscience',
      familyCode: 'arrow_strip',
      versionDirName: 'v2',
    })
  })

  it('短 ID（无 dir 段，单版本折叠）：族目录即版本', () => {
    expect(parseVersionEntityId('frgv_sys_elabscience_header', 'fragment', 'system', undefined)).toEqual({
      brandCode: 'elabscience',
      familyCode: 'header',
      versionDirName: '',
    })
  })

  it('前缀与 kind 不符 / 结构非法 → null（调用侧回退播种快照）', () => {
    expect(parseVersionEntityId('tplv_sys_elabscience_standard_default', 'fragment', 'system', 'default')).toBeNull()
    expect(parseVersionEntityId('frgv_custom_elabscience_header_default', 'fragment', 'system', 'default')).toBeNull()
    expect(parseVersionEntityId('cus_tplv_procell_header_default', 'template', 'system', 'default')).toBeNull()
    expect(parseVersionEntityId('whatever', 'template', 'system', 'default')).toBeNull()
  })
})
