/**
 * 环境变量布尔判定（2026-11-17 用户验收项3：各处手写 ['1','true'].includes(...) 收敛）。
 *
 * 注意：助手收「值」而不是「变量名」——check:env 门禁靠扫描源码里的
 * process.env.SSHK_* 字样来对齐 .env.example 声明，调用点保持显式读取。
 */

/** 开关型：'1' / 'true'（忽略大小写与首尾空白）视为开 */
export function envOn(value: unknown): boolean {
  return ['1', 'true'].includes(String(value ?? '').trim().toLowerCase())
}

/** 反向开关型：'0' / 'false' 视为「显式关」（未设置 / 其它值都算开） */
export function envOff(value: unknown): boolean {
  return ['0', 'false'].includes(String(value ?? '').trim().toLowerCase())
}
