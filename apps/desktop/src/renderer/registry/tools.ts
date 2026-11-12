import type { ToolDescriptor } from '@sshk/shared'
import { TOOL_IDS } from '@sshk/shared'

// 新增工具只需在这里注册一条，桌面首页与全局导航自动生成。
export const TOOLS: ToolDescriptor[] = [
  {
    id: TOOL_IDS.edmStudio,
    name: 'EDM Studio',
    description: '制作邮件 EDM：品牌 / 模板 / 片段 / 版本、数据填充与三阶段 HTML 生成',
    category: '邮件营销',
    icon: 'edm',
    entryRoute: 'mails',
    enabled: true,
  },
  {
    id: TOOL_IDS.badgeStudio,
    name: 'Badge Studio',
    description: '上传点击统计与邮件 HTML，注入 badge 并生成海报长图',
    category: '邮件营销',
    icon: 'badge',
    entryRoute: 'posters',
    enabled: true,
  },
  {
    id: TOOL_IDS.modelConsole,
    name: 'Model Console',
    description: '配置本地 / 云 / 自部署模型，连接测试与对话调试',
    category: 'AI 能力',
    icon: 'model',
    entryRoute: 'providers',
    enabled: true,
  },
]

export const TOOL_GROUPS = Array.from(new Set(TOOLS.map((tool) => tool.category)))
