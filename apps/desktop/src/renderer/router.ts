import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 桌面壳路由（vue-router 正解，替代自研状态路由）：
 * / = 应用桌面；/tool/:toolId/:menu? = 工具页；/app/:module?/:page? = 应用管理（P4-2）。
 * 应用管理落点（2026-11-22）：未指定/指定无效由 AppAdminPage 按「第一个有效菜单页」解析
 * 并 router.replace 规整 URL（菜单树是页面内单一真相源，路由不硬编码落点）。
 * 菜单高亮、页面内跳转（router.push）、刷新恢复（URL 天然承担）全部由路由负责。
 * 壳组件自身管理渲染，路由仅承载状态，无需 RouterView。
 */
const passthrough = { render: () => null }

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'desktop', component: passthrough },
    { path: '/app/:module?/:page?', name: 'app-admin', component: passthrough },
    { path: '/tool/:toolId', name: 'tool', component: passthrough },
    { path: '/tool/:toolId/:menu', name: 'tool-menu', component: passthrough },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
