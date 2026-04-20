/**
 * NovelForge · Vision 视觉分析服务
 *
 * 支持功能：
 * - 角色图片上传到 R2 存储
 * - 使用 Cloudflare Workers AI 视觉模型分析图片
 * - 自动生成角色描述（外貌、气质、特征等）
 */

import type { Env } from '../lib/types'

export interface ImageAnalysisResult {
  description: string       // AI 生成的详细描述
  appearance: string        // 外貌特征
  traits: string[]          // 性格推断
  tags: string[]            // 标签
  confidence: number         // 置信度 (0-1)
}

export interface UploadResult {
  url: string                // R2 公开访问 URL
  key: string               // R2 对象键
  analysis?: ImageAnalysisResult  // 可选的AI分析结果
}

const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf'

/**
 * 上传图片到 R2 并可选进行视觉分析
 */
async function uploadToR2(
  env: Env,
  imageBuffer: ArrayBuffer,
  contentType: string,
  novelId: string,
  characterId: string
): Promise<{ url: string; key: string }> {
  if (!env.STORAGE) {
    throw new Error('R2 storage binding not configured')
  }

  // 生成唯一文件名
  const timestamp = Date.now()
  const ext = contentType.split('/')[1] || 'png'
  const key = `characters/${novelId}/${characterId}_${timestamp}.${ext}`

  // 上传到 R2
  await env.STORAGE.put(key, imageBuffer, {
    httpMetadata: {
      contentType,
    },
  })

  // 构建公开访问 URL（假设 bucket 已配置公开访问）
  const url = `https://pub-${env.STORAGE.bucketName}.${env.STORAGE.accountId}.r2.dev/${key}`

  return { url, key }
}

/**
 * 使用 LLaVA 视觉模型分析图片
 *
 * 针对角色图片，使用专门的 prompt 提取：
 * - 外貌描述（发型、五官、体型、服饰）
 * - 气质特征（冷峻、温柔、霸气等）
 * - 可能的性格标签
 */
export async function analyzeCharacterImage(
  env: Env,
  imageBuffer: ArrayBuffer,
  options: {
    characterName?: string
    role?: string
  } = {}
): Promise<ImageAnalysisResult> {
  if (!env.AI) {
    throw new Error('Workers AI binding not configured')
  }

  try {
    // 将 ArrayBuffer 转换为 base64
    const base64Image = arrayBufferToBase64(imageBuffer)

    // 构建 prompt（针对角色分析的优化提示词）
    const prompt = buildAnalysisPrompt(options.characterName, options.role)

    // 调用 LLaVA 模型
    const result = await env.AI.run(VISION_MODEL, {
      image: base64Image,
      prompt: prompt,
      max_tokens: 500,
    })

    const responseText = (result as any)?.response || ''

    // 解析响应，提取结构化信息
    return parseVisionResponse(responseText, options.characterName)
  } catch (error) {
    console.error('Vision analysis failed:', error)
    throw new Error(`视觉分析失败: ${(error as Error).message}`)
  }
}

/**
 * 完整流程：上传 + 分析
 */
export async function uploadAndAnalyzeImage(
  env: Env,
  imageFile: File | Blob,
  novelId: string,
  characterId: string,
  options: {
    characterName?: string
    role?: string
    skipAnalysis?: boolean
  } = {}
): Promise<UploadResult> {
  // 1. 转换为 ArrayBuffer
  const buffer = await fileToArrayBuffer(imageFile)
  const contentType = imageFile.type || 'image/png'

  // 2. 上传到 R2
  const uploadResult = await uploadToR2(env, buffer, contentType, novelId, characterId)

  // 3. 可选：进行视觉分析
  let analysis: ImageAnalysisResult | undefined
  if (!options.skipAnalysis && env.AI) {
    try {
      analysis = await analyzeCharacterImage(env, buffer, {
        characterName: options.characterName,
        role: options.role,
      })
    } catch (error) {
      console.warn('Image analysis failed (non-critical):', error)
      // 分析失败不影响上传结果
    }
  }

  return {
    ...uploadResult,
    analysis,
  }
}

// ========== 内部工具函数 ==========

/**
 * 构建针对角色图片的分析提示词
 */
function buildAnalysisPrompt(characterName?: string, role?: string): string {
  const namePart = characterName ? `角色名：${characterName}` : ''
  const rolePart = role ? `角色定位：${role === 'protagonist' ? '主角' : role === 'antagonist' ? '反派' : '配角'}` : ''

  return `${namePart}${rolePart ? '\n' + rolePart : ''}

请仔细观察这张角色图片，用中文详细描述以下内容：

1. **外貌特征**：发型、发色、眼睛、面部轮廓、体型、身高印象、穿着风格等
2. **气质特点**：给人的整体感觉（如冷峻、温暖、神秘、阳光、阴郁等）
3. **性格推测**：从外貌和表情推测可能的性格特征
4. **标签**：3-5个关键词标签（如"高冷男神"、"古风美人"、"热血少年"等）

请以 JSON 格式返回：
{
  "description": "完整的外貌描述段落（100-200字）",
  "appearance": "外貌要点总结（50字以内）",
  "traits": ["性格特征1", "性格特征2", ...],
  "tags": ["标签1", "标签2", ...]
}`
}

/**
 * 解析视觉模型的响应文本
 */
function parseVisionResponse(
  responseText: string,
  characterName?: string
): ImageAnalysisResult {
  try {
    // 尝试提取 JSON 部分
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        description: parsed.description || responseText,
        appearance: parsed.appearance || '',
        traits: Array.isArray(parsed.traits) ? parsed.traits : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        confidence: 0.85,
      }
    }

    // 如果无法解析JSON，将整个响应作为描述
    return {
      description: responseText,
      appearance: '',
      traits: [],
      tags: [],
      confidence: 0.6,
    }
  } catch (error) {
    console.warn('Failed to parse vision response:', error)
    return {
      description: responseText,
      appearance: '',
      traits: [],
      tags: [],
      confidence: 0.5,
    }
  }
}

/**
 * File/Blob 转 ArrayBuffer
 */
async function fileToArrayBuffer(file: File | Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

/**
 * ArrayBuffer 转 Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
