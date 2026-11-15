/**
 * 构建期 shim（仅主进程 bundle 使用）。
 *
 * ssh2/lib/protocol/constants.js 用 `try { require('cpu-features')() } catch {}` 探测
 * 原生 CPU 指令集加速，属**可选**依赖：Windows 下 pnpm-workspace.yaml 已用
 * allowBuilds:false 拒绝其 node-gyp 编译，electron-builder 又排除 node_modules/**，
 * 该 .node 二进制在打包产物里本就不存在。
 *
 * rolldown 会静态解析 cpu-features/lib/index.js 里的
 * `require('../build/Release/cpufeatures.node')` 并因文件缺失直接构建失败。
 * 这里把包名替换为一个抛错的函数：ssh2 的 try/catch 会吞掉它并回退纯 JS
 * 能力探测，SFTP 功能不受影响，也不引入任何运行时依赖。
 */
module.exports = function cpuFeaturesUnavailable() {
  throw new Error('cpu-features native binding unavailable in bundled build')
}
