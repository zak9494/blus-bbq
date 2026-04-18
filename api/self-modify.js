const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'zak9494/blus-bbq';
const FILE_PATH = 'index.html';

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'blus-bbq-self-modify',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN is not set in environment variables' });
  }

  // GET - fetch current index.html content from GitHub
  if (req.method === 'GET') {
    try {
      const result = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${FILE_PATH}`);
      if (result.status !== 200) {
        return res.status(result.status).json({ error: `GitHub returned ${result.status}`, details: result.body });
      }
      const content = Buffer.from(result.body.content, 'base64').toString('utf8');
      return res.status(200).json({ content, sha: result.body.sha });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST - update index.html on GitHub
  if (req.method === 'POST') {
    const { action, content } = req.body;
    if (action !== 'update') return res.status(400).json({ error: 'action must be "update"' });
    if (!content) return res.status(400).json({ error: 'content is required' });

    try {
      // Get current SHA if file exists (not required for new files)
      const getResult = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${FILE_PATH}`);
      let sha = null;
      if (getResult.status === 200) {
        sha = getResult.body.sha;
      } else if (getResult.status !== 404) {
        return res.status(500).json({ error: 'Could not fetch current file from GitHub' });
      }

      const encodedContent = Buffer.from(content, 'utf8').toString('base64');
      const putBody = {
        message: 'Dashboard self-modification via AI assistant',
        content: encodedContent,
      };
      if (sha) putBody.sha = sha;

      const updateResult = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${FILE_PATH}`, putBody);

      if (updateResult.status !== 200 && updateResult.status !== 201) {
        return res.status(updateResult.status).json({ error: 'GitHub update failed', details: updateResult.body });
      }

      return res.status(200).json({ success: true, commit: updateResult.body.commit?.sha });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
