/**
 * ⑦ 内置复合控件常量（plans/13 阶段 C）：系统播种数据源（主进程 ensureSeedControls 按 key 幂等补插）。
 * builtin 控件只读禁删禁改；root 为容器型 FieldDef（type ∈ list/repeater/table），
 * itemFields 只由基础原子控件组成（内置件不引用其他控件，避免播种顺序与循环依赖）。
 */
import type { FieldDef } from './schema'

export interface BuiltinControlSpec {
  key: string
  label: string
  description?: string
  root: FieldDef
}

export const BUILTIN_CONTROLS: readonly BuiltinControlSpec[] = [
  {
    key: 'contact_group',
    label: '联系人组',
    description: '内置示例：一组联系人（姓名/电话/邮箱），可增删多行',
    root: {
      key: 'contact_group',
      label: '联系人组',
      type: 'repeater',
      minRows: 1,
      itemFields: [
        { key: 'name', label: '姓名', type: 'input', required: true },
        { key: 'phone', label: '电话', type: 'input', placeholder: '手机号或座机' },
        { key: 'email', label: '邮箱', type: 'input', placeholder: 'name@example.com' },
      ],
    },
  },
  {
    key: 'product_card',
    label: '产品卡',
    description: '内置示例：产品展示卡（标题/图片/卖点/价格），可增删多张',
    root: {
      key: 'product_card',
      label: '产品卡',
      type: 'repeater',
      minRows: 1,
      itemFields: [
        { key: 'title', label: '产品名称', type: 'input', required: true },
        { key: 'image', label: '产品图', type: 'image' },
        { key: 'summary', label: '卖点描述', type: 'textarea' },
        { key: 'price', label: '价格 (元)', type: 'number', min: 0 },
      ],
    },
  },
]
