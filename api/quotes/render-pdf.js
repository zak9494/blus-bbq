/**
 * POST /api/quotes/render-pdf
 * Generates a Blu's BBQ catering quote PDF from a quote object.
 * Secret-gated (GMAIL_READ_SECRET).
 *
 * Body: { quote, customerName? }
 * Returns: application/pdf bytes
 */

module.exports.config = { maxDuration: 10 };

const { generateQuotePDF } = require('../_lib/pdf-gen');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret   = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }

  const { quote, customerName } = body;
  if (!quote) return res.status(400).json({ error: 'quote is required' });

  try {
    const pdfBuf = generateQuotePDF(quote, customerName || '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Blus-BBQ-Quote.pdf"');
    res.setHeader('Content-Length', pdfBuf.length);
    return res.status(200).send(pdfBuf);
  } catch (e) {
    return res.status(500).json({ error: 'PDF generation failed', detail: e.message });
  }
};
