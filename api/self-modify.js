export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'zak9494/blus-bbq';
  if (!token) return res.status(500).json({ error: 'GitHub token not configured' });

  const { action, content, message } = req.body;

  if (action === 'get') {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      const data = await r.json();
      return res.status(200).json({ sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'update') {
    try {
      const getR = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      const getData = await getR.json();
      const sha = getData.sha;

      const updateR = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
        method: 'PUT',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: message || 'AI dashboard update',
          content: Buffer.from(content).toString('base64'),
          sha
        })
      });
      const updateData = await updateR.json();
      if (updateData.commit) {
        return res.status(200).json({ success: true, commit: updateData.commit.sha });
      }
      return res.status(500).json({ error: 'Commit failed', details: updateData });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
