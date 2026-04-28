/**
 * @file formatContent.ts
 * @description 文本格式化工具模块，提供小说内容的智能排版、语义分段、对话提取与阅读优化
 * @version 2.0.0
 * @modified 2026-04-28 - 重写排版引擎，支持语义分段、对话提取、系统提示识别
 */

/* ============================================================
   类型定义
   ============================================================ */

type SegmentType = 'title' | 'narration' | 'dialogue' | 'system' | 'divider' | 'empty'

interface TextSegment {
  type: SegmentType
  content: string
  speaker?: string
}

interface FormatOptions {
  maxParagraphLength?: number
  dialogueStandalone?: boolean
  preserveSceneBreaks?: boolean
}

/* ============================================================
   常量：正则表达式
   ============================================================ */

// 中文句子结束符（包含引号闭合场景）
const SENTENCE_END_RE = /[。！？.!?]{1,3}["""』」]?/g

// 系统提示/旁白：【...】
const SYSTEM_PROMPT_RE = /【[^【】\n]+】/g

// 章节标题
const CHAPTER_TITLE_RE = /^\s*[#\s]*第[\d一二三四五六七八九十百千万零]+[章回节卷部集]\s*.+$/m

// 场景分隔
const SCENE_DIVIDER_RE = /^\s*[-—*＊·…～~]{3,}\s*$/

/* ============================================================
   工具函数
   ============================================================ */

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

function isChapterTitle(line: string): boolean {
  return CHAPTER_TITLE_RE.test(line.trim())
}

function isSceneDivider(line: string): boolean {
  return SCENE_DIVIDER_RE.test(line.trim())
}

function isEmptyLine(line: string): boolean {
  return line.trim().length === 0
}

/**
 * 判断一段文本是否主要是对话（超过50%字符在引号内）
 */
function isMainlyDialogue(text: string): boolean {
  let dialogueLength = 0
  const quoteMatches = text.matchAll(/["""「]([^""」]+)["""」]/g)
  for (const m of quoteMatches) {
    dialogueLength += m[1].length
  }
  return dialogueLength > text.length * 0.5
}

/**
 * 提取句子中的对话片段和叙述片段
 * 返回交替的片段数组
 */
function extractDialogueFragments(text: string): Array<{ type: 'dialogue' | 'narration'; text: string }> {
  const fragments: Array<{ type: 'dialogue' | 'narration'; text: string }> = []
  // 匹配所有引号包裹的内容及其前面的说话人提示
  const pattern = /([^""「\n]*?[说道问答喊叫骂叱喝叹唱念提喝][道着了话曰气]*[:：][\s]*)?["""「]([^""」\n]+)["""」]/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const fullMatch = match[0]
    const startIndex = match.index

    // 前面的叙述部分
    if (startIndex > lastIndex) {
      const narr = text.slice(lastIndex, startIndex).trim()
      if (narr) {
        fragments.push({ type: 'narration', text: narr })
      }
    }

    // 对话部分（包含说话人提示）
    fragments.push({ type: 'dialogue', text: fullMatch.trim() })
    lastIndex = pattern.lastIndex
  }

  // 尾部叙述
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).trim()
    if (tail) {
      fragments.push({ type: 'narration', text: tail })
    }
  }

  // 如果没有匹配到对话，整段作为叙述
  if (fragments.length === 0) {
    fragments.push({ type: 'narration', text })
  }

  return fragments
}

/**
 * 将文本按句子拆分，保留结束符
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = SENTENCE_END_RE.exec(text)) !== null) {
    const endIndex = match.index + match[0].length
    const sentence = text.slice(lastIndex, endIndex).trim()
    if (sentence) {
      sentences.push(sentence)
    }
    lastIndex = endIndex
  }

  // 剩余部分（可能没有结束符）
  const remainder = text.slice(lastIndex).trim()
  if (remainder) {
    sentences.push(remainder)
  }

  return sentences.length > 0 ? sentences : [text]
}

/* ============================================================
   语义分段引擎
   ============================================================ */

/**
 * 将原始小说文本解析为语义片段数组
 */
function parseSemanticSegments(rawText: string): TextSegment[] {
  const segments: TextSegment[] = []
  const lines = rawText.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 空行
    if (isEmptyLine(line)) {
      segments.push({ type: 'empty', content: '' })
      i++
      continue
    }

    // 章节标题
    if (isChapterTitle(line)) {
      const cleanTitle = trimmed.replace(/^#\s*/, '').trim()
      segments.push({ type: 'title', content: cleanTitle })
      i++
      continue
    }

    // 场景分隔线
    if (isSceneDivider(line)) {
      segments.push({ type: 'divider', content: '' })
      i++
      continue
    }

    // 系统提示行（整行是【...】）
    if (/^【[^【】]+】$/.test(trimmed)) {
      segments.push({ type: 'system', content: trimmed })
      i++
      continue
    }

    // 收集连续的非特殊行，形成一个文本块
    const blockLines: string[] = []
    while (i < lines.length && !isEmptyLine(lines[i]) && !isChapterTitle(lines[i]) && !isSceneDivider(lines[i])) {
      blockLines.push(lines[i].trim())
      i++
    }

    if (blockLines.length > 0) {
      const blockText = blockLines.join('')
      // 分析这个文本块，拆分为叙述和对话片段
      const blockSegments = analyzeTextBlock(blockText)
      segments.push(...blockSegments)
    }
  }

  return segments
}

/**
 * 分析一个文本块，将其拆分为叙述/对话/系统提示的语义片段
 */
function analyzeTextBlock(text: string): TextSegment[] {
  const segments: TextSegment[] = []

  // 先用系统提示拆分
  const parts = text.split(SYSTEM_PROMPT_RE)
  const systemMatches = text.match(SYSTEM_PROMPT_RE) || []

  let sysIdx = 0
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p].trim()
    if (part) {
      const subSegments = splitSentencesToSegments(part)
      segments.push(...subSegments)
    }
    if (sysIdx < systemMatches.length) {
      segments.push({ type: 'system', content: systemMatches[sysIdx] })
      sysIdx++
    }
  }

  return segments
}

/**
 * 将纯文本（无系统提示）按句子拆分为叙述/对话片段
 */
function splitSentencesToSegments(text: string): TextSegment[] {
  const sentences = splitIntoSentences(text)
  const segments: TextSegment[] = []

  for (const sentence of sentences) {
    if (!sentence.trim()) continue

    // 如果整句主要是对话
    if (isMainlyDialogue(sentence)) {
      segments.push({ type: 'dialogue', content: sentence.trim() })
      continue
    }

    // 如果句子包含对话但叙述占主导，提取对话片段
    const hasDialogue = /["""「]/.test(sentence)
    if (hasDialogue) {
      const fragments = extractDialogueFragments(sentence)
      for (const frag of fragments) {
        if (frag.text.trim()) {
          segments.push({
            type: frag.type === 'dialogue' ? 'dialogue' : 'narration',
            content: frag.text.trim(),
          })
        }
      }
      continue
    }

    // 纯叙述
    segments.push({ type: 'narration', content: sentence.trim() })
  }

  return segments
}

/* ============================================================
   段落重组：控制段落长度与阅读节奏
   ============================================================ */

/**
 * 将语义片段重组为适合阅读的段落
 * 规则：
 * 1. 叙述片段累积到 maxLength 左右时形成一段
 * 2. 对话片段根据配置决定是否独立成段
 * 3. 系统提示和标题始终独立
 */
function recomposeParagraphs(segments: TextSegment[], options: FormatOptions = {}): TextSegment[] {
  const { maxParagraphLength = 280, dialogueStandalone = true } = options
  const result: TextSegment[] = []

  let currentNarration = ''

  const flushNarration = () => {
    if (currentNarration) {
      result.push({ type: 'narration', content: currentNarration.trim() })
      currentNarration = ''
    }
  }

  for (const seg of segments) {
    switch (seg.type) {
      case 'title':
      case 'divider':
      case 'system':
      case 'empty':
        flushNarration()
        result.push(seg)
        break

      case 'dialogue':
        if (dialogueStandalone) {
          flushNarration()
          result.push(seg)
        } else {
          flushNarration()
          result.push(seg)
        }
        break

      case 'narration': {
        // 如果当前叙述加上新内容超过阈值，先flush
        if (currentNarration && (currentNarration.length + seg.content.length > maxParagraphLength)) {
          // 尝试在句子边界分割，不要截断句子
          const combined = currentNarration + seg.content
          const splitPoint = findBestSplitPoint(combined, maxParagraphLength)
          if (splitPoint > currentNarration.length * 0.5) {
            result.push({ type: 'narration', content: combined.slice(0, splitPoint).trim() })
            currentNarration = combined.slice(splitPoint).trim()
          } else {
            flushNarration()
            currentNarration = seg.content
          }
        } else {
          currentNarration = currentNarration ? currentNarration + seg.content : seg.content
        }
        break
      }
    }
  }

  flushNarration()
  return result
}

/**
 * 在文本中找到最佳分割点（优先在句子结束处）
 */
function findBestSplitPoint(text: string, targetLength: number): number {
  // 从targetLength往前找最近的句子结束符
  for (let i = Math.min(targetLength, text.length); i > targetLength * 0.5; i--) {
    if (/[。！？.!?]["""」』]?$/.test(text.slice(0, i))) {
      return i
    }
  }
  // 如果没找到，返回targetLength
  return targetLength
}

/* ============================================================
   渲染为 Markdown
   ============================================================ */

/**
 * 将语义片段渲染为 Markdown 字符串
 */
function renderToMarkdown(segments: TextSegment[]): string {
  const lines: string[] = []

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx]

    switch (seg.type) {
      case 'title':
        lines.push(`# ${seg.content}`)
        lines.push('')
        break

      case 'empty':
        lines.push('')
        break

      case 'divider':
        lines.push('* * *')
        lines.push('')
        break

      case 'system':
        // 系统提示渲染为居中的强调文本
        lines.push(`<p class="reader-system">${escapeHtml(seg.content)}</p>`)
        lines.push('')
        break

      case 'dialogue':
        // 对话渲染为带特殊class的段落，便于CSS样式化
        lines.push(`<p class="reader-dialogue">${escapeHtml(seg.content)}</p>`)
        lines.push('')
        break

      case 'narration': {
        // 叙述正常渲染，但在长段后如果下一段是对话，增加一点视觉间隔暗示
        lines.push(seg.content)
        lines.push('')
        break
      }
    }
  }

  return lines.join('\n').trim()
}

/* ============================================================
   阅读器专用排版：formatForReading (重写)
   ============================================================ */

export function formatForReading(content: string, options?: FormatOptions): string {
  if (!content || !content.trim()) return content

  // 1. 解析语义片段
  const segments = parseSemanticSegments(content)

  // 2. 重组段落，控制阅读节奏
  const recomposed = recomposeParagraphs(segments, options)

  // 3. 渲染为 Markdown
  return renderToMarkdown(recomposed)
}

/* ============================================================
   编辑器专用：formatContentForEditor (保持兼容)
   ============================================================ */

export function formatContentForEditor(rawText: string): string {
  if (!rawText || !rawText.trim()) return ''

  const text = rawText.trim()
  const lines = text.split('\n')
  const htmlParts: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      i++
      continue
    }

    if (trimmedLine.startsWith('### ')) {
      htmlParts.push(`<h3>${escapeHtml(trimmedLine.slice(4))}</h3>`)
      i++
      continue
    }

    if (trimmedLine.startsWith('## ')) {
      htmlParts.push(`<h2>${escapeHtml(trimmedLine.slice(3))}</h2>`)
      i++
      continue
    }

    if (trimmedLine.startsWith('# ')) {
      htmlParts.push(`<h1>${escapeHtml(trimmedLine.slice(2))}</h1>`)
      i++
      continue
    }

    if (trimmedLine.startsWith('> ')) {
      htmlParts.push(`<blockquote><p>${escapeHtml(trimmedLine.slice(2))}</p></blockquote>`)
      i++
      continue
    }

    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      const listItems: string[] = []
      while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
        listItems.push(`<li>${formatInlineMarkdown(lines[i].trim().slice(2))}</li>`)
        i++
      }
      htmlParts.push(`<ul>${listItems.join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s/.test(trimmedLine)) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(`<li>${formatInlineMarkdown(lines[i].trim().replace(/^\d+\.\s/, ''))}</li>`)
        i++
      }
      htmlParts.push(`<ol>${listItems.join('')}</ol>`)
      continue
    }

    if (isDialogueLine(trimmedLine)) {
      const dialogueLines: string[] = []
      while (i < lines.length && isDialogueLine(lines[i].trim())) {
        dialogueLines.push(`<p class="dialogue">${formatInlineMarkdown(lines[i].trim())}</p>`)
        i++
      }
      htmlParts.push(`<div class="dialogue-group">${dialogueLines.join('')}</div>`)
      continue
    }

    if (isSceneDividerLine(trimmedLine)) {
      htmlParts.push('<hr class="scene-divider" />')
      i++
      continue
    }

    const paragraphLines: string[] = []
    while (i < lines.length && lines[i].trim() && !isSpecialLine(lines[i].trim())) {
      paragraphLines.push(lines[i].trim())
      i++
    }

    if (paragraphLines.length > 0) {
      const paragraphText = paragraphLines.join(' ')
      htmlParts.push(`<p>${formatInlineMarkdown(paragraphText)}</p>`)
    }
  }

  return htmlParts.join('\n')
}

function formatInlineMarkdown(text: string): string {
  let result = escapeHtml(text)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/`(.+?)`/g, '<code>$1</code>')
  return result
}

function isDialogueLine(line: string): boolean {
  return /^[\u201C\u201D"'\u300C]/.test(line) || /^["\u300C].*?["\u300D]/.test(line)
}

function isSceneDividerLine(line: string): boolean {
  return /^\s*[\u2014*\uff0d\u2014]{3,}\s*$/.test(line) || /^\s*第\d+\s*[章回节]\s*/.test(line)
}

function isSpecialLine(line: string): boolean {
  return (
    line.startsWith('#') ||
    line.startsWith('> ') ||
    line.startsWith('- ') ||
    line.startsWith('* ') ||
    /^\d+\.\s/.test(line) ||
    isDialogueLine(line) ||
    isSceneDividerLine(line)
  )
}

/* ============================================================
   兼容导出（保留旧函数签名）
   ============================================================ */

export function optimizeParagraphs(content: string): string {
  const lines = content.split('\n')
  const optimized: string[] = []
  let inParagraph = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      if (inParagraph) {
        inParagraph = false
      }
      optimized.push('')
      continue
    }

    if (!inParagraph && trimmedLine && !isSpecialLine(trimmedLine)) {
      optimized.push(`\u3000\u3000${trimmedLine}`)
      inParagraph = true
    } else {
      optimized.push(line)
    }
  }

  return optimized.join('\n')
}

export function enhanceDialogue(content: string): string {
  return content.replace(
    /(["\u300C])([^""\u300D]*?)([\u300D"])/g,
    '<span class="reader-dialogue">$1$2$3</span>'
  )
}

export function addSceneBreaks(content: string): string {
  return content.replace(
    /^\s*[\u2014*\uff0d\u2014]{3,}\s*$/gm,
    '\n* * *\n'
  )
}

export function smartSegment(text: string, maxLength: number = 300): string {
  if (!text || text.length <= maxLength) return text

  const sentences = text.match(/[^。！？.!?]+[。！？.!?]+/g) || [text]
  const segments: string[] = []
  let currentSegment = ''

  for (const sentence of sentences) {
    if ((currentSegment + sentence).length <= maxLength) {
      currentSegment += sentence
    } else {
      if (currentSegment) segments.push(currentSegment)
      currentSegment = sentence
    }
  }

  if (currentSegment) segments.push(currentSegment)

  return segments.join('\n\n')
}
