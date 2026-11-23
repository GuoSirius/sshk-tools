/**
 * ⑤ 文件域解析辅助（plans/13 B0 重组）：示例 / 元数据 / 片段数据的 YAML 容错解析。
 * （js-yaml 仅在此文件引入；纯入口不触碰 Node 专有模块）
 */
import { load as yamlLoad } from 'js-yaml'

/**
 * 「数据为空」是完全合法的初始状态：空文件、纯空白、纯注释、显式 null
 * 一律视为空模型 {}，绝不弹「YAML 解析失败」。只有真正的语法错误才抛出；
 * 顶层不是键值映射时给出明确原因，而不是把异常笼统包装成 YAML 问题。
 */
export function parseYamlObject(text: unknown): Record<string, unknown> {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = yamlLoad(raw)
  } catch (err) {
    // js-yaml 5.x 对「只有注释 / 空文档」会抛 expected a document；这仍是合法空数据，
    // 不得冒泡成「YAML 解析失败」（复核项 8 的真实根因）。其它语法错误照常抛出。
    if (/expected a document|input is empty/i.test((err as Error).message)) return {}
    throw err
  }
  if (parsed == null) return {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML 顶层必须是键值映射（object），不能是数组或标量')
  }
  return parsed as Record<string, unknown>
}
