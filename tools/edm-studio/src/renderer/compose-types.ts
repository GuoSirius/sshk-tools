/** 区块 / 片段摆放类型（三场景共用：片段预览 / 模板预览 / 邮件编辑）。
 *  P6-4 自 ComposeEditor.vue 抽出为纯 .ts 模块：composables（plain tsc）无法 import .vue 的具名导出，
 *  ComposeEditor.vue 经 re-export 保持原消费面（`from '../ComposeEditor.vue'`）零变化。 */
/** #213：slot 与片段的 type 字段已取消——插槽按 key 标识，片段可应用到任何位置 */
export interface SlotDef { key: string; label?: string }
export interface FragmentOption { id: string; label: string }
export interface PlacementItem {
  uid: string
  /** 片段标识：系统内容域=JSON(selector)；NeDB 域=片段版本 _id */
  fragmentId: string
  label: string
  slot: string
  order: number
  /** 备注名（2026-11-25 用户反馈：区分同片段多次使用，仅邮件组装可编辑保存；必填） */
  alias?: string
  data?: Record<string, unknown>
}
