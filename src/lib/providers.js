export const PROVIDERS = [
    {
        id: 'volcengine',
        name: '火山引擎（豆包）',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        models: ['doubao-seed-2-pro', 'doubao-pro-32k', 'doubao-lite-32k'],
        keyEnv: 'VOLCENGINE_API_KEY',
    },
    {
        id: 'anthropic',
        name: 'Anthropic（Claude）',
        apiBase: 'https://api.anthropic.com/v1',
        models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
        keyEnv: 'ANTHROPIC_API_KEY',
    },
    {
        id: 'openai',
        name: 'OpenAI',
        apiBase: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini'],
        keyEnv: 'OPENAI_API_KEY',
    },
    {
        id: 'custom',
        name: '自定义（OpenAI 兼容接口）',
        apiBase: '',
        models: [],
        keyEnv: 'CUSTOM_API_KEY',
    },
];
