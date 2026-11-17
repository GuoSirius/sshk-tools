import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_EXTS,
  FILE_KIND_ACCEPT,
  FILE_KIND_LABELS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  extNameOf,
  isKindFileName,
  normalizeFileKind,
} from './file-kinds'

describe('file-kinds 类别判定', () => {
  it('image 按图片白名单过滤（历史口径不变）', () => {
    for (const ext of IMAGE_EXTS) expect(isKindFileName('image', `a${ext}`)).toBe(true)
    expect(isKindFileName('image', 'a.png')).toBe(true)
    expect(isKindFileName('image', 'A.PNG')).toBe(true)
    expect(isKindFileName('image', 'a.pdf')).toBe(false)
    expect(isKindFileName('image', '无扩展名')).toBe(false)
    expect(isKindFileName('image', '.png')).toBe(false) // 隐藏文件：lastIndexOf 后 i===0 不算扩展名
  })

  it('document / code 按各自白名单过滤', () => {
    for (const ext of DOCUMENT_EXTS) expect(isKindFileName('document', `f${ext}`)).toBe(true)
    expect(isKindFileName('document', '报告.PDF')).toBe(true)
    expect(isKindFileName('document', 'main.ts')).toBe(false)
    expect(isKindFileName('code', 'index.vue')).toBe(true)
    expect(isKindFileName('code', 'deploy.sh')).toBe(true)
    expect(isKindFileName('code', 'config.yaml')).toBe(true)
    expect(isKindFileName('code', 'a.docx')).toBe(false)
  })

  it('all 恒真且缺省 kind 不放行（Provider 侧自行补 image 缺省）', () => {
    expect(isKindFileName('all', 'x.exe')).toBe(true)
    expect(isKindFileName('all', 'x.png')).toBe(true)
    expect(isKindFileName(undefined, 'x.png')).toBe(false) // undefined 不等于 image，防止误放开
  })

  it('video 按视频白名单过滤（.ts 归代码类，不重复收）', () => {
    for (const ext of VIDEO_EXTS) expect(isKindFileName('video', `v${ext}`)).toBe(true)
    expect(isKindFileName('video', 'demo.MP4')).toBe(true)
    expect(isKindFileName('video', 'index.ts')).toBe(false) // TypeScript 代码，不属视频
    expect(isKindFileName('code', 'index.ts')).toBe(true)
    expect(isKindFileName('video', 'a.mp3')).toBe(false)
  })

  it('extNameOf 取小写扩展名', () => {
    expect(extNameOf('a.Bc.PDF')).toBe('.pdf')
    expect(extNameOf('noext')).toBe('')
    expect(extNameOf('.bashrc')).toBe('')
  })

  it('默认 accept：image/video 用通配，document/code 列扩展名，all 不限制', () => {
    expect(FILE_KIND_ACCEPT.image).toBe('image/*')
    expect(FILE_KIND_ACCEPT.video).toBe('video/*')
    expect(FILE_KIND_ACCEPT.document.startsWith('.pdf,.doc')).toBe(true)
    expect(FILE_KIND_ACCEPT.code.startsWith('.js,.mjs')).toBe(true)
    expect(FILE_KIND_ACCEPT.all).toBe('')
  })

  it('类别中文文案与历史值归一', () => {
    expect(FILE_KIND_LABELS.image).toBe('图片')
    expect(FILE_KIND_LABELS.document).toBe('文档')
    expect(FILE_KIND_LABELS.code).toBe('代码')
    expect(FILE_KIND_LABELS.video).toBe('视频')
    expect(FILE_KIND_LABELS.all).toBe('文件')
    expect(normalizeFileKind('file')).toBe('all') // 历史值兼容
    expect(normalizeFileKind('image')).toBe('image')
    expect(normalizeFileKind('document')).toBe('document')
    expect(normalizeFileKind('code')).toBe('code')
    expect(normalizeFileKind('video')).toBe('video')
    expect(normalizeFileKind('all')).toBe('all')
    expect(normalizeFileKind(undefined)).toBeUndefined()
    expect(normalizeFileKind('bogus')).toBeUndefined()
  })
})
