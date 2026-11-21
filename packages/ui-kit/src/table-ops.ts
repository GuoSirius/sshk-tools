import type { Component } from 'vue'

/** 操作列动作（TableOpsColumn · P2-1）：≤3 内联 + 更多▾ 下拉 */
export interface OpsAction {
  key: string
  label: string
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  icon?: Component
  /** 置灰（如「查看」在无产物时） */
  disabled?: boolean
}
