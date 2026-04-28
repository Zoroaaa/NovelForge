import { drizzle } from 'drizzle-orm/d1'
import { volumes, chapters } from '../../db/schema'
import { eq, and, sql, isNull } from 'drizzle-orm'
import type { Env } from '../../lib/types'

export async function checkAndCompleteVolume(
  env: Env,
  volumeId: string
): Promise<{ completed: boolean; reason?: 'chapter_target_reached' }> {
  const db = drizzle(env.DB)

  const volume = await db.select({
    id: volumes.id,
    targetChapterCount: volumes.targetChapterCount,
    status: volumes.status,
  }).from(volumes).where(eq(volumes.id, volumeId)).get()

  if (!volume) return { completed: false }
  if (volume.status === 'completed') return { completed: true }
  if (!volume.targetChapterCount) return { completed: false }

  const countResult = await db.select({ count: sql`count(*)` })
    .from(chapters)
    .where(and(
      eq(chapters.volumeId, volumeId),
      sql`${chapters.deletedAt} IS NULL`,
      sql`${chapters.status} IN ('generated', 'revised')`
    ))
    .get()

  const actualCount = Number(countResult?.count ?? 0)

  if (actualCount >= volume.targetChapterCount) {
    await db.update(volumes)
      .set({ status: 'completed', updatedAt: sql`(unixepoch())` })
      .where(eq(volumes.id, volumeId))

    return { completed: true, reason: 'chapter_target_reached' }
  }

  return { completed: false }
}
