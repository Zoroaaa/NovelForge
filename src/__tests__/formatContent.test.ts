/**
 * @file formatContent.test.ts
 * @description formatContent 模块系统性测试 - 覆盖所有功能点和边界条件
 * @version 1.0.0
 */
import { describe, it, expect } from 'vitest'
import {
  formatContentForEditor,
  formatForReading,
  smartSegment,
} from '@/lib/formatContent'

describe('formatContentForEditor', () => {
  describe('基础功能测试', () => {
    it('场景1: 空字符串输入应返回空字符串', () => {
      const result = formatContentForEditor('')
      expect(result).toBe('')
    })

    it('场景2: null/undefined 输入应返回空字符串', () => {
      // @ts-ignore - 测试边界条件
      const result1 = formatContentForEditor(null)
      expect(result1).toBe('')

      // @ts-ignore
      const result2 = formatContentForEditor(undefined)
      expect(result2).toBe('')
    })

    it('场景3: 只有空白的字符串应返回空字符串', () => {
      const result = formatContentForEditor('   \n\n   \t  ')
      expect(result).toBe('')
    })
  })

  describe('段落格式化测试', () => {
    it('场景4: 单段纯文本应生成 <p> 标签', () => {
      const input = '这是一段普通的文本内容'
      const result = formatContentForEditor(input)

      expect(result).toContain('<p>')
      expect(result).toContain('这是一段普通的文本内容')
      expect(result).toContain('</p>')
    })

    it('场景5: 多段文本应分别生成多个 <p> 标签', () => {
      const input = `第一段内容

第二段内容

第三段内容`
      const result = formatContentForEditor(input)

      const pTags = result.match(/<p>/g) || []
      expect(pTags.length).toBe(3)

      expect(result).toContain('第一段内容')
      expect(result).toContain('第二段内容')
      expect(result).toContain('第三段内容')
    })

    it('场景6: 连续多行非特殊内容应合并为一个段落（用空格连接）', () => {
      const input = `这是第一行
这是第二行
这是第三行`
      const result = formatContentForEditor(input)

      expect(result).toContain('这是第一行 这是第二行 这是第三行')
    })
  })

  describe('标题识别测试', () => {
    it('场景7: H1 标题 (# ) 应正确转换', () => {
      const input = '# 第一章 开始'
      const result = formatContentForEditor(input)

      expect(result).toContain('<h1>')
      expect(result).toContain('第一章 开始')
      expect(result).toContain('</h1>')
    })

    it('场景8: H2 标题 (## ) 应正确转换', () => {
      const input = '## 第一节 相遇'
      const result = formatContentForEditor(input)

      expect(result).toContain('<h2>')
      expect(result).toContain('第一节 相遇')
      expect(result).toContain('</h2>')
    })

    it('场景9: H3 标题 (### ) 应正确转换', () => {
      const input = '### 1.1 清晨'
      const result = formatContentForEditor(input)

      expect(result).toContain('<h3>')
      expect(result).toContain('1.1 清晨')
      expect(result).toContain('</h3>')
    })
  })

  describe('对话识别测试', () => {
    it('场景10: 中文双引号对话应被识别为对话行', () => {
      const input = '"你好，"他说道。'
      const result = formatContentForEditor(input)

      expect(result).toContain('class="dialogue"')
      expect(result).toContain('dialogue-group')
    })

    it('场景11: 书名号开头的对话应被识别', () => {
      const input = '「你今天看起来心情不错。」她微笑着说'
      const result = formatContentForEditor(input)

      expect(result).toContain('class="dialogue"')
    })

    it('场景12: 连续多行对话应归入同一个 dialogue-group', () => {
      const input = `"你好。"他说。
"你好。"她回应道。
"今天天气真好。"他感叹。`
      const result = formatContentForEditor(input)

      const dialogueGroups = result.match(/class="dialogue"/g) || []
      expect(dialogueGroups.length).toBe(3)
      expect(result).toMatch(/dialogue-group[\s\S]*?dialogue-group[\s\S]*?dialogue/)
    })
  })

  describe('列表格式测试', () => {
    it('场景13: 无序列表 (- 开头) 应转换为 <ul><li>', () => {
      const input = `- 项目一
- 项目二
- 项目三`
      const result = formatContentForEditor(input)

      expect(result).toContain('<ul>')
      expect(result).toContain('</ul>')
      const liTags = result.match(/<li>/g) || []
      expect(liTags.length).toBe(3)
    })

    it('场景14: 无序列表 (* 开头) 应转换为 <ul><li>', () => {
      const input = `* 项目A
* 项目B`
      const result = formatContentForEditor(input)

      expect(result).toContain('<ul>')
      const liTags = result.match(/<li>/g) || []
      expect(liTags.length).toBe(2)
    })

    it('场景15: 有序列表 (数字.) 应转换为 <ol><li>', () => {
      const input = `1. 第一步
2. 第二步
3. 第三步`
      const result = formatContentForEditor(input)

      expect(result).toContain('<ol>')
      expect(result).toContain('</ol>')
      const liTags = result.match(/<li>/g) || []
      expect(liTags.length).toBe(3)
    })
  })

  describe('引用和分隔线测试', () => {
    it('场景16: 引用块 (> 开头) 应转换为 <blockquote>', () => {
      const input = '> 这是一句引用的话'
      const result = formatContentForEditor(input)

      expect(result).toContain('<blockquote>')
      expect(result).toContain('</blockquote>')
      expect(result).toContain('这是一句引用的话')
    })

    it('场景17: 场景分隔线 (---) 应转换为 <hr>', () => {
      const input = '---'
      const result = formatContentForEditor(input)

      expect(result).toContain('<hr')
      expect(result).toContain('scene-divider')
    })

    it('场景18: 场景分隔线 (***) 应转换为 <hr>', () => {
      const input = '***'
      const result = formatContentForEditor(input)

      expect(result).toContain('<hr')
    })
  })

  describe('内联Markdown测试', () => {
    it('场景19: 粗体文本 (**text**) 应转换为 <strong>', () => {
      const input = '这是**重要**的内容'
      const result = formatContentForEditor(input)

      expect(result).toContain('<strong>重要</strong>')
    })

    it('场景20: 斜体文本 (*text*) 应转换为 <em>', () => {
      const input = '这是*强调*的内容'
      const result = formatContentForEditor(input)

      expect(result).toContain('<em>强调</em>')
    })

    it('场景21: 行内代码 (`code`) 应转换为 <code>', () => {
      const input = '使用`console.log`输出'
      const result = formatContentForEditor(input)

      expect(result).toContain('<code>console.log</code>')
    })
  })

  describe('混合内容测试', () => {
    it('场景22: 包含标题、段落、对话的复杂内容应全部正确解析', () => {
      const input = `# 第一章

清晨的阳光透过窗户照进房间。

"该起床了。"母亲的声音从楼下传来。

他揉了揉眼睛，慢慢坐起身来。

## 发展

窗外传来鸟叫声。

"新的一天开始了。"他自言自语道。`

      const result = formatContentForEditor(input)

      expect(result).toContain('<h1>')
      expect(result).toContain('<h2>')
      expect(result).toContain('<p>')
      expect(result).toContain('class="dialogue"')
    })
  })

  describe('XSS安全防护测试', () => {
    it('场景23: HTML标签应被转义', () => {
      const input = '<script>alert("xss")</script>'
      const result = formatContentForEditor(input)

      expect(result).not.toContain('<script>')
      expect(result).toContain('&lt;script&gt;')
    })

    it('场景24: JavaScript事件处理器应被转义', () => {
      const input = '<img src=x onerror=alert(1)>'
      const result = formatContentForEditor(input)

      expect(result).not.toContain('onerror')
      expect(result).toContain('&lt;img')
    })

    it('场景25: 特殊字符 & " \' 应被转义', () => {
      const input = 'Tom & Jerry said "hello"'
      const result = formatContentForEditor(input)

      expect(result).toContain('&amp;')
      expect(result).toContain('&quot;')
    })
  })

  describe('性能和边界条件测试', () => {
    it('场景26: 超长文本（10000字）应在合理时间内处理完成', () => {
      const longText = '这是一个很长的句子。'.repeat(500)
      const startTime = performance.now()

      const result = formatContentForEditor(longText)
      const endTime = performance.now()

      expect(result.length).toBeGreaterThan(0)
      expect(endTime - startTime).toBeLessThan(1000) // 1秒内完成
    })

    it('场景27: 只有换行符的文本应返回空字符串', () => {
      const input = '\n\n\n\n\n'
      const result = formatContentForEditor(input)

      expect(result).toBe('')
    })

    it('场景28: Unicode 和 Emoji 字符应正常处理', () => {
      const input = '今天天气真好 ☀️😊'
      const result = formatContentForEditor(input)

      expect(result).toContain('☀️')
      expect(result).toContain('😊')
    })
  })
})

describe('formatForReading', () => {
  it('场景29: 空值应原样返回', () => {
    expect(formatForReading('')).toBe('')
    // @ts-ignore
    expect(formatForReading(null)).toBeNull()
    // @ts-ignore
    expect(formatForReading(undefined)).toBeUndefined()
  })

  it('场景30: 正常文本应添加首行缩进', () => {
    const input = '第一段\n\n第二段'
    const result = formatForReading(input)

    expect(result).toContain('\u3000\u3000') // 全角空格缩进
  })

  it('场景31: 场景分隔线应转换为视觉提示', () => {
    const input = '前文\n\n---\n\n后文'
    const result = formatForReading(input)

    expect(result).toContain('* * *')
  })
})

describe('smartSegment', () => {
  it('场景32: 短文本不应分段', () => {
    const input = '这是一个短文本。'
    const result = smartSegment(input, 100)

    expect(result).toBe(input)
  })

  it('场景33: 长文本应按句子合理分段', () => {
    const input = '这是第一句话。这是第二句话。这是第三句话。这是第四句话。这是第五句话。'
    const result = smartSegment(input, 20)

    const segments = result.split('\n\n')
    expect(segments.length).toBeGreaterThan(1)
  })

  it('场景34: 自定义最大长度参数应生效', () => {
    const input = '短句。稍长的句子内容。'
    const result1 = smartSegment(input, 10)
    const result2 = smartSegment(input, 100)

    expect(result1.split('\n\n').length).toBeGreaterThanOrEqual(result2.split('\n\n').length)
  })
})
