/**
 * @file providers.ts
 * @description AI模型提供商配置文件，定义支持的LLM提供商和模型列表
 * @version 2.0.0
 * @modified 2026-04-21 - 扩展支持国内外主流大模型提供商
 */
export const PROVIDERS = [
  {
    id: 'baidu',
    name: '百度文心一言',
    apiBase: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
    models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed-8k'],
    keyEnv: 'BAIDU_API_KEY',
  },
  {
    id: 'tencent',
    name: '腾讯混元',
    apiBase: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro'],
    keyEnv: 'TENCENT_API_KEY',
  },
  {
    id: 'aliyun',
    name: '阿里通义千问',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-max-longcontext'],
    keyEnv: 'ALIYUN_API_KEY',
  },
  {
    id: 'volcengine',
    name: '字节火山引擎（豆包）',
    apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-2-pro', 'doubao-pro-32k', 'doubao-lite-32k'],
    keyEnv: 'VOLCENGINE_API_KEY',
  },
  {
    id: 'zhipu',
    name: '智谱AI',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'],
    keyEnv: 'ZHIPU_API_KEY',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    apiBase: 'https://api.minimax.chat/v1',
    models: ['abab6.5-chat', 'abab5.5-chat'],
    keyEnv: 'MINIMAX_API_KEY',
  },
  {
    id: 'moonshot',
    name: '月之暗面（Kimi）',
    apiBase: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyEnv: 'MOONSHOT_API_KEY',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    apiBase: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5'],
    keyEnv: 'SILICONFLOW_API_KEY',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiBase: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    apiBase: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    keyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'anthropic',
    name: 'Anthropic（Claude）',
    apiBase: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    keyEnv: 'GOOGLE_API_KEY',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    apiBase: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-medium', 'mistral-small-latest'],
    keyEnv: 'MISTRAL_API_KEY',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    apiBase: 'https://api.x.ai/v1',
    models: ['grok-beta'],
    keyEnv: 'XAI_API_KEY',
  },
  {
    id: 'groq',
    name: 'Groq',
    apiBase: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
    keyEnv: 'GROQ_API_KEY',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    apiBase: 'https://api.perplexity.ai',
    models: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online'],
    keyEnv: 'PERPLEXITY_API_KEY',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiBase: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o'],
    keyEnv: 'OPENROUTER_API_KEY',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    apiBase: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.1-405b-instruct', 'meta/llama-3.1-70b-instruct'],
    keyEnv: 'NVIDIA_API_KEY',
  },
  {
    id: 'gitee',
    name: '模力方舟',
    apiBase: 'https://ai.gitee.com/v1',
    models: ['Qwen/Qwen2.5-72B-Instruct'],
    keyEnv: 'GITEE_API_KEY',
  },
  {
    id: 'modelscope',
    name: '魔搭社区',
    apiBase: 'https://api-inference.modelscope.cn/v1',
    models: ['qwen/Qwen2.5-72B-Instruct'],
    keyEnv: 'MODELSCOPE_API_KEY',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容接口）',
    apiBase: '',
    models: [],
    keyEnv: 'CUSTOM_API_KEY',
  },
] as const

export type Provider = typeof PROVIDERS[number]

export function getProviderById(id: string): Provider | undefined {
  return PROVIDERS.find(p => p.id === id)
}

export function getDefaultBase(providerId: string): string {
  const provider = getProviderById(providerId)
  return provider?.apiBase || 'https://api.openai.com/v1'
}
