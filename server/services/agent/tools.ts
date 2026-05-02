/**
 * @file tools.ts
 * @description Agent工具定义 v2 — 完全覆盖资料包盲区
 *
 * 设计原则：
 * - 上下文资料包已覆盖的内容，工具不重复（总纲/当前卷/主角/近20章摘要/RAG召回的角色设定伏笔）
 * - 工具价值域 = 资料包盲区：历史章节细节、RAG漏召回的角色/设定、所有伏笔列表、指定角色深度查询
 */

export const AGENT_TOOLS = [

  // ── 工具1：历史章节关键词检索 ────────────────────────────
  {
    type: 'function',
    function: {
      name: 'searchChapterHistory',
      description: `在历史章节摘要中检索包含指定关键词的章节记录。
适用场景：
- 确认某个道具、功法、地点首次出现的章节
- 查找某角色在过去章节中的具体行为或状态
- 确认某件事是否已经在前文发生过
注意：资料包中已有近20章摘要，此工具用于查询更早的历史。`,
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '要搜索的关键词，如角色名、道具名、地点名、事件描述'
          },
          limit: {
            type: 'number',
            description: '返回结果数量，默认8，最大15'
          },
        },
        required: ['keyword'],
      },
    },
  },

  // ── 工具2：精确查询指定角色完整卡片 ─────────────────────
  {
    type: 'function',
    function: {
      name: 'queryCharacterByName',
      description: `按角色名精确查询完整角色卡片，包括描述、属性、境界、别名。
适用场景：
- 资料包"本章出场角色"中没有包含某个角色，但该角色需要在本章出场
- 需要确认某个配角的当前境界或具体属性
- 需要查询某个角色的完整背景设定
注意：主角信息已在资料包"主角状态"中，无需调用此工具查主角。`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '角色名称，支持别名查询'
          },
        },
        required: ['name'],
      },
    },
  },

  // ── 工具3：查询所有开放伏笔列表 ──────────────────────────
  {
    type: 'function',
    function: {
      name: 'queryForeshadowing',
      description: `查询当前未收尾的伏笔列表。
适用场景：
- 资料包"待回收伏笔"只包含部分高优先级伏笔，需要查看是否还有其他open状态的伏笔
- 本章情节涉及某个线索，需要确认是否存在对应的已登记伏笔
- 需要了解当前所有悬而未决的伏笔全貌
注意：资料包已注入高重要性伏笔，此工具用于查询资料包未覆盖的普通伏笔。`,
      parameters: {
        type: 'object',
        properties: {
          importance: {
            type: 'string',
            enum: ['high', 'normal', 'low'],
            description: '按重要性过滤，不传则返回全部open伏笔'
          },
          limit: {
            type: 'number',
            description: '返回数量，默认10，最大20'
          },
        },
        required: [],
      },
    },
  },

  // ── 工具4：按名称精确查询世界设定 ────────────────────────
  {
    type: 'function',
    function: {
      name: 'querySettingByName',
      description: `按设定名称精确查询世界设定的完整内容。
适用场景：
- 资料包"相关世界设定"中某条设定只有摘要，需要查看完整规则细节
- 写到某个具体设定（特定功法、地理、势力规则）时需要确认完整描述
- RAG未能召回某个你知道存在的设定，需要点名查询
注意：境界体系、世界法则等高频设定已在资料包中，只在需要更多细节时调用。`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '设定名称，如"玄灵宗门规"、"天地灵气运转法则"'
          },
        },
        required: ['name'],
      },
    },
  },

  // ── 工具5：语义搜索（兜底） ───────────────────────────────
  {
    type: 'function',
    function: {
      name: 'searchSemantic',
      description: `用自然语言描述搜索相关的角色、设定或伏笔信息。
适用场景：
- 不知道确切名称，但知道大概内容，需要语义模糊搜索
- 前四个工具都无法满足需求时的通用兜底搜索
- 跨类型搜索（同时搜角色+设定）
注意：优先使用前四个精确工具，此工具作为最后手段。`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '用自然语言描述要查找的内容，越具体越好'
          },
          sourceTypes: {
            type: 'array',
            items: { type: 'string', enum: ['character', 'setting', 'foreshadowing'] },
            description: '限定搜索范围，不传则搜全部类型'
          },
          topK: {
            type: 'number',
            description: '返回结果数量，默认5，最大10'
          },
        },
        required: ['query'],
      },
    },
  },

  // ── 工具6：查询内联实体（Slot-10关键词精确匹配层）─────────────────
  {
    type: 'function',
    function: {
      name: 'queryInlineEntity',
      description: `查询前文中已提取的内联实体信息（角色、法宝、功法、地点、道具、势力等）。
适用场景：
- 确认某个法宝/功法/道具的详细信息
- 查询某个地点的描述
- 确认某势力的基本信息
- 在生成新内容前核实已有实体的一致性
注意：此工具返回的是前文自动提取的实体，不包含已手动设定的核心角色和设定。`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '实体名称（精确匹配，如"混沌珠"、"玄天宗"）'
          },
          entityType: {
            type: 'string',
            enum: ['character', 'artifact', 'technique', 'location', 'item', 'faction'],
            description: '实体类型过滤，不传则搜索全部类型'
          },
        },
        required: ['name'],
      },
    },
  },

  // ── 工具7：查询实体状态历史（entity_state_log）─────────────────
  {
    type: 'function',
    function: {
      name: 'queryEntityStateHistory',
      description: `查询某个实体（角色/法宝/功法等）的完整状态变化历史链。
适用场景：
- 确认某法宝的品阶变化历程
- 确认某功法的升级/强化历史
- 确认某角色的境界突破历程
- 在描写实体当前状态前核实历史记录
注意：返回按章节顺序排列的完整状态链。`,
      parameters: {
        type: 'object',
        properties: {
          entityName: {
            type: 'string',
            description: '实体名称（如"林逸"、"混沌珠"）'
          },
          stateType: {
            type: 'string',
            description: '状态类型过滤（如"品阶"、"境界"、"等级"、"熟练度"）'
          },
          limit: {
            type: 'number',
            description: '返回条目数上限，默认10，最大20'
          },
        },
        required: ['entityName'],
      },
    },
  },

  // ── 工具8：查询角色成长记录（character_growth_log）─────────────────
  {
    type: 'function',
    function: {
      name: 'queryCharacterGrowth',
      description: `查询角色的多维度成长记录（能力/社交/知识/情感/战斗/物品/成长性）。
适用场景：
- 确认角色当前的社交关系网络
- 查询角色的知识获取历史
- 确认角色的情感变化轨迹
- 查询角色的物品获得历史
注意：可按维度过滤，返回按章节顺序的成长记录。`,
      parameters: {
        type: 'object',
        properties: {
          characterName: {
            type: 'string',
            description: '角色名称'
          },
          dimension: {
            type: 'string',
            enum: ['ability', 'social', 'knowledge', 'emotion', 'combat', 'possession', 'growth'],
            description: '成长维度过滤（ability=能力, social=社交, knowledge=知识, emotion=情感, combat=战斗, possession=物品, growth=成长性）'
          },
          limit: {
            type: 'number',
            description: '返回条目数上限，默认10，最大20'
          },
        },
        required: ['characterName'],
      },
    },
  },
]
