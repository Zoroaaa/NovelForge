import type { Env } from '../lib/types'
import {
  step7EntityExtract,
  step8CharacterGrowth,
  step9EntityConflictDetect,
  finishPostProcess,
} from '../services/agent/postProcess'
import type { EntityExtractResult } from '../services/agent/entityExtract'

export class PostProcessDo {
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const start = Date.now()
    let payload: {
      chapterId: string
      novelId: string
      taskId?: string
      volumeId?: string
    }

    try {
      payload = await request.json() as typeof payload
    } catch (e) {
      return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    const { chapterId, novelId, taskId, volumeId } = payload

    console.log(`[DO PostProcess] 开始执行 step_7+8+9: chapter=${chapterId}, novel=${novelId}`)

    let extractResult: EntityExtractResult

    try {
      extractResult = await step7EntityExtract(this.env, chapterId, novelId)
      console.log(`[DO PostProcess] ✅ step_7 完成 (${Date.now() - start}ms)`)
    } catch (e) {
      console.error(`[DO PostProcess] ❌ step_7 失败: ${(e as Error).message}`)
      extractResult = { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [] }
    }

    try {
      await step8CharacterGrowth(this.env, chapterId, novelId, extractResult)
      console.log(`[DO PostProcess] ✅ step_8 完成 (${Date.now() - start}ms)`)
    } catch (e) {
      console.error(`[DO PostProcess] ❌ step_8 失败: ${(e as Error).message}`)
    }

    try {
      await step9EntityConflictDetect(this.env, chapterId, novelId)
      console.log(`[DO PostProcess] ✅ step_9 完成 (${Date.now() - start}ms)`)
    } catch (e) {
      console.error(`[DO PostProcess] ❌ step_9 失败: ${(e as Error).message}`)
    }

    try {
      await finishPostProcess(this.env, chapterId, novelId, taskId, volumeId)
      console.log(`[DO PostProcess] ✅ finishPostProcess 完成 (${Date.now() - start}ms)`)
    } catch (e) {
      console.error(`[DO PostProcess] ❌ finishPostProcess 失败: ${(e as Error).message}`)
    }

    console.log(`[DO PostProcess] 全部完成，总耗时 ${Date.now() - start}ms`)

    return Response.json({ ok: true, wallTimeMs: Date.now() - start })
  }
}
