export default function handler(req, res) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = 'https://blus-bbq.vercel.app/api/auth/callback';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    access_type: 'offline',
    prompt: 'consent'
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return res.status(200).json({ url });
}
