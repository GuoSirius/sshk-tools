/**
 * R26 / 复核项 3·5：云厂商目录（纯数据，渲染层与 main 共用）。
 *
 * 单一事实源：厂商清单、SDK 包名、预置地域 / Endpoint 都在这里。
 * 下拉用「可选可输」（filterable + allow-create），预置项不存在时用户可直接手输，
 * 不因为清单不全而把用户卡住。
 *
 * 注意：这里不放任何 SDK import —— 渲染层绝不能被拖进 Node 侧依赖。
 */
export const UPLOAD_CLOUD_VENDOR_IDS = [
  'aliyun-oss',
  'tencent-cos',
  'qiniu',
  'aws-s3',
  'huawei-obs',
  'baidu-bos',
  'azure-blob',
] as const

export type UploadCloudVendor = (typeof UPLOAD_CLOUD_VENDOR_IDS)[number]

export interface UploadVendorChoice {
  value: string
  label: string
}

export interface UploadVendorMeta {
  id: UploadCloudVendor
  label: string
  /** 运行时按需加载的 npm 包；未安装时给出明确提示，不影响其他厂商 */
  sdk: string
  /** 常见地域（可手输补充） */
  regions: UploadVendorChoice[]
  /** 常见 Endpoint（可手输补充） */
  endpoints: UploadVendorChoice[]
  regionHint: string
  endpointHint: string
  /** 该厂商必须显式给 Endpoint（如 S3 兼容 / Azure / OBS） */
  endpointRequired?: boolean
}

const opts = (...values: string[]): UploadVendorChoice[] =>
  values.map((v) => ({ value: v, label: v }))

export const UPLOAD_CLOUD_VENDORS: readonly UploadVendorMeta[] = [
  {
    id: 'aliyun-oss',
    label: '阿里云 OSS',
    sdk: 'ali-oss',
    regions: opts('oss-cn-hangzhou', 'oss-cn-shanghai', 'oss-cn-beijing', 'oss-cn-shenzhen', 'oss-cn-guangzhou', 'oss-cn-chengdu', 'oss-cn-hongkong', 'oss-ap-southeast-1', 'oss-us-west-1'),
    endpoints: opts('oss-cn-hangzhou.aliyuncs.com', 'oss-cn-shanghai.aliyuncs.com', 'oss-cn-beijing.aliyuncs.com', 'oss-cn-shenzhen.aliyuncs.com', 'oss-ap-southeast-1.aliyuncs.com'),
    regionHint: '如 oss-cn-hangzhou；也可直接手输内网/金融云地域',
    endpointHint: '可选；留空由 SDK 按地域推导，VPC 内网可手输',
  },
  {
    id: 'tencent-cos',
    label: '腾讯云 COS',
    sdk: 'cos-nodejs-sdk-v5',
    regions: opts('ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-chengdu', 'ap-chongqing', 'ap-nanjing', 'ap-hongkong', 'ap-singapore', 'na-siliconvalley', 'eu-frankfurt'),
    endpoints: opts('cos.ap-guangzhou.myqcloud.com', 'cos.ap-shanghai.myqcloud.com', 'cos.ap-beijing.myqcloud.com', 'cos.ap-hongkong.myqcloud.com'),
    regionHint: '如 ap-guangzhou；也可直接手输新开地域',
    endpointHint: '可选；CDN / 自定义域名可手输',
  },
  {
    id: 'qiniu',
    label: '七牛云 Kodo',
    sdk: 'qiniu',
    regions: opts('z0', 'z1', 'z2', 'na0', 'as0', 'cn-east-2'),
    endpoints: opts('upload.qiniup.com', 'upload-z1.qiniup.com', 'upload-z2.qiniup.com', 'upload-na0.qiniup.com', 'upload-as0.qiniup.com'),
    regionHint: '存储区域：z0 华东 / z1 华北 / z2 华南 / na0 北美 / as0 东南亚',
    endpointHint: '上传域名；留空按区域推导',
  },
  {
    id: 'aws-s3',
    label: 'AWS S3 / S3 兼容（MinIO、R2…）',
    sdk: '@aws-sdk/client-s3',
    regions: opts('us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-east-1', 'cn-north-1', 'auto'),
    endpoints: opts('s3.amazonaws.com', 's3.us-east-1.amazonaws.com', 's3.ap-southeast-1.amazonaws.com', 'play.min.io', '<accountid>.r2.cloudflarestorage.com'),
    regionHint: 'AWS 填标准 region；S3 兼容服务可填 auto 或任意值',
    endpointHint: 'S3 兼容（MinIO / R2 / 私有对象存储）必填完整 http(s) 地址',
  },
  {
    id: 'huawei-obs',
    label: '华为云 OBS',
    sdk: 'esdk-obs-nodejs',
    regions: opts('cn-north-4', 'cn-north-1', 'cn-east-3', 'cn-east-2', 'cn-south-1', 'cn-southwest-2', 'ap-southeast-1'),
    endpoints: opts('obs.cn-north-4.myhuaweicloud.com', 'obs.cn-north-1.myhuaweicloud.com', 'obs.cn-east-3.myhuaweicloud.com', 'obs.cn-south-1.myhuaweicloud.com'),
    regionHint: '如 cn-north-4（北京四）；也可直接手输新开区域',
    endpointHint: '必填 OBS 服务地址（含 https:// 前缀）',
    endpointRequired: true,
  },
  {
    id: 'baidu-bos',
    label: '百度智能云 BOS',
    sdk: 'bce-sdk-js',
    regions: opts('bj', 'gz', 'su', 'sh', 'fwh', 'hk', 'sin', 'fsh'),
    endpoints: opts('bj.bcebos.com', 'gz.bcebos.com', 'su.bcebos.com', 'sh.bcebos.com', 'hk.bcebos.com'),
    regionHint: '如 bj（北京）/ gz（广州）/ su（苏州）',
    endpointHint: '必填 BOS 服务域名（含 https:// 前缀）',
    endpointRequired: true,
  },
  {
    id: 'azure-blob',
    label: 'Azure Blob Storage',
    sdk: '@azure/storage-blob',
    regions: opts('eastus', 'westus2', 'westeurope', 'southeastasia', 'chinaeast2', 'chinanorth2'),
    endpoints: opts('https://<account>.blob.core.windows.net', 'https://<account>.blob.core.chinacloudapi.cn'),
    regionHint: '仅作标记，SDK 实际用 Endpoint 定位；可手输任意值',
    endpointHint: '必填账户 URL；AccessKey ID 填账户名、Secret 填账户密钥',
    endpointRequired: true,
  },
]

export function isUploadCloudVendor(v: unknown): v is UploadCloudVendor {
  return typeof v === 'string' && (UPLOAD_CLOUD_VENDOR_IDS as readonly string[]).includes(v)
}

export function uploadVendorMeta(id: unknown): UploadVendorMeta {
  return UPLOAD_CLOUD_VENDORS.find((v) => v.id === id) ?? UPLOAD_CLOUD_VENDORS[0]!
}

export function uploadVendorOptions(): UploadVendorChoice[] {
  return UPLOAD_CLOUD_VENDORS.map((v) => ({ value: v.id, label: v.label }))
}
