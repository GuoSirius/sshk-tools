import { describe, expect, it } from 'vitest'
import {
  UPLOAD_CLOUD_VENDORS,
  UPLOAD_CLOUD_VENDOR_IDS,
  isUploadCloudVendor,
  uploadVendorMeta,
  uploadVendorOptions,
} from './upload-vendors'

describe('云厂商目录（地域中文名 / 真实 ID 分离）', () => {
  it('7 家厂商全部有中文 label 且与 id 一一对应', () => {
    expect(UPLOAD_CLOUD_VENDORS).toHaveLength(UPLOAD_CLOUD_VENDOR_IDS.length)
    expect(UPLOAD_CLOUD_VENDORS.map((v) => v.id)).toEqual([...UPLOAD_CLOUD_VENDOR_IDS])
    for (const v of UPLOAD_CLOUD_VENDORS) {
      expect(v.label).toMatch(/[\u4e00-\u9fa5]/)
      expect(v.sdk).toBeTruthy()
    }
    expect(uploadVendorOptions().every((o) => o.label !== o.value)).toBe(true)
  })

  it('每个地域 / Endpoint 的 label 是中文说明，value 仍是 SDK 认可的真实值', () => {
    for (const v of UPLOAD_CLOUD_VENDORS) {
      for (const r of v.regions) {
        expect(r.value).toBeTruthy()
        expect(r.label).not.toBe(r.value) // 不再把一长串 ID 直接当展示名
        expect(/^[a-z0-9<>.:/-]+$/i.test(r.value)).toBe(true)
      }
      for (const e of v.endpoints) {
        expect(e.value).toBeTruthy()
        expect(e.label).not.toBe(e.value)
      }
      // 中文名与真实值都不重复，避免下拉里出现两个看起来一样的项
      expect(new Set(v.regions.map((r) => r.value)).size).toBe(v.regions.length)
      expect(new Set(v.regions.map((r) => r.label)).size).toBe(v.regions.length)
    }
  })

  it('常见地域的中文名可读，且真实 ID 保持标准写法', () => {
    const ali = uploadVendorMeta('aliyun-oss')
    expect(ali.regions.find((r) => r.value === 'oss-cn-hangzhou')?.label).toBe('华东 1（杭州）')
    expect(ali.regions.find((r) => r.value === 'oss-cn-hongkong')?.label).toBe('中国香港')
    const tx = uploadVendorMeta('tencent-cos')
    expect(tx.regions.find((r) => r.value === 'ap-guangzhou')?.label).toBe('广州')
    expect(uploadVendorMeta('aws-s3').regions.some((r) => r.value === 'auto')).toBe(true)
    expect(uploadVendorMeta('baidu-bos').endpointRequired).toBe(true)
  })

  it('未知厂商回退到第一家，非法 id 被类型守卫拒绝', () => {
    expect(uploadVendorMeta('not-exist').id).toBe('aliyun-oss')
    expect(isUploadCloudVendor('qiniu')).toBe(true)
    expect(isUploadCloudVendor('qiniu-cloud')).toBe(false)
  })
})
