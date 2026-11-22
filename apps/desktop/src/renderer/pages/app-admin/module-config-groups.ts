import type { ToolConfigGroup } from '@sshk/shared'

/**
 * 两个「工具设置」页的页内声明分组（P4-8c · C-3 · 台账#156）：
 * 三基础模块并入应用本体后工具 manifest 已退役（P4-8b），fileconfig / modelconfig 两页不再依赖
 * 目录 configGroups，改为页内声明数据 + 宿主 ToolSettingsPage 引擎渲染（AppAdminPage 传入 groups）。
 * 字段定义从原清单逐字抄准；配置键按 C-3 一次性迁移（旧键弃用，不写运行时迁移代码）。
 * 布局口径（2026-11-22 需求 · 台账#159）：统一两列栅格——短控件（select/number/input）一律不标
 * full，走 FormGrid 两列；长控件（textarea/代码编辑器/路径组合）才独占整行（引擎既有规则）。
 */

/** 文件管理 > 工具设置（原 tools/file-manager/tool.manifest.json configGroups） */
export const FILE_CONFIG_GROUPS: ToolConfigGroup[] = [
  {
    id: 'content-editor',
    label: '内容编辑器',
    fields: [
      {
        // C-3 迁移：tools.file-manager.editorMode → app.modules.fileManager.editorMode
        key: 'app.modules.fileManager.editorMode',
        label: '新建/编辑形式',
        type: 'select',
        options: [
          { label: '弹框', value: 'dialog' },
          { label: '整页', value: 'page' },
        ],
        hint: '内容管理的新建/编辑容器形态（弹框=弹窗、整页=整页视图），两种形态共用同一编辑器实现；保存后下次打开生效',
        default: 'dialog',
      },
    ],
  },
  {
    id: 'fs-transfer',
    label: '传输与分片',
    fields: [
      {
        key: 'app.fs.multipart.thresholdMb',
        label: '分片阈值 (MB)',
        type: 'number',
        min: 1,
        max: 1024,
        default: 50,
        hint: '上传/下载超过该大小的文件走分片 + 断点续传（1~1024，默认 50）；由文件系统传输与图片库上传（FilePicker）共用同一份配置',
      },
      {
        key: 'app.fs.multipart.partSizeMb',
        label: '单片大小 (MB)',
        type: 'number',
        min: 5,
        max: 100,
        default: 5,
        hint: '每个分片的大小（5~100，默认 5）；分片数超上限时自动上调单片大小',
      },
      {
        key: 'app.fs.multipart.partsConcurrency',
        label: '分片并发数',
        type: 'number',
        min: 1,
        max: 8,
        default: 3,
        hint: '单任务同时传输的分片数（1~8，默认 3）',
      },
      {
        key: 'app.fs.multipart.requestTimeoutSec',
        label: '请求超时 (秒)',
        type: 'number',
        min: 30,
        max: 3600,
        default: 300,
        hint: '云上传/下载单请求超时（30~3600 秒，默认 300）；弱网或大文件 ACK 慢可调大。超时后自动复核服务端是否已落盘，已落盘不会误报失败',
      },
    ],
  },
]

/** 模型管理 > 工具配置（原 tools/model-console/tool.manifest.json configGroups config-gateway） */
export const MODEL_CONFIG_GROUPS: ToolConfigGroup[] = [
  {
    id: 'config-gateway',
    label: '网关偏好',
    fields: [
      {
        // C-3 迁移：tools.model-console.defaultProviderId → app.modules.modelManager.defaultProviderId
        key: 'app.modules.modelManager.defaultProviderId',
        label: '默认 Provider',
        type: 'select',
        optionsSource: 'llm:providers',
        fallbackKey: 'app.llm.activeProviderId',
        hint: '下拉选择 Provider；选「跟随应用激活」则用应用当前激活的 Provider（生效值在下方展示）',
      },
      {
        key: 'app.modules.modelManager.chatTimeoutMs',
        label: '请求超时(ms)',
        type: 'number',
        min: 1000,
        max: 120000,
      },
      {
        key: 'app.modules.modelManager.streamEnabled',
        label: '启用流式输出',
        type: 'boolean',
      },
    ],
  },
]
