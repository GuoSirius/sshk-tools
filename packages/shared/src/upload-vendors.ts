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
  /** 真实写入配置、交给 SDK 的值（地域 ID / Endpoint） */
  value: string
  /** 下拉展示名：地域优先中文名，Endpoint 一般就是域名本身 */
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

/**
 * 复核项 N9：地域下拉优先中文名。
 * key 必须是厂商 SDK 认可的真实地域 ID（写进配置），value 是给使用者看的中文名。
 * 下拉同时保留 ID 副标题与 ID 搜索，避免「中文好认但查不到 / 复制不了」。
 */
const cn = (entries: Record<string, string>): UploadVendorChoice[] =>
  Object.entries(entries).map(([value, label]) => ({ value, label }))

export const UPLOAD_CLOUD_VENDORS: readonly UploadVendorMeta[] = [
  {
    id: 'aliyun-oss',
    label: '阿里云 OSS',
    sdk: 'ali-oss',
    regions: cn({
      'oss-cn-hangzhou': '华东 1（杭州）',
      'oss-cn-shanghai': '华东 2（上海）',
      'oss-cn-beijing': '华北 2（北京）',
      'oss-cn-shenzhen': '华南 3（深圳）',
      'oss-cn-guangzhou': '华南 1（广州）',
      'oss-cn-chengdu': '西南 1（成都）',
      'oss-cn-hongkong': '中国香港',
      'oss-ap-southeast-1': '亚太东南 1（新加坡）',
      'oss-us-west-1': '美国西部 1（硅谷）',
    }),
    endpoints: cn({
      'oss-cn-hangzhou.aliyuncs.com': '华东 1（杭州）· 公网',
      'oss-cn-shanghai.aliyuncs.com': '华东 2（上海）· 公网',
      'oss-cn-beijing.aliyuncs.com': '华北 2（北京）· 公网',
      'oss-cn-shenzhen.aliyuncs.com': '华南 3（深圳）· 公网',
      'oss-ap-southeast-1.aliyuncs.com': '亚太东南 1（新加坡）· 公网',
    }),
    regionHint: '按中文名选地域即可，实际写入的是标准地域 ID；也可直接手输内网/金融云地域',
    endpointHint: '可选；留空由 SDK 按地域推导，VPC 内网可手输',
  },
  {
    id: 'tencent-cos',
    label: '腾讯云 COS',
    sdk: 'cos-nodejs-sdk-v5',
    regions: cn({
      'ap-guangzhou': '广州',
      'ap-shanghai': '上海',
      'ap-beijing': '北京',
      'ap-chengdu': '成都',
      'ap-chongqing': '重庆',
      'ap-nanjing': '南京',
      'ap-hongkong': '中国香港',
      'ap-singapore': '新加坡',
      'na-siliconvalley': '美国硅谷',
      'eu-frankfurt': '欧洲法兰克福',
    }),
    endpoints: cn({
      'cos.ap-guangzhou.myqcloud.com': '广州 · 公网',
      'cos.ap-shanghai.myqcloud.com': '上海 · 公网',
      'cos.ap-beijing.myqcloud.com': '北京 · 公网',
      'cos.ap-hongkong.myqcloud.com': '中国香港 · 公网',
    }),
    regionHint: '按中文名选地域即可，实际写入的是标准地域 ID；也可直接手输新开地域',
    endpointHint: '可选；CDN / 自定义域名可手输',
  },
  {
    id: 'qiniu',
    label: '七牛云 Kodo',
    sdk: 'qiniu',
    regions: cn({
      z0: '华东',
      z1: '华北',
      z2: '华南',
      na0: '北美',
      as0: '东南亚',
      'cn-east-2': '华东 2（浙江）',
    }),
    endpoints: cn({
      'upload.qiniup.com': '华东 · 上传域名',
      'upload-z1.qiniup.com': '华北 · 上传域名',
      'upload-z2.qiniup.com': '华南 · 上传域名',
      'upload-na0.qiniup.com': '北美 · 上传域名',
      'upload-as0.qiniup.com': '东南亚 · 上传域名',
    }),
    regionHint: '按中文名选存储区域即可；也可直接手输新区域 ID',
    endpointHint: '上传域名；留空按区域推导',
  },
  {
    id: 'aws-s3',
    label: 'AWS S3 / S3 兼容（MinIO、R2…）',
    sdk: '@aws-sdk/client-s3',
    regions: cn({
      'us-east-1': '美国东部（弗吉尼亚）',
      'us-west-2': '美国西部（俄勒冈）',
      'eu-west-1': '欧洲（爱尔兰）',
      'eu-central-1': '欧洲（法兰克福）',
      'ap-southeast-1': '亚太（新加坡）',
      'ap-northeast-1': '亚太（东京）',
      'ap-east-1': '中国香港',
      'cn-north-1': '中国（北京）',
      auto: '自动（S3 兼容服务）',
    }),
    endpoints: cn({
      's3.amazonaws.com': 'AWS 全局',
      's3.us-east-1.amazonaws.com': '美国东部（弗吉尼亚）',
      's3.ap-southeast-1.amazonaws.com': '亚太（新加坡）',
      'play.min.io': 'MinIO 公共测试服务',
      '<accountid>.r2.cloudflarestorage.com': 'Cloudflare R2（替换 accountid）',
    }),
    regionHint: '按中文名选地域；S3 兼容服务可选「自动」或直接手输',
    endpointHint: 'S3 兼容（MinIO / R2 / 私有对象存储）必填完整 http(s) 地址',
  },
  {
    id: 'huawei-obs',
    label: '华为云 OBS',
    sdk: 'esdk-obs-nodejs',
    regions: cn({
      'cn-north-4': '华北 · 北京四',
      'cn-north-1': '华北 · 北京一',
      'cn-east-3': '华东 · 上海一',
      'cn-east-2': '华东 · 上海二',
      'cn-south-1': '华南 · 广州',
      'cn-southwest-2': '西南 · 贵阳一',
      'ap-southeast-1': '亚太 · 新加坡',
    }),
    endpoints: cn({
      'obs.cn-north-4.myhuaweicloud.com': '华北 · 北京四',
      'obs.cn-north-1.myhuaweicloud.com': '华北 · 北京一',
      'obs.cn-east-3.myhuaweicloud.com': '华东 · 上海一',
      'obs.cn-south-1.myhuaweicloud.com': '华南 · 广州',
    }),
    regionHint: '按中文名选区域即可；也可直接手输新开区域',
    endpointHint: '必填 OBS 服务地址（含 https:// 前缀）',
    endpointRequired: true,
  },
  {
    id: 'baidu-bos',
    label: '百度智能云 BOS',
    sdk: 'bce-sdk-js',
    regions: cn({
      bj: '北京',
      gz: '广州',
      su: '苏州',
      sh: '上海',
      fwh: '武汉',
      hk: '中国香港',
      sin: '新加坡',
      fsh: '金融专区（上海）',
    }),
    endpoints: cn({
      'bj.bcebos.com': '北京',
      'gz.bcebos.com': '广州',
      'su.bcebos.com': '苏州',
      'sh.bcebos.com': '上海',
      'hk.bcebos.com': '中国香港',
    }),
    regionHint: '按中文名选地域即可；也可直接手输新地域',
    endpointHint: '必填 BOS 服务域名（含 https:// 前缀）',
    endpointRequired: true,
  },
  {
    id: 'azure-blob',
    label: '微软 Azure Blob 存储',
    sdk: '@azure/storage-blob',
    regions: cn({
      eastus: '美国东部',
      westus2: '美国西部 2',
      westeurope: '西欧',
      southeastasia: '东南亚（新加坡）',
      chinaeast2: '中国东部 2',
      chinanorth2: '中国北部 2',
    }),
    endpoints: cn({
      'https://<account>.blob.core.windows.net': 'Azure 全球（替换 account）',
      'https://<account>.blob.core.chinacloudapi.cn': 'Azure 中国（替换 account）',
    }),
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
