/**
 * R26 / 复核项 3·5：云厂商目录（纯数据，渲染层与 main 共用）——B6/P0-5 经
 * `@sshk/upload-core/types` 零依赖子入口暴露（本文件仍为唯一真相源）。
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
      'oss-cn-nanjing': '华东 5（南京 · 本地地域）',
      'oss-cn-fuzhou': '华东 6（福州 · 本地地域）',
      'oss-cn-wuhan-lr': '华中 1（武汉 · 本地地域）',
      'oss-cn-qingdao': '华北 1（青岛）',
      'oss-cn-beijing': '华北 2（北京）',
      'oss-cn-zhangjiakou': '华北 3（张家口）',
      'oss-cn-huhehaote': '华北 5（呼和浩特）',
      'oss-cn-wulanchabu': '华北 6（乌兰察布）',
      'oss-cn-shenzhen': '华南 1（深圳）',
      'oss-cn-heyuan': '华南 2（河源）',
      'oss-cn-guangzhou': '华南 3（广州）',
      'oss-cn-chengdu': '西南 1（成都）',
      'oss-cn-hongkong': '中国香港',
      'oss-ap-northeast-1': '亚太东北 1（东京）',
      'oss-ap-northeast-2': '亚太东北 2（首尔）',
      'oss-ap-southeast-1': '亚太东南 1（新加坡）',
      'oss-ap-southeast-2': '亚太东南 2（悉尼）',
      'oss-ap-southeast-3': '亚太东南 3（吉隆坡）',
      'oss-ap-southeast-5': '亚太东南 5（雅加达）',
      'oss-ap-southeast-6': '亚太东南 6（马尼拉）',
      'oss-ap-southeast-7': '亚太东南 7（曼谷）',
      'oss-ap-south-1': '亚太南部 1（孟买）',
      'oss-us-west-1': '美国西部 1（硅谷）',
      'oss-us-east-1': '美国东部 1（弗吉尼亚）',
      'oss-eu-central-1': '欧洲中部 1（法兰克福）',
      'oss-eu-west-1': '欧洲西部 1（伦敦）',
      'oss-me-east-1': '中东东部 1（迪拜）',
    }),
    endpoints: cn({
      'oss-cn-hangzhou.aliyuncs.com': '华东 1（杭州）· 公网',
      'oss-cn-shanghai.aliyuncs.com': '华东 2（上海）· 公网',
      'oss-cn-nanjing.aliyuncs.com': '华东 5（南京 · 本地地域）· 公网',
      'oss-cn-fuzhou.aliyuncs.com': '华东 6（福州 · 本地地域）· 公网',
      'oss-cn-wuhan-lr.aliyuncs.com': '华中 1（武汉 · 本地地域）· 公网',
      'oss-cn-qingdao.aliyuncs.com': '华北 1（青岛）· 公网',
      'oss-cn-beijing.aliyuncs.com': '华北 2（北京）· 公网',
      'oss-cn-zhangjiakou.aliyuncs.com': '华北 3（张家口）· 公网',
      'oss-cn-huhehaote.aliyuncs.com': '华北 5（呼和浩特）· 公网',
      'oss-cn-wulanchabu.aliyuncs.com': '华北 6（乌兰察布）· 公网',
      'oss-cn-shenzhen.aliyuncs.com': '华南 1（深圳）· 公网',
      'oss-cn-heyuan.aliyuncs.com': '华南 2（河源）· 公网',
      'oss-cn-guangzhou.aliyuncs.com': '华南 3（广州）· 公网',
      'oss-cn-chengdu.aliyuncs.com': '西南 1（成都）· 公网',
      'oss-cn-hongkong.aliyuncs.com': '中国香港 · 公网',
      'oss-ap-northeast-1.aliyuncs.com': '亚太东北 1（东京）· 公网',
      'oss-ap-northeast-2.aliyuncs.com': '亚太东北 2（首尔）· 公网',
      'oss-ap-southeast-1.aliyuncs.com': '亚太东南 1（新加坡）· 公网',
      'oss-ap-southeast-2.aliyuncs.com': '亚太东南 2（悉尼）· 公网',
      'oss-ap-southeast-3.aliyuncs.com': '亚太东南 3（吉隆坡）· 公网',
      'oss-ap-southeast-5.aliyuncs.com': '亚太东南 5（雅加达）· 公网',
      'oss-ap-southeast-6.aliyuncs.com': '亚太东南 6（马尼拉）· 公网',
      'oss-ap-southeast-7.aliyuncs.com': '亚太东南 7（曼谷）· 公网',
      'oss-ap-south-1.aliyuncs.com': '亚太南部 1（孟买）· 公网',
      'oss-us-west-1.aliyuncs.com': '美国西部 1（硅谷）· 公网',
      'oss-us-east-1.aliyuncs.com': '美国东部 1（弗吉尼亚）· 公网',
      'oss-eu-central-1.aliyuncs.com': '欧洲中部 1（法兰克福）· 公网',
      'oss-eu-west-1.aliyuncs.com': '欧洲西部 1（伦敦）· 公网',
      'oss-me-east-1.aliyuncs.com': '中东东部 1（迪拜）· 公网',
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
      'ap-nanjing': '南京',
      'ap-chengdu': '成都',
      'ap-chongqing': '重庆',
      'ap-hongkong': '中国香港',
      'ap-singapore': '新加坡',
      'ap-tokyo': '东京',
      'ap-seoul': '首尔',
      'ap-bangkok': '曼谷',
      'ap-mumbai': '孟买',
      'ap-jakarta': '雅加达',
      'na-siliconvalley': '美国硅谷',
      'na-ashburn': '美国弗吉尼亚',
      'na-saopaulo': '南美圣保罗',
      'eu-frankfurt': '欧洲法兰克福',
    }),
    endpoints: cn({
      'cos.ap-guangzhou.myqcloud.com': '广州 · 公网',
      'cos.ap-shanghai.myqcloud.com': '上海 · 公网',
      'cos.ap-beijing.myqcloud.com': '北京 · 公网',
      'cos.ap-nanjing.myqcloud.com': '南京 · 公网',
      'cos.ap-chengdu.myqcloud.com': '成都 · 公网',
      'cos.ap-chongqing.myqcloud.com': '重庆 · 公网',
      'cos.ap-hongkong.myqcloud.com': '中国香港 · 公网',
      'cos.ap-singapore.myqcloud.com': '新加坡 · 公网',
      'cos.ap-tokyo.myqcloud.com': '东京 · 公网',
      'cos.ap-seoul.myqcloud.com': '首尔 · 公网',
      'cos.ap-bangkok.myqcloud.com': '曼谷 · 公网',
      'cos.ap-mumbai.myqcloud.com': '孟买 · 公网',
      'cos.ap-jakarta.myqcloud.com': '雅加达 · 公网',
      'cos.na-siliconvalley.myqcloud.com': '美国硅谷 · 公网',
      'cos.na-ashburn.myqcloud.com': '美国弗吉尼亚 · 公网',
      'cos.na-saopaulo.myqcloud.com': '南美圣保罗 · 公网',
      'cos.eu-frankfurt.myqcloud.com': '欧洲法兰克福 · 公网',
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
      'upload-cn-east-2.qiniup.com': '华东 2（浙江）· 上传域名',
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
      'us-east-2': '美国东部（俄亥俄）',
      'us-west-1': '美国西部（加州北部）',
      'us-west-2': '美国西部（俄勒冈）',
      'eu-west-1': '欧洲（爱尔兰）',
      'eu-west-2': '欧洲（伦敦）',
      'eu-central-1': '欧洲（法兰克福）',
      'ap-southeast-1': '亚太（新加坡）',
      'ap-southeast-2': '亚太（悉尼）',
      'ap-northeast-1': '亚太（东京）',
      'ap-northeast-2': '亚太（首尔）',
      'ap-south-1': '亚太（孟买）',
      'ap-east-1': '中国香港',
      'cn-north-1': '中国（北京）',
      auto: '自动（S3 兼容服务）',
    }),
    endpoints: cn({
      's3.amazonaws.com': 'AWS 全局',
      's3.us-east-1.amazonaws.com': '美国东部（弗吉尼亚）',
      's3.us-west-2.amazonaws.com': '美国西部（俄勒冈）',
      's3.eu-west-1.amazonaws.com': '欧洲（爱尔兰）',
      's3.eu-central-1.amazonaws.com': '欧洲（法兰克福）',
      's3.ap-southeast-1.amazonaws.com': '亚太（新加坡）',
      's3.ap-northeast-1.amazonaws.com': '亚太（东京）',
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
      'cn-north-9': '华北 · 乌兰察布一',
      'cn-north-1': '华北 · 北京一',
      'cn-east-3': '华东 · 上海一',
      'cn-east-2': '华东 · 上海二',
      'cn-south-1': '华南 · 广州',
      'cn-south-2': '华南 · 深圳',
      'cn-southwest-2': '西南 · 贵阳一',
      'ap-southeast-1': '亚太 · 中国香港',
      'ap-southeast-3': '亚太 · 新加坡',
    }),
    endpoints: cn({
      'obs.cn-north-4.myhuaweicloud.com': '华北 · 北京四',
      'obs.cn-north-9.myhuaweicloud.com': '华北 · 乌兰察布一',
      'obs.cn-north-1.myhuaweicloud.com': '华北 · 北京一',
      'obs.cn-east-3.myhuaweicloud.com': '华东 · 上海一',
      'obs.cn-east-2.myhuaweicloud.com': '华东 · 上海二',
      'obs.cn-south-1.myhuaweicloud.com': '华南 · 广州',
      'obs.cn-south-2.myhuaweicloud.com': '华南 · 深圳',
      'obs.cn-southwest-2.myhuaweicloud.com': '西南 · 贵阳一',
      'obs.ap-southeast-1.myhuaweicloud.com': '亚太 · 中国香港',
      'obs.ap-southeast-3.myhuaweicloud.com': '亚太 · 新加坡',
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
      bd: '保定',
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
      'bd.bcebos.com': '保定',
      'gz.bcebos.com': '广州',
      'su.bcebos.com': '苏州',
      'sh.bcebos.com': '上海',
      'fwh.bcebos.com': '武汉',
      'hk.bcebos.com': '中国香港',
      'sin.bcebos.com': '新加坡',
      'fsh.bcebos.com': '金融专区（上海）',
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
      eastus2: '美国东部 2',
      westus2: '美国西部 2',
      westus3: '美国西部 3',
      westeurope: '西欧（荷兰）',
      northeurope: '北欧（爱尔兰）',
      southeastasia: '东南亚（新加坡）',
      eastasia: '东亚（中国香港）',
      japaneast: '日本东部（东京）',
      koreacentral: '韩国中部（首尔）',
      chinaeast2: '中国东部 2',
      chinanorth2: '中国北部 2',
      chinanorth3: '中国北部 3',
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
