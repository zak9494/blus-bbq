// Node.js runtime — allows Vercel maxDuration up to 300s (needed for large HTML generation)
export default async function handler(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') { res.status(200).set(cors).end(); return; }
  if (req.method !== 'POST') { res.status(405).set({ ...cors, 'Content-Type': 'application/json' }).send(JSON.stringify({ error: 'Method not allowed' })); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).set({ ...cors, 'Content-Type': 'application/json' }).send(JSON.stringify({ error: 'API key not configured' })); return; }

  try {
    const body = await req.json();
    // max_tokens default is set BEFORE ...body so client can override (client sends 16000; 64000 was too slow)
    const anthropicBody = { model: 'claude-haiku-4-5-20251001', max_tokens: 16000, ...body, stream: true };

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'output-128k-2025-02-19',
      },
      body: JSON.stringify(anthropicBody),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      res.status(upstream.status).set({ ...cors, 'Content-Type': 'application/json' }).send(JSON.stringify({ error: 'Anthropic error', details: err }));
      return;
    }

    res.status(200).set({ ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(value);
      }
    };
    await pump();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).set({ ...cors, 'Content-Type': 'application/json' }).send(JSON.stringify({ error: 'Failed', details: err.message }));
    }
  }
}
