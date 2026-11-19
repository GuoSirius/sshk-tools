import {
  createApp, h, ref, reactive, computed, watch, watchEffect,
  onMounted, onUnmounted, onBeforeUnmount, nextTick,
  provide, inject, defineComponent, markRaw, shallowRef, shallowReactive,
  toRef, toRefs, isRef, unref, triggerRef, customRef,
} from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'virtual:uno.css'
import './styles/theme.css'
import App from './App.vue'
import { useTheme } from './composables/useTheme'
import { installPlainApi } from './api-plain'
import { installFrontLog } from './front-log'
import { setupDialogAutofocus } from './focus-on-dialog-open'

// Vue Proxy 跨 contextBridge 传参会触发结构化克隆错误；必须在任何组件调用前脱壳
installPlainApi()
// 弹框打开自动聚焦首个输入（用户 2026-11-18）：全局 MutationObserver，一处安装全项目生效
setupDialogAutofocus()
// H3 渲染层日志：三处兜底捕获 + console.error 镜像 → 主进程落盘（挂在 app 实例上，见下方 mount 前）

// 外部运行时包渲染层契约：产物不 import 任何模块（Blob URL 下裸导入无法解析），
// 通过 window.SSHK 取 Vue 工具。尽量提供全量 API，确保零 import 渲染层最大可用性。
;(window as unknown as { SSHK: Record<string, unknown> }).SSHK = {
  h, ref, reactive, computed, watch, watchEffect,
  onMounted, onUnmounted, onBeforeUnmount, nextTick,
  provide, inject, defineComponent, markRaw, shallowRef, shallowReactive,
  toRef, toRefs, isRef, unref, triggerRef, customRef,
}

import { router } from "./router"

const { init } = useTheme()
void init()

const app = createApp(App).use(router).use(ElementPlus, { locale: zhCn })
installFrontLog(app)
app.mount('#app')
