/**
 * @file imageGen.ts
 * @description AI封面图生成服务，调用图像生成模型API生成小说封面
 * @version 1.1.0
 */
import { drizzle } from 'drizzle-orm/d1'
import { novels, characters, masterOutline } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { resolveConfig, getDefaultBase } from './llm'
import type { Env } from '../lib/types'

interface CoverGenResult {
  success: boolean
  r2Key?: string
  error?: string
}

const SUPPORTED_SIZES = [
  '1024x1024', '1024x1536', '1536x1024',
  '512x512', '768x1024', '1024x768',
]

export async function generateCover(env: Env, novelId: string): Promise<CoverGenResult> {
  const db = drizzle(env.DB)

  const novel = await db.select().from(novels).where(eq(novels.id, novelId)).get()
  if (!novel) {
    return { success: false, error: '小说不存在' }
  }

  const config = await resolveConfig(db, 'image_gen', novelId).catch(() => null)
  if (!config) {
    return { success: false, error: '未配置 image_gen 模型，请在模型配置中添加图像生成模型' }
  }

  const prompt = await buildCoverPrompt(db, novelId, novel.title, novel.description, novel.genre)

  const base = config.apiBase || getDefaultBase(config.provider)
  const endpoint = `${base}/images/generations`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (config.provider === 'google') {
    headers['x-goog-api-key'] = config.apiKey
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const imageSize = (config.params as any)?.imageSize || '1024x1536'
  const safeSize = SUPPORTED_SIZES.includes(imageSize) ? imageSize : '1024x1536'

  const body = JSON.stringify({
    model: config.modelId,
    prompt,
    size: safeSize,
    n: 1,
  })

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    })
  } catch (fetchError) {
    console.error('[imageGen] Network error:', fetchError)
    return { success: false, error: '图像生成API网络请求失败，请检查网络连接和API地址' }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    console.error(`[imageGen] API error: ${response.status} ${errorText}`)
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'API认证失败，请检查API Key是否正确' }
    }
    if (response.status === 404) {
      return { success: false, error: '图像生成API端点不存在，请检查API地址和模型ID' }
    }
    return { success: false, error: `图像生成API调用失败 (HTTP ${response.status})` }
  }

  const result = await response.json() as any
  const imageUrl = result.data?.[0]?.url
    || result.output?.[0]?.url
    || result.images?.[0]?.url
    || result.url

  let imageBuffer: ArrayBuffer

  if (imageUrl) {
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      return { success: false, error: '下载生成的图片失败' }
    }
    imageBuffer = await imageResponse.arrayBuffer()
  } else if (result.data?.[0]?.b64_json) {
    imageBuffer = Uint8Array.from(atob(result.data[0].b64_json), c => c.charCodeAt(0)).buffer
  } else {
    return { success: false, error: '图像生成API未返回图片URL或base64数据' }
  }

  if (imageBuffer.byteLength === 0) {
    return { success: false, error: '生成的图片数据为空' }
  }

  const r2Key = `covers/${novelId}/${Date.now()}.jpg`

  if (novel.coverR2Key) {
    try { await env.STORAGE.delete(novel.coverR2Key) } catch { /* ignore if old cover doesn't exist */ }
  }

  await env.STORAGE.put(r2Key, imageBuffer, {
    httpMetadata: { contentType: 'image/jpeg' },
  })

  await db.update(novels)
    .set({ coverR2Key: r2Key, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(novels.id, novelId))

  return { success: true, r2Key }
}

async function buildCoverPrompt(
  db: ReturnType<typeof drizzle>,
  novelId: string,
  title: string,
  description: string | null,
  genre: string | null,
): Promise<string> {
  const parts: string[] = []

  const genreStyleMap: Record<string, string> = {
    '玄幻': 'Chinese fantasy xianxia style, ethereal mountains, spiritual energy, cultivation elements, dramatic lighting',
    '仙侠': 'Chinese immortal hero style, floating islands, sword energy, misty peaks, celestial atmosphere',
    '都市': 'Modern urban cityscape style, neon lights, contemporary architecture, cinematic mood',
    '科幻': 'Science fiction style, futuristic technology, space/cyberpunk elements, holographic effects',
    '历史': 'Historical Chinese painting style, ancient architecture, traditional costumes, ink wash influence',
    '悬疑': 'Mystery thriller style, dark moody atmosphere, shadows and light contrast, enigmatic elements',
    '言情': 'Romantic soft style, warm colors, dreamy atmosphere, elegant composition',
  }

  if (genre && genreStyleMap[genre]) {
    parts.push(`Art style: ${genreStyleMap[genre]}`)
  } else {
    parts.push('Art style: Epic fantasy book cover, cinematic, dramatic lighting, highly detailed')
  }

  parts.push(`Book title: "${title}"`)
  parts.push('The title text should be elegantly integrated into the cover design')

  if (description) {
    const shortDesc = description.length > 200 ? description.slice(0, 200) + '...' : description
    parts.push(`Story theme: ${shortDesc}`)
  }

  const protagonist = await db.select({ name: characters.name, description: characters.description })
    .from(characters)
    .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist')))
    .limit(1)
    .get()

  if (protagonist) {
    const charDesc = protagonist.description
      ? protagonist.description.slice(0, 150)
      : ''
    parts.push(`Main character: ${protagonist.name}${charDesc ? ', ' + charDesc : ''}`)
  }

  const outline = await db.select({ summary: masterOutline.summary })
    .from(masterOutline)
    .where(eq(masterOutline.novelId, novelId))
    .orderBy(desc(masterOutline.version))
    .limit(1)
    .get()

  if (outline?.summary) {
    const shortSummary = outline.summary.length > 150 ? outline.summary.slice(0, 150) + '...' : outline.summary
    parts.push(`World setting: ${shortSummary}`)
  }

  parts.push('Professional book cover design, no text other than the title, vertical composition, high quality, 4K')

  return parts.join('. ')
}
