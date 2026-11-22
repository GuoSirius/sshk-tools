/**
 * 渲染层文件读取纯函数（J-02 · 2026-11-22 第三轮复核）：File → dataURL 单一实现。
 * 此前 file-picker/host-library、edm-studio/upload、ContentEditorCore 三处各写一份
 * 逐字相同（仅错误文案不同）的 FileReader 包装——同一逻辑 ≥2 处即必须提取（复用监督清单铁律）。
 */

/** 把 File 读成 dataURL（FileReader 包装）；errorMsg 可自定义错误文案 */
export function readAsDataUrl(file: File, errorMsg = '读取文件失败'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(errorMsg))
    reader.readAsDataURL(file)
  })
}
