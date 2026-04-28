/**
 * @file test-extract.ts
 * @description 测试新的抽取逻辑（使用 docs/extract.ts 的实现）
 */
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { extractStructuredData } from './server/services/workshop/extract'
import type { WorkshopExtractedData } from './server/services/workshop/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const testFilePath = resolve(__dirname, 'docs/1.txt')
console.log('📂 测试文件路径:', testFilePath)
console.log('='.repeat(80))

try {
  const fileContent = readFileSync(testFilePath, 'utf-8')
  console.log(`📄 文件大小: ${(fileContent.length / 1024).toFixed(2)} KB`)
  console.log(''.padEnd(80, '='))

  const stage = 'volume_outline'
  const currentData: WorkshopExtractedData = {}

  console.log('\n🔍 开始抽取数据 (stage:', stage, ')...')
  console.log('-'.repeat(80))

  const startTime = Date.now()
  const result = extractStructuredData(fileContent, stage, currentData)
  const endTime = Date.now()

  console.log(`\n✅ 抽取完成! 耗时: ${endTime - startTime}ms`)
  console.log('='.repeat(80))

  console.log('\n📊 抽取结果:')
  console.log('-'.repeat(80))

  if (result.volumes && Array.isArray(result.volumes)) {
    console.log(`\n📚 成功提取到 ${result.volumes.length} 卷数据:\n`)

    result.volumes.forEach((vol, idx) => {
      console.log(`\n${'─'.repeat(60)}`)
      console.log(`📖 第 ${idx + 1} 卷: ${vol.title || '(无标题)'}`)
      console.log(`${'─'.repeat(60)}`)

      if (vol.summary) {
        console.log(`\n📝 摘要:`)
        console.log(`   ${vol.summary.substring(0, 200)}${vol.summary.length > 200 ? '...' : ''}`)
      }

      if (vol.blueprint) {
        console.log(`\n🔧 蓝图长度: ${vol.blueprint.length} 字符`)
        console.log(`   前150字: ${vol.blueprint.substring(0, 150)}...`)
      }

      if (vol.eventLine && Array.isArray(vol.eventLine)) {
        console.log(`\n📋 事件线: ${vol.eventLine.length} 条`)
        if (vol.eventLine.length > 0) {
          console.log(`   第1条: ${vol.eventLine[0]}`)
          if (vol.eventLine.length > 1) {
            console.log(`   最后1条: ${vol.eventLine[vol.eventLine.length - 1]}`)
          }
        }
      }

      if (vol.notes && Array.isArray(vol.notes)) {
        console.log(`\n📌 备注: ${vol.notes.length} 条`)
        vol.notes.forEach((note, i) => {
          console.log(`   ${i + 1}. ${note}`)
        })
      }

      if (vol.foreshadowingSetup && Array.isArray(vol.foreshadowingSetup)) {
        console.log(`\n🎭 埋伏笔: ${vol.foreshadowingSetup.length} 条`)
        vol.foreshadowingSetup.forEach((fs, i) => {
          console.log(`   ${i + 1}. ${fs}`)
        })
      }

      if (vol.foreshadowingResolve && Array.isArray(vol.foreshadowingResolve)) {
        console.log(`\n✅ 收伏笔: ${vol.foreshadowingResolve.length} 条`)
        vol.foreshadowingResolve.forEach((fr, i) => {
          console.log(`   ${i + 1}. ${fr}`)
        })
      }

      console.log(`\n📊 目标字数: ${vol.targetWordCount || '未设置'}`)
      console.log(`📊 目标章数: ${vol.targetChapterCount || '未设置'}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('📈 统计信息:')
    console.log('='.repeat(80))
    let totalChapters = 0
    let totalWords = 0
    let totalEvents = 0
    let totalNotes = 0
    let totalForeshadowSetup = 0
    let totalForeshadowResolve = 0

    result.volumes.forEach((vol) => {
      totalChapters += vol.targetChapterCount || 0
      totalWords += vol.targetWordCount || 0
      totalEvents += (vol.eventLine?.length) || 0
      totalNotes += (vol.notes?.length) || 0
      totalForeshadowSetup += (vol.foreshadowingSetup?.length) || 0
      totalForeshadowResolve += (vol.foreshadowingResolve?.length) || 0
    })

    console.log(`总卷数: ${result.volumes.length}`)
    console.log(`总章数: ${totalChapters}`)
    console.log(`总目标字数: ${totalWords.toLocaleString()}`)
    console.log(`总事件线: ${totalEvents}`)
    console.log(`总备注: ${totalNotes}`)
    console.log(`总埋伏笔: ${totalForeshadowSetup}`)
    console.log(`总收伏笔: ${totalForeshadowResolve}`)

  } else {
    console.log('\n❌ 未提取到 volumes 数据')
    console.log('可用的字段:', Object.keys(result))
  }

  console.log('\n' + '='.repeat(80))
  console.log('✨ 完整的提取数据对象 (JSON):')
  console.log('='.repeat(80))
  console.log(JSON.stringify(result, null, 2))

} catch (error) {
  console.error('\n❌ 测试失败:', error)
}
