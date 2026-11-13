import { createApp } from 'vue'
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

import { router } from "./router"

const { init } = useTheme()
void init()

createApp(App).use(router).use(ElementPlus).mount('#app')
