/**
 * @file constants.ts
 * @description Agent智能生成系统统一常量定义
 */
export const ERROR_MESSAGES = {
  MODEL_NOT_CONFIGED: (stage: string) =>
    `❌ 未配置"${stage}"模型！请在小说工作台或全局配置中设置 ${stage} 阶段的模型（提供商 + 模型ID + API Key）`,
  API_ERROR: (status: number) => `API错误: ${status}`,
  PARSE_ERROR: '解析生成结果失败',
  EMPTY_RESULT: '生成结果为空',
  CHAPTER_NOT_FOUND: '章节不存在',
  VOLUME_NOT_FOUND: '卷不存在',
  SETTING_NOT_FOUND: '设定不存在',
  CHAPTER_CONTENT_EMPTY: '章节内容为空',
  CHAPTER_NOT_FOUND_OR_EMPTY: 'Chapter not found or has no content',
  MODEL_CONFIG_NOT_FOUND: 'Model config not found',
  REPAIR_PRODUCED_EMPTY: 'Repair produced empty content',
  CHAPTER_CONTENT_NOT_FOUND: 'Chapter content not found',
  BATCH_CREATE_PARTIAL: (success: number, total: number) => `批量创建章节完成：${success}/${total} 个章节创建成功`,
  NEXT_CHAPTER_RESULT_INCOMPLETE: '生成结果不完整',
  NEXT_CHAPTER_PARSE_FAILED: '解析生成结果失败',
  NEXT_CHAPTER_API_ERROR: (status: number, text: string) => `API错误: ${status} ${text}`,
  SETTING_SUMMARY_GENERATED: (name: string, length: number) => `Setting summary generated for ${name} (${length} chars)`,
  VECTORIZE_NOT_AVAILABLE: 'Vectorize service not available',
  QUERY_PARAM_REQUIRED: 'Query parameter is required',
  UNKNOWN_TOOL: (name: string) => `Unknown tool: ${name}. Available tools: queryOutline, queryCharacter, searchSemantic`,
  SUMMARY_GENERATED: (chapterId: string, text: string) => `Summary generated for chapter ${chapterId}: ${text.slice(0, 100)}`,
  SUMMARY_FAILED: 'Auto-summary failed (non-critical)',
  COHERENCE_CHECK_FAILED: 'Coherence check failed (non-critical)',
  FORESHADOWING_EXTRACTION_FAILED: 'Foreshadowing extraction failed (non-critical)',
  POWER_LEVEL_DETECTION_FAILED: 'Power level detection failed (non-critical)',
} as const

export const LOG_STYLES = {
  SUCCESS: (msg: string) => console.log(`✅ ${msg}`),
  WARN: (msg: string) => console.warn(`⚠️ ${msg}`),
  ERROR: (msg: string) => console.error(`❌ ${msg}`),
  INFO: (msg: string) => console.log(`ℹ️ ${msg}`),
  TOOL: (name: string, args?: any) => console.log(`🔧 ${name}`, args || ''),
  ITERATION: (i: number, max: number, mode = 'Function Calling Mode') =>
    console.log(`🔄 第${i}轮迭代/${max} (${mode})`),
  ITERATION_COMPLETE: (i: number, contentLen: number, toolCalls: number) =>
    console.log(`✅ 第${i}轮完成 - 内容: ${contentLen} 字符, 工具调用: ${toolCalls} 次`),
  NO_TOOL_CALLS: (i: number) => console.log(`✅ 第${i}轮无工具调用，生成结束`),
  TOOL_EXECUTED: (name: string, resultLen: number) =>
    console.log(`✅ 工具执行完成: ${name}, 结果长度: ${resultLen}`),
  TOOL_FAILED: (name: string, error: any) => console.warn(`❌ 工具执行失败: ${name}`, error),
  MAX_ITERATIONS_REACHED: (max: number, totalTime: number) =>
    console.warn(`⚠️ 达到最大迭代次数 (${max})，停止循环。总耗时: ${totalTime}ms`),
  MAX_TOTAL_TIME_EXCEEDED: (totalTime: number, iterations: number) =>
    console.warn(`⚠️ ReAct循环因总超时停止 (${totalTime}ms)。迭代次数: ${iterations}`),
  FORESHADOWING_RESULT: (newCount: number, resolvedCount: number) =>
    console.log(`📝 伏笔提取: ${newCount} 个新增, ${resolvedCount} 个已解决`),
  POWER_LEVEL_RESULT: (count: number) =>
    console.log(`⚡ 境界突破: 检测到 ${count} 个突破`),
  COHERENCE_RESULT: (issueCount: number) =>
    console.warn(`⚠️ 连贯性检查发现 ${issueCount} 个问题`),
  POST_PROCESS_ENQUEUED: () => console.log('✅ 后处理任务已入队（异步模式）'),
  TASK_QUEUE_UNAVAILABLE: () => console.warn('TASK_QUEUE 不可用，回退到同步后处理模式'),
  CONTEXT_BUILT: (debug: any) => console.log('Context built:', debug),
  CONTEXT_BUILD_FAILED: (error: any) => console.warn('Context building failed, using simple mode:', error),
} as const

export const AGENT_LABELS = {
  SECTION_DIVIDER: '━━━',
  CREATION_TASK: '【创作任务】',
  CONTINUATION_TASK: '【续写任务】',
  REWRITE_TASK: '【重写任务】',
  EXISTING_CONTENT: '【已有内容】',
  CONTENT_TO_REWRITE: '【待改写内容】',
  ISSUES_TO_FIX: '【本次重写需要修复的问题】',
  DATA_PACKAGE: '【本章创作资料包，所有内容均为权威依据】',
  FORCE_REQUIREMENTS: '【强制要求——违反任何一条即为创作失败】',
  WRITING_REQUIREMENTS: '【写作要求】',
  RHYTHM_GUIDANCE: '【节奏把控参考】',
  VOLUME_INFO: '【卷信息】',
  GENERATION_REQUIREMENTS: '【生成要求】',
  EXISTING_CHAPTERS: '【现有章节】',
  ADDITIONAL_CONTEXT: '【补充上下文】',
  CHARACTER_SETTINGS: '【角色设定】',
  CONTENT_TO_CHECK: '【待检查内容】',
  PROBLEMS_FOUND: '【发现的问题】',
  ORIGINAL_CONTENT: '【原文内容】',
  TOOL_USAGE_GUIDE: '【工具使用指南】',
  TOOLS_AVAILABLE: '可用工具：queryOutline / queryCharacter / searchSemantic',
  TOOL_USAGE_FORMAT: '使用方式：{"name": "工具名", "arguments": {...}}',
} as const

// ============================================================
// LLM Prompt 常量（集中管理，避免各文件各写各的）
// ============================================================

/** 通用 JSON 输出系统提示 */
export const JSON_OUTPUT_PROMPT =
  '你是一个专业的JSON生成助手。请严格按照指定格式输出JSON，不要包含任何其他内容。'

/** 章节/总纲/卷摘要：通用摘要系统提示 */
export const SUMMARY_SYSTEM_PROMPT =
  '你是一个专业的文本摘要助手，擅长为小说内容生成简洁准确的摘要。只输出摘要文本本身，不要输出任何解释、标题或格式标记。'

/** 设定摘要专用系统提示 */
export const SETTING_SUMMARY_SYSTEM_PROMPT =
  '你是一个专业的小说世界观设定助手，擅长将冗长的设定描述精炼为语义丰富的短摘要。只输出摘要文本本身（纯文本），不要输出任何解释、标题或格式标记。'

/** 大纲批量生成系统提示 */
export const OUTLINE_BATCH_SYSTEM_PROMPT =
  '你是一个专业的小说大纲助手，擅长构建连贯的章节大纲序列。你只输出JSON，不要其他内容。'

/** 下一章标题/摘要生成系统提示 */
export const NEXT_CHAPTER_SYSTEM_PROMPT =
  '你是一个专业的小说创作助手，擅长生成连贯的章节标题和摘要。你只输出JSON，不要其他内容。'

// ============================================================
// 字数与循环配置
// ============================================================

export const CHAPTER_GEN_DEFAULTS = {
  WORD_COUNT_MIN: 3000,
  WORD_COUNT_MAX: 5000,
  CONTINUATION_WORD_COUNT_TARGET: 2000,
  CONTINUATION_WORD_COUNT_UPPER: 8000,
  REWRITE_WORD_COUNT_MIN: 3000,
  REWRITE_WORD_COUNT_MAX: 5000,
} as const

export const REACT_LOOP_CONFIG = {
  ITERATION_TIMEOUT: 180000,
  MAX_TOTAL_TIME: 300000,
} as const