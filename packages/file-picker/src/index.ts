/**
 * @sshk/file-picker — 通用文件选择弹框（自 rich-text 图片库 2026-11-17 泛化抽取）。
 * 上传 + 从已有来源挑选，图片/文件两模式；确认结果经 @confirm 交给应用方处理。
 * 桥接契约（FilePickerLibrary）由工具侧注入实现，本包不依赖 upload-core。
 */
export { default as FilePickerDialog } from './components/FilePickerDialog.vue'
export type {
  FilePickerConflict,
  FilePickerConfirmPayload,
  FilePickerItem,
  FilePickerKind,
  FilePickerLibrary,
  FilePickerMode,
  FilePickerNaming,
  FilePickerPage,
  FilePickerSource,
  FilePickerTarget,
  FilePickerUploadProgress,
  FilePickerUploadProgressHook,
} from './types'
export {
  defaultSourceId,
  loadSettings,
  matchFileKeyword,
  normalizeDirInput,
  saveSettings,
  sortSourcesByDefault,
  validateDirInput,
} from './picker-settings'
export type { DirValidation, DirValidationLevel, FilePickerSettings } from './picker-settings'
export { contentName, fingerprintKey, hashFile, resolveUploadName } from './upload-dedupe'
/** 宿主上传能力图片库桥接（plans/11：EDM/模板/内容管理单一实现） */
export { createHostImageLibrary } from './host-library'
export type { HostUploadBridge, HostImageLibraryOptions } from './host-library'
