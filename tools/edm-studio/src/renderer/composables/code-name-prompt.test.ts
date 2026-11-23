import { describe, expect, it } from 'vitest'
import { useContentTree } from './useContentTree'

describe('一步式新建弹框（code + name 同屏）', () => {
  it('一次确认即返回，不再第二次弹窗', async () => {
    const tree = useContentTree({})
    const p = tree.promptCodeAndName('新建品牌', '品牌代码（目录名，英文）', '')
    expect(tree.codeNameState.value.visible).toBe(true)
    expect(tree.codeNameState.value.title).toBe('新建品牌')

    tree.codeNameState.value.code = ' demo '
    tree.codeNameState.value.name = ' 演示品牌 '
    tree.confirmCodeName()

    expect(await p).toEqual({ code: 'demo', name: '演示品牌' })
    expect(tree.codeNameState.value.visible).toBe(false)
  })

  it('校验不通过只填红色 tip 提示，不 resolve、不关闭弹框', async () => {
    const tree = useContentTree({})
    let settled = false
    const p = tree.promptCodeAndName('新建族', '族代码', '').then((v) => {
      settled = true
      return v
    })

    tree.codeNameState.value.code = 'bad code!'
    tree.codeNameState.value.name = ''
    tree.confirmCodeName()

    expect(tree.codeNameState.value.codeError).toContain('仅限字母')
    expect(tree.codeNameState.value.nameError).toBe('名称必填')
    expect(tree.codeNameState.value.visible).toBe(true)
    expect(settled).toBe(false)

    tree.cancelCodeName()
    expect(await p).toBeNull()
    expect(tree.codeNameState.value.visible).toBe(false)
  })
})
