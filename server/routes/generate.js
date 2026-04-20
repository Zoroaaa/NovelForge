import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { chapters, outlines, modelConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';
const router = new Hono();
async function resolveModelConfig(db, stage, novelId) {
    const config = await db.select().from(modelConfigs)
        .where(eq(modelConfigs.stage, stage))
        .get();
    return config || {
        provider: 'volcengine',
        modelId: 'doubao-seed-2-pro',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKeyEnv: 'VOLCENGINE_API_KEY',
    };
}
router.post('/chapter', async (c) => {
    const { chapterId, novelId } = await c.req.json();
    const db = drizzle(c.env.DB);
    const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
    if (!chapter)
        return c.json({ error: 'Chapter not found' }, 404);
    const outline = chapter.outlineId
        ? await db.select().from(outlines).where(eq(outlines.id, chapter.outlineId)).get()
        : null;
    const config = await resolveModelConfig(db, 'chapter_gen', novelId);
    const apiKey = c.env[config.apiKeyEnv ?? 'VOLCENGINE_API_KEY'];
    const messages = [
        {
            role: 'system',
            content: `你是一位专业的小说作家，文风流畅，情节紧凑。请严格按照章节大纲进行创作，不要偏离设定。`,
        },
        {
            role: 'user',
            content: [
                outline ? `【本章大纲】\n${outline.content}` : '',
                `【要求】请创作《${chapter.title}》的正文，3000-5000字，第三人称，结尾留有悬念。`,
            ].filter(Boolean).join('\n\n'),
        },
    ];
    try {
        const upstream = await fetch(`${config.apiBase}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: config.modelId,
                messages,
                stream: true,
                temperature: 0.85,
                max_tokens: 4096,
            }),
        });
        return new Response(upstream.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
            },
        });
    }
    catch (error) {
        return c.json({ error: 'Failed to generate' }, 500);
    }
});
export { router as generate };
