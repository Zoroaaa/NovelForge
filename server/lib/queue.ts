import type { Env } from './types'

export type QueueMessage =
  | {
      type: 'index_content'
      payload: {
        sourceType: 'setting' | 'character' | 'outline' | 'foreshadowing' | 'summary' | 'chapter'
        sourceId: string
        novelId: string
        title: string
        content: string
        extraMetadata?: Record<string, string>
      }
    }
  | {
      type: 'reindex_all'
      payload: {
        novelId: string
        types?: Array<'setting' | 'character' | 'outline' | 'foreshadowing'>
        clearExisting?: boolean
      }
    }
  | {
      type: 'rebuild_entity_index'
      payload: {
        novelId: string
      }
    }
  | {
      type: 'extract_foreshadowing'
      payload: {
        chapterId: string
        novelId: string
      }
    }
  | {
      type: 'post_process_chapter'
      payload: {
        chapterId: string
        novelId: string
        enableAutoSummary: boolean
        usage?: { prompt_tokens: number; completion_tokens: number }
      }
    }
  | {
      type: 'commit_workshop'
      payload: {
        sessionId: string
      }
    }
  | {
      type: 'batch_generate_chapter'
      payload: {
        taskId: string
        novelId: string
        volumeId: string
      }
    }
  | {
      type: 'batch_chapter_done'
      payload: {
        taskId: string
        novelId: string
        volumeId: string
        chapterId: string
        success: boolean
      }
    }
  | {
      type: 'quality_check'
      payload: {
        chapterId: string
        novelId: string
      }
    }
  | {
      type: 'generate_chapter'
      payload: {
        chapterId: string
        novelId: string
        mode: 'generate' | 'continue' | 'rewrite'
        existingContent?: string
        targetWords?: number
        issuesContext?: string[]
        enableRAG?: boolean
        enableAutoSummary?: boolean
      }
    }

export async function enqueue(
  env: Env,
  message: QueueMessage
): Promise<void> {
  if (!env.TASK_QUEUE) {
    console.warn('enqueue: TASK_QUEUE not available, message dropped:', message.type)
    return
  }
  await env.TASK_QUEUE.send(message)
}

export async function enqueueBatch(
  env: Env,
  messages: QueueMessage[]
): Promise<void> {
  if (!env.TASK_QUEUE || messages.length === 0) {
    console.warn('enqueueBatch: TASK_QUEUE not available or empty messages')
    return
  }
  const BATCH_SIZE = 100
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    await env.TASK_QUEUE.sendBatch(
      messages.slice(i, i + BATCH_SIZE).map(body => ({ body }))
    )
  }
}
