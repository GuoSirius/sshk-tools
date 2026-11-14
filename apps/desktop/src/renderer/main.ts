import {
  createApp, h, ref, reactive, computed, watch, watchEffect,
  onMounted, onUnmounted, onBeforeUnmount, nextTick,
  provide, inject, defineComponent, markRaw, shallowRef, shallowReactive,
  toRef, toRefs, isRef, unref, triggerRef, customRef,
} from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'virtual:uno.css'
import './styles/theme.css'
import App from './App.vue'
import { useTheme } from './composables/useTheme'
import { installPlainApi } from './api-plain'

// Vue Proxy 跨 contextBridge 传参会触发结构化克隆错误；必须在任何组件调用前脱壳
installPlainApi()

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

createApp(App).use(router).use(ElementPlus).mount('#app')
