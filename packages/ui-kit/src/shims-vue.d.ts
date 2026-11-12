declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // 源码级组件：由消费方（桌面应用 electron-vite）编译，这里仅提供类型占位
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
