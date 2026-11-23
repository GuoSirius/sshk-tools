/** ui 子入口的纯类型（.vue SFC 无法被 tsc 直接导出类型，放独立 ts 文件） */
export interface CompositeControlOption {
  key: string
  label: string
}
