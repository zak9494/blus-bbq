export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cookies = parseCookies(req.headers.cookie || '');
  let accessToken = cookies.gmail_access_token;
  const refreshToken = cookies.gmail_refresh_token;

  if (!accessToken && !refreshToken) {
    return res.status(401).json({ error: 'Gmail not connected', needsAuth: true });
  }

  if (!accessToken && refreshToken) {
    accessToken = await refreshAccessToken(refreshToken, res);
    if (!accessToken) return res.status(401).json({ error: 'Could not refresh Gmail token', needsAuth: true });
  }

  const { to, subject, body, name } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing to, subject, or body' });
  }

  const emailLines = [
    `To: ${name ? `${name} <${to}>` : to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body
  ];
  const raw = Buffer.from(emailLines.join('\r\n')).toString('base64url');

  try {
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });

    const result = await sendRes.json();

    if (result.error) {
      if (result.error.code === 401) {
        const newToken = await refreshAccessToken(refreshToken, res);
        if (newToken) {
          return handler({ ...req, headers: { ...req.headers } }, res);
        }
        return res.status(401).json({ error: 'Gmail token expired', needsAuth: true });
      }
      return res.status(500).json({ error: result.error.message });
    }

    return res.status(200).json({ success: true, messageId: result.id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send email', details: err.message });
  }
}

async function refreshAccessToken(refreshToken, res) {
  if (!refreshToken) return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    const data = await r.json();
    if (data.access_token) {
      res.setHeader('Set-Cookie', `gmail_access_token=${data.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`);
      return data.access_token;
    }
    return null;
  } catch { return null; }
}

function parseCookies(cookieStr) {
  return Object.fromEntries(
    cookieStr.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}
