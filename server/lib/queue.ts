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

async function safeWaitUntil(c: any, fn: Promise<void> | void) {
  const ctx = (c as any).executionContext
  if (ctx?.waitUntil) {
    ctx.waitUntil(Promise.resolve(fn).catch((e: Error) => console.warn('Async task failed:', e)))
  } else {
    Promise.resolve(fn).catch((e: Error) => console.warn('Async task failed:', e))
  }
}

export async function enqueue(
  env: Env,
  c: any,
  message: QueueMessage
): Promise<void> {
  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send(message)
  } else {
    const { executeTask } = await import('../queue-handler')
    safeWaitUntil(c, executeTask(env, message))
  }
}

export async function enqueueRaw(
  env: Env,
  message: QueueMessage
): Promise<void> {
  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send(message)
  } else {
    console.warn('enqueueRaw called but TASK_QUEUE not available, message dropped:', message.type)
  }
}
