export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const body = await req.json();
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
      return new Response(JSON.stringify({ error: 'Anthropic error', details: err }), { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed', details: err.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}
