/**
 * 表单长文案统一常量（CR-31 · P2-4）：CloudProfileForm / RemoteProfileForm 逐字重复的
 * 签名 URL 说明上收；此后两处（迁移后为上传通道页）引用同一份，改口径只动这里。
 */
export const SIGN_URL_HINT =
  '视频/音频预览优先用「访问域名 + 文件路径」直链，免下载。若直链需签名鉴权，在此填模板，用 {url} 占位符代表拼好的原始直链（如 https://cdn/x?token=abc&src={url}）。留空则直接用裸链。签名过期导致播放失败时会自动回退为下载后播放。'
