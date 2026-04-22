/**
 * @file formatContent.ts
 * @description 文本格式化工具模块，处理AI生成内容的段落转换和排版优化
 * @version 1.0.0
 */

/**
 * 将纯文本/Markdown转换为适合tiptap编辑器的HTML格式
 * 保留段落结构、标题、对话等格式
 */
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

    if (isSceneDivider(trimmedLine)) {
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

/**
 * 格式化内联Markdown（粗体、斜体等）
 */
function formatInlineMarkdown(text: string): string {
  let result = escapeHtml(text)

  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/`(.+?)`/g, '<code>$1</code>')

  return result
}

/**
 * 判断是否为对话行（以引号开头或包含对话标记）
 */
function isDialogueLine(line: string): boolean {
  return /^[“"'「]/.test(line) || /^["「].*?["」]/.test(line)
}

/**
 * 判断是否为场景分隔线
 */
function isSceneDivider(line: string): boolean {
  return /^\s*[—*－—]{3,}\s*$/.test(line) || /^\s*第\d+\s*[章回节]\s*/.test(line)
}

/**
 * 判断是否为特殊行（标题、列表、引用等）
 */
function isSpecialLine(line: string): boolean {
  return (
    line.startsWith('#') ||
    line.startsWith('> ') ||
    line.startsWith('- ') ||
    line.startsWith('* ') ||
    /^\d+\.\s/.test(line) ||
    isDialogueLine(line) ||
    isSceneDivider(line)
  )
}

/**
 * HTML转义，防止XSS
 */
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

/**
 * 阅读器专用排版优化函数
 * 对显示内容进行智能排版增强
 */
export function formatForReading(content: string): string {
  if (!content || !content.trim()) return content

  let formatted = content

  formatted = optimizeParagraphs(formatted)
  formatted = enhanceDialogue(formatted)
  formatted = addSceneBreaks(formatted)

  return formatted
}

/**
 * 优化段落结构：确保段落间距合理、首行缩进等
 */
function optimizeParagraphs(content: string): string {
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

/**
 * 增强对话显示：为对话内容添加特殊标记以便CSS样式化
 */
function enhanceDialogue(content: string): string {
  return content.replace(
    /(["「])([^""」]*?)([」"])/g,
    '<span class="reader-dialogue">$1$2$3</span>'
  )
}

/**
 * 添加场景分隔符的视觉提示
 */
function addSceneBreaks(content: string): string {
  return content.replace(
    /^\s*[—*－—]{3,}\s*$/gm,
    '\n* * *\n'
  )
}

/**
 * 智能分段：将长段落按照语义合理分段
 */
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
