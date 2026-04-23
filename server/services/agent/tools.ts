/**
 * @file tools.ts
 * @description Agent智能生成系统工具定义
 */

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'queryOutline',
      description: '查询小说大纲内容，用于获取世界观、卷纲、章节大纲等信息。在需要了解整体剧情走向或特定部分设定时调用。',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '小说ID' },
          type: {
            type: 'string',
            enum: ['world_setting', 'volume', 'chapter_outline', 'arc', 'custom'],
            description: '大纲类型筛选：world_setting(世界观)/volume(卷纲)/chapter_outline(章节大纲)/arc(故事线)/custom(自定义)'
          },
        },
        required: ['novelId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryCharacter',
      description: '查询角色信息，包括角色设定、属性、背景故事等。在需要了解角色详情或确保角色一致性时调用。',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '小说ID' },
          role: {
            type: 'string',
            enum: ['protagonist', 'antagonist', 'supporting'],
            description: '角色类型筛选：protagonist(主角)/antagonist(反派)/supporting(配角)'
          },
        },
        required: ['novelId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchSemantic',
      description: '语义搜索相关文档，通过自然语言描述查找相关的历史内容、世界观片段等。在需要查找特定信息或参考之前的内容时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索描述，用自然语言描述你要查找的内容' },
          novelId: { type: 'string', description: '小说ID' },
          topK: { type: 'number', description: '返回结果数量，默认5，最大10' },
        },
        required: ['query', 'novelId'],
      },
    },
  },
]
