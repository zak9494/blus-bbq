export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?gmail_error=' + encodeURIComponent(error));
  }

  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = 'https://blus-bbq.vercel.app/api/auth/callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      return res.redirect('/?gmail_error=' + encodeURIComponent(tokens.error_description || tokens.error));
    }

    const cookieOpts = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';
    res.setHeader('Set-Cookie', [
      `gmail_access_token=${tokens.access_token}; ${cookieOpts}`,
      `gmail_refresh_token=${tokens.refresh_token || ''}; ${cookieOpts}`
    ]);

    return res.redirect('/?gmail_connected=true');
  } catch (err) {
    return res.redirect('/?gmail_error=' + encodeURIComponent('Token exchange failed'));
  }
}
