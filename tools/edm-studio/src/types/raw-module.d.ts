/** vite 原生 raw 导入：构建期把文件内容内联为字符串（electron-vite main 与 vitest 均支持） */
declare module '*?raw' {
  const content: string
  export default content
}
