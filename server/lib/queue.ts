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
      type: 'generate_summary'
      payload: {
        chapterId: string
        novelId: string
        chapterTitle: string
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
