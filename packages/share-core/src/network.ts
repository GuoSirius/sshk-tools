import { networkInterfaces } from 'node:os'
import type { ShareIpInfo } from '@sshk/shared'

/**
 * 网络域（P6-6 自 index.ts 拆出，§4.3）：本机 IPv4 枚举（虚拟网卡标记）+ 展示 IP 自动优选。
 * IP 策略：0.0.0.0 监听 + 全网卡枚举 + virtual 判定 + 自动优选 + 用户手输展示 IP。
 */

/** 判定网卡是否为虚拟网卡（虚拟机/容器/代理/蓝牙等）——只影响「自动优选」排序与展示标记，不阻止选择。 */
const VIRTUAL_NIC_RE = /vEthernet|VMware|VirtualBox|Loopback|Docker|WSL|TAP|TUN|Tailscale|蓝牙|Bluetooth|Hyper-V|Virtual|VMnet|ireth|Wi-Fi Direct/i

/** 枚举本机 IPv4 候选（含虚拟网卡标记）；不在此处过滤禁用项——UI 需要展示「虚拟但可选」。 */
export function listIps(): ShareIpInfo[] {
  const seen = new Set<string>()
  const result: ShareIpInfo[] = []
  for (const [nic, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal || seen.has(ni.address)) continue
      if (ni.address.startsWith('127.') || ni.address.startsWith('169.254.')) continue
      seen.add(ni.address)
      result.push({ ip: ni.address, nic, virtual: VIRTUAL_NIC_RE.test(nic) })
    }
  }
  // 排序：以太网/WLAN 优先，然后 10.* > 192.168.* > 172.*，其余最后
  const rank = (ip: string): number => ip.startsWith('10.') ? 0 : ip.startsWith('192.168.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  result.sort((a, b) => {
    const an = /以太网|Ethernet|WLAN|Wi-Fi/i.test(a.nic) ? 0 : 1
    const bn = /以太网|Ethernet|WLAN|Wi-Fi/i.test(b.nic) ? 0 : 1
    return an - bn || rank(a.ip) - rank(b.ip)
  })
  return result
}

/** 当前生效的展示 IP：手输优先；否则按 §4.3 规则自动优选。 */
export function displayIpOf(preferredIp: string): string {
  if (preferredIp) return preferredIp
  const ips = listIps().filter((x) => !x.virtual)
  const pick = (prefix: (ip: string) => boolean): string | undefined =>
    ips.find((x) => prefix(x.ip))?.ip
  return pick((ip) => ip.startsWith('10.'))
    ?? pick((ip) => ip.startsWith('192.168.'))
    ?? pick((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
    ?? ips[0]?.ip
    ?? '127.0.0.1'
}
