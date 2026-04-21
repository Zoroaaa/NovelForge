/**
 * @file providers.ts
 * @description AI模型提供商配置文件，定义支持的LLM提供商
 * @version 2.1.0
 * @modified 2026-04-21 - 简化配置，只保留提供商名称和API地址
 */
export const PROVIDERS = [
  { id: 'baidu', name: '百度文心一言', apiBase: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop' },
  { id: 'tencent', name: '腾讯混元', apiBase: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'aliyun', name: '阿里通义千问', apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'volcengine', name: '字节火山引擎（豆包）', apiBase: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'zhipu', name: '智谱AI', apiBase: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'minimax', name: 'MiniMax', apiBase: 'https://api.minimax.chat/v1' },
  { id: 'moonshot', name: '月之暗面（Kimi）', apiBase: 'https://api.moonshot.cn/v1' },
  { id: 'siliconflow', name: '硅基流动', apiBase: 'https://api.siliconflow.cn/v1' },
  { id: 'deepseek', name: 'DeepSeek', apiBase: 'https://api.deepseek.com/v1' },
  { id: 'openai', name: 'OpenAI', apiBase: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic（Claude）', apiBase: 'https://api.anthropic.com/v1' },
  { id: 'google', name: 'Google Gemini', apiBase: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'mistral', name: 'Mistral AI', apiBase: 'https://api.mistral.ai/v1' },
  { id: 'xai', name: 'xAI Grok', apiBase: 'https://api.x.ai/v1' },
  { id: 'groq', name: 'Groq', apiBase: 'https://api.groq.com/openai/v1' },
  { id: 'perplexity', name: 'Perplexity', apiBase: 'https://api.perplexity.ai' },
  { id: 'openrouter', name: 'OpenRouter', apiBase: 'https://openrouter.ai/api/v1' },
  { id: 'nvidia', name: 'NVIDIA', apiBase: 'https://integrate.api.nvidia.com/v1' },
  { id: 'gitee', name: '模力方舟', apiBase: 'https://ai.gitee.com/v1' },
  { id: 'modelscope', name: '魔搭社区', apiBase: 'https://api-inference.modelscope.cn/v1' },
  { id: 'custom', name: '自定义（OpenAI 兼容接口）', apiBase: '' },
] as const

export type Provider = typeof PROVIDERS[number]

export function getProviderById(id: string): Provider | undefined {
  return PROVIDERS.find(p => p.id === id)
}

export function getDefaultBase(providerId: string): string {
  return getProviderById(providerId)?.apiBase || 'https://api.openai.com/v1'
}
