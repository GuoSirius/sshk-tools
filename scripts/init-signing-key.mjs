#!/usr/bin/env node
/**
 * 初始化 / 查看本机官方签名密钥：pnpm keys:init [-- --import <pem文件>]
 *
 * - 无参数：本机已有私钥则只展示（幂等，不覆盖）；没有则生成新密钥对并落盘到用户级目录
 * - --import <file>：把外部 PEM（旧设备/公司密钥库导出）导入到本机用户级目录
 *
 * 输出公钥 PEM 与 keyId，并检测是否已登记进 official-keys.json；未登记时打印可直接粘贴的 JSON 条目。
 * 私钥始终只在 <homedir>/.sshk/official-signing-key.pem，绝不写入仓库。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/tool-package.mjs'
import {
  KEY_FILE,
  ensureLocalKey,
  importLocalKey,
  keyIdOf,
  publicPemOf,
} from './lib/signing-key.mjs'

function main() {
  const argv = process.argv.slice(2)
  const imp = argv.indexOf('--import')
  let privatePem
  let status
  if (imp >= 0) {
    const file = argv[imp + 1]
    if (!file || !existsSync(file)) throw new Error(`--import 指定的文件不存在：${file ?? '(空)'}`)
    privatePem = importLocalKey(readFileSync(file, 'utf8'))
    status = '已从文件导入'
  } else {
    const r = ensureLocalKey()
    privatePem = r.privatePem
    status = r.created ? '已新建' : '已存在（未改动）'
  }

  const keyId = keyIdOf(privatePem)
  const publicPem = publicPemOf(privatePem)
  const keysFile = join(ROOT, 'packages/shared/src/official-keys.json')
  const registered = JSON.parse(readFileSync(keysFile, 'utf8')).some((k) => k.keyId === keyId)

  console.log('官方签名密钥（本机）')
  console.log(`  私钥位置   : ${KEY_FILE}`)
  console.log(`  状态       : ${status}`)
  console.log(`  keyId      : ${keyId}`)
  console.log(`  公钥登记   : ${registered ? '✅ 已在 official-keys.json 中' : '⚠️ 尚未登记，请追加以下条目'}`)
  console.log('\n---PUBLIC KEY PEM---')
  process.stdout.write(publicPem)
  console.log('---END---')

  if (!registered) {
    console.log('\n把以下条目追加到 packages/shared/src/official-keys.json 数组后提交：')
    console.log(JSON.stringify({
      keyId,
      pem: publicPem,
      since: '<填写当天日期 YYYY-MM-DD>',
      label: '<填写用途 / 设备名>',
    }, null, 2))
    console.log('\n登记前用本密钥签出的包会被 check:signature 门禁拒绝（公钥不可信），属预期。')
  }
  console.log('\n提示：公钥可以多把并存；每台设备各持一把私钥、各自登记公钥，是推荐的跨设备做法。')
}

try { main() } catch (err) { console.error('密钥初始化失败：', err.message); process.exit(1) }
