import type { ToolDescriptor } from '@sshk/shared'
import { TOOL_IDS } from '@sshk/shared'

// 新增工具只需在这里注册一条，桌面首页与工具左侧功能菜单自动生成。
export const TOOLS: ToolDescriptor[] = [
  {
    id: TOOL_IDS.edmStudio,
    name: 'EDM Studio',
    description: '制作邮件 EDM：品牌 / 模板 / 片段 / 版本、数据填充与三阶段 HTML 生成',
    category: '邮件营销',
    icon: 'edm',
    entryRoute: 'mails',
    enabled: true,
    menus: [
      { id: 'brands', label: '品牌' },
      { id: 'templates', label: '模板' },
      { id: 'fragments', label: '片段' },
      { id: 'mails', label: '邮件' },
    ],
  },
  {
    id: TOOL_IDS.badgeStudio,
    name: 'Badge Studio',
    description: '上传点击统计与邮件 HTML，注入 badge 并生成海报长图',
    category: '邮件营销',
    icon: 'badge',
    entryRoute: 'generate',
    enabled: true,
    menus: [
      { id: 'generate', label: '生成海报' },
      { id: 'posters', label: '海报列表' },
    ],
  },
  {
    id: TOOL_IDS.modelConsole,
    name: 'Model Console',
    description: '配置本地 / 云 / 自部署模型，连接测试与对话调试',
    category: 'AI 能力',
    icon: 'model',
    entryRoute: 'providers',
    enabled: true,
    menus: [
      { id: 'providers', label: '模型 Provider' },
      { id: 'chat', label: '对话调试' },
    ],
  },
]

export const TOOL_GROUPS = Array.from(new Set(TOOLS.map((tool) => tool.category)))
