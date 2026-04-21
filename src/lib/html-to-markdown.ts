/**
 * @file html-to-markdown.ts
 * @description HTML转Markdown工具函数，用于统一章节内容存储格式
 * @version 1.0.0
 */
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

/**
 * 将HTML内容转换为Markdown格式
 * @param {string} html - HTML格式的字符串内容
 * @returns {string} 转换后的Markdown字符串
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>' || html.trim() === '') {
    return ''
  }
  return turndown.turndown(html)
}

/**
 * 将Markdown内容转换为HTML格式（用于编辑器初始化）
 * @param {string} markdown - Markdown格式的字符串内容
 * @returns {string} 转换后的HTML字符串
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown || markdown.trim() === '') {
    return '<p></p>'
  }
  
  const lines = markdown.split('\n')
  const htmlLines: string[] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    if (line.startsWith('# ')) {
      htmlLines.push(`<h1>${line.slice(2)}</h1>`)
    } else if (line.startsWith('## ')) {
      htmlLines.push(`<h2>${line.slice(3)}</h2>`)
    } else if (line.startsWith('### ')) {
      htmlLines.push(`<h3>${line.slice(4)}</h3>`)
    } else if (line.startsWith('#### ')) {
      htmlLines.push(`<h4>${line.slice(5)}</h4>`)
    } else if (line.startsWith('**') && line.endsWith('**')) {
      htmlLines.push(`<p><strong>${line.slice(2, -2)}</strong></p>`)
    } else if (line.startsWith('*') && line.endsWith('*')) {
      htmlLines.push(`<p><em>${line.slice(1, -1)}</em></p>`)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      htmlLines.push(`<li>${line.slice(2)}</li>`)
    } else if (line.match(/^\d+\.\s/)) {
      htmlLines.push(`<li>${line.replace(/^\d+\.\s/, '')}</li>`)
    } else if (line.trim() === '') {
      htmlLines.push('')
    } else {
      htmlLines.push(`<p>${line}</p>`)
    }
  }
  
  return htmlLines.join('\n')
}
