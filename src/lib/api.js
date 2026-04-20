async function req(path, init) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
    }
    return res.json();
}
const j = (body) => JSON.stringify(body);
export const api = {
    novels: {
        list: () => req('/api/novels'),
        get: (id) => req(`/api/novels/${id}`),
        create: (body) => req('/api/novels', { method: 'POST', body: j(body) }),
        update: (id, body) => req(`/api/novels/${id}`, { method: 'PATCH', body: j(body) }),
        delete: (id) => req(`/api/novels/${id}`, { method: 'DELETE' }),
    },
    outlines: {
        list: (novelId) => req(`/api/outlines?novelId=${novelId}`),
        create: (body) => req('/api/outlines', { method: 'POST', body: j(body) }),
        update: (id, body) => req(`/api/outlines/${id}`, { method: 'PATCH', body: j(body) }),
        sort: (items) => req('/api/outlines/sort', { method: 'PATCH', body: j(items) }),
        delete: (id) => req(`/api/outlines/${id}`, { method: 'DELETE' }),
    },
    chapters: {
        list: (novelId) => req(`/api/chapters?novelId=${novelId}`),
        get: (id) => req(`/api/chapters/${id}`),
        create: (body) => req('/api/chapters', { method: 'POST', body: j(body) }),
        update: (id, body) => req(`/api/chapters/${id}`, { method: 'PATCH', body: j(body) }),
    },
    volumes: {
        list: (novelId) => req(`/api/volumes?novelId=${novelId}`),
        create: (body) => req('/api/volumes', { method: 'POST', body: j(body) }),
        update: (id, body) => req(`/api/volumes/${id}`, { method: 'PATCH', body: j(body) }),
    },
    settings: {
        list: (novelId) => novelId
            ? req(`/api/settings?novelId=${novelId}`)
            : req('/api/settings'),
        create: (body) => req('/api/settings', { method: 'POST', body: j(body) }),
        delete: (id) => req(`/api/settings/${id}`, { method: 'DELETE' }),
    },
};
export function streamGenerate(payload, onChunk, onDone, onError) {
    const ctrl = new AbortController();
    (async () => {
        try {
            const res = await fetch('/api/generate/chapter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: j(payload),
                signal: ctrl.signal,
            });
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    onDone();
                    return;
                }
                for (const line of dec.decode(value).split('\n')) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]')
                        onChunk(line.slice(6));
                }
            }
        }
        catch (e) {
            if (e.name !== 'AbortError')
                onError(e);
        }
    })();
    return () => ctrl.abort();
}
