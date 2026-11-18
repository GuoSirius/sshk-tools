import { describe, expect, it } from 'vitest'
import { buildReportMd } from './diagnostics'
import type { DiagnosisData } from '@sshk/shared'

/** 构造一份典型诊断数据（覆盖各分段与脱敏要点） */
function sampleData(): DiagnosisData {
  return {
    generatedAt: '2026-11-16 14:00:00',
    app: { version: '0.1.0', packaged: false, electron: '33.0.0', node: '24.19.0', locale: 'zh-CN' },
    platform: { os: 'win32', arch: 'x64', release: '10.0.26100', memoryGB: '31.9', displays: [{ w: 2560, h: 1440, scale: 1.5 }] },
    env: [
      { name: 'GH_TOKEN', set: true },
      { name: 'SSHK_APP_DEVTOOLS_KEY', set: false },
    ],
    secrets: {
      accessKey: true,
      devtoolsKey: false,
      providers: [{ id: 'prv_abc', name: 'Agnes', hasApiKey: true }],
      uploads: [{ id: 'qiniu_main', name: '七牛主账号', hasSecret: false }],
    },
    tools: [
      { id: 'badge-studio', name: '角标工作台', enabled: true, visible: true, visibility: 'desktop', grant: '', plugin: '已加载', dependsOn: [], warnings: [] },
      { id: 'broken-tool', name: '故障工具', enabled: true, visible: true, visibility: 'desktop', grant: '', plugin: '失败：入口文件缺失', dependsOn: ['badge-studio'], warnings: ['依赖缺失'] },
    ],
    outputs: { root: 'D:/data/sshk', files: 3, totalMB: '2.5', largest: [{ rel: 'outputs/posters/a.png', kb: 1024 }] },
    logs: {
      dir: 'C:/Users/x/logs',
      files: [{ name: 'sshk-2026-11-16.log', sizeKB: 42, warn: 2, error: 1 }],
      recentErrors: ['[14:00:01] [ERROR] [app] 测试错误 apiKey=***'],
    },
  }
}

describe('buildReportMd（N1 诊断报告 Markdown）', () => {
  it('包含全部 7 类分段标题与关键行', () => {
    const md = buildReportMd(sampleData())
    expect(md).toContain('# sshk-tools 诊断报告')
    expect(md).toContain('应用版本：v0.1.0（dev）')
    expect(md).toContain('平台：win32')
    expect(md).toContain('## 环境变量（只列名，值永不采集）')
    expect(md).toContain('## 密钥配置状态（布尔，不含内容）')
    expect(md).toContain('## 工具快照（2 个）')
    expect(md).toContain('## 产物目录占用')
    expect(md).toContain('## 最近 3 天日志')
    expect(md).toContain('失败：入口文件缺失')
  })

  it('env 只出现变量名与设置布尔，绝不出现值', () => {
    const md = buildReportMd(sampleData())
    expect(md).toContain('| GH_TOKEN | ✓ |')
    expect(md).toContain('| SSHK_APP_DEVTOOLS_KEY | — |')
  })

  it('密钥只出布尔状态文字，无任何明文段落', () => {
    const md = buildReportMd(sampleData())
    expect(md).toContain('应用访问密钥：已配置')
    expect(md).toContain('开发者工具口令：未配置')
    expect(md).toContain('Agnes(✓)')
    expect(md).toContain('七牛主账号(未配置)')
  })

  it('异常工具与告警单独列出，error 摘录保留', () => {
    const md = buildReportMd(sampleData())
    expect(md).toContain('- ⚠ broken-tool：依赖缺失')
    expect(md).toContain('apiKey=***')
  })
})
