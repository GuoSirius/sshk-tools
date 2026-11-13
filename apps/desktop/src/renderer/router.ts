import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 桌面壳路由（vue-router 正解，替代自研状态路由）：
 * / = 应用桌面；/tool/:toolId/:menu? = 工具页。
 * 菜单高亮、页面内跳转（router.push）、刷新恢复（URL 天然承担）全部由路由负责。
 * 壳组件自身管理渲染，路由仅承载状态，无需 RouterView。
 */
const passthrough = { render: () => null }

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'desktop', component: passthrough },
    { path: '/tool/:toolId', name: 'tool', component: passthrough },
    { path: '/tool/:toolId/:menu', name: 'tool-menu', component: passthrough },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
