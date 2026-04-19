/**
 * POST /api/quotes/ai-generate
 * R4-1 Phase 3 — Generates a structured catering quote from a Phase-2 extracted inquiry.
 *
 * Input (JSON body): Phase 2 extracted inquiry object:
 *   { customer_name, customer_email, customer_phone, event_date, event_time,
 *     event_type, guest_count (number|null), venue_name, venue_address,
 *     menu_preferences (string[]|null), dietary_restrictions (string[]|null),
 *     budget (number|null), special_requests, missing_fields }
 *
 * Output:
 *   { ok, quote: { line_items, food_subtotal, service_charge_pct, service_charge,
 *                  delivery_fee, total, notes, unresolved_preferences,
 *                  needs_customer_input }, model, input_tokens, output_tokens, generatedAt }
 *
 * Secret gate: ?secret=GMAIL_READ_SECRET or X-Secret header.
 * Model: claude-sonnet-4-6 (non-streaming, native https.request).
 */

module.exports.config = { maxDuration: 60 };

const https = require('https');
const { MENU, DELIVERY_FEE, suggestServiceCharge } = require('../_lib/menu');

// Build a flat, searchable menu string for the system prompt
function menuToPromptString() {
  const lines = [];
  for (const [category, items] of Object.entries(MENU)) {
    lines.push(`\n### ${category.toUpperCase()}`);
    for (const item of items) {
      lines.push(`  id:${item.id} | "${item.name}" | unit:${item.unit} | price:$${item.price}`);
    }
  }
  return lines.join('\n');
}

function buildSystemPrompt(serviceType, budget, guestCount) {
  const suggestedChargePct = suggestServiceCharge(serviceType, budget, guestCount || 0);
  const deliveryFee = (serviceType === 'delivery' || serviceType === 'delivery_setup') ? DELIVERY_FEE : 0;

  return `You are a catering quote generator for Blu's Barbeque, a BBQ catering company in Dallas, TX.

You will receive a catering inquiry and must generate a detailed, accurate quote.

══════════════════════════════════════════════
CANONICAL MENU + PRICING — USE ONLY THESE PRICES, NEVER INVENT
══════════════════════════════════════════════
${menuToPromptString()}

══════════════════════════════════════════════
FEE STRUCTURE (pre-calculated for this inquiry)
══════════════════════════════════════════════
Delivery fee: $${deliveryFee} (flat, already determined from service_type)
Suggested service charge: ${suggestedChargePct}% of food_subtotal
  Use this percentage unless the inquiry budget field provides strong reason to adjust.

══════════════════════════════════════════════
PORTION GUIDELINES (standard catering rules)
══════════════════════════════════════════════
Meats (per lb):
  - Single meat: 0.5 lb per person. Multiple meats: divide evenly (e.g., 3 meats = ~0.34 lb each).
  - Round each meat quantity UP to nearest 0.5 lb. Minimum 1 lb.
Chicken halves (ea): 1 per person. Chicken wholes (ea): 1 per 2 people.
Sides (half pan): 1 half-pan feeds 20–25 people. Round UP. Minimum 1 half-pan.
Packages (per person): multiply by guest_count directly.
Drinks (gallon): 1 gallon per 15 people. Round UP.
Extras (per person): multiply by guest_count for plates, cutlery, etc.

══════════════════════════════════════════════
MATCHING RULES
══════════════════════════════════════════════
1. Map each menu_preference to the CLOSEST matching menu item by name.
   Examples: "brisket" → "Brisket (sliced)", "mac and cheese" → "5 Cheese Mac & Cheese",
             "baked beans" or "beans" → "Smoked Baked Beans",
             "sausage" → "Sausage (pork & beef)" (default, note the alternative).
2. If a preference matches multiple items, pick the most common/affordable variant; note the alternative in notes.
3. If NO match exists in the menu, add the preference to unresolved_preferences and DO NOT create a line item.
4. NEVER invent a price. Every line item unit_price must exactly match a price in the menu above.
5. Do NOT add items the customer did not mention (no upsells, no extras unless requested).

══════════════════════════════════════════════
MATH RULES
══════════════════════════════════════════════
- subtotal per line = round(qty * unit_price, 2)
- food_subtotal = sum of all line item subtotals
- service_charge = round(food_subtotal * service_charge_pct / 100, 2)
- total = food_subtotal + service_charge + delivery_fee
- All numbers must be plain numbers (not strings). Round to 2 decimal places.

══════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════
Return ONLY valid JSON — no markdown fences, no explanation, no extra text.

Schema:
{
  "line_items": [
    {
      "name": "string (menu item name)",
      "category": "string (meats|packages|sides|desserts|drinks|extras)",
      "unit": "string",
      "qty": number,
      "unit_price": number,
      "subtotal": number
    }
  ],
  "food_subtotal": number,
  "service_charge_pct": number,
  "service_charge": number,
  "delivery_fee": number,
  "total": number,
  "notes": "string or null",
  "unresolved_preferences": ["strings"],
  "needs_customer_input": boolean
}

EDGE CASE — if guest_count is null OR menu_preferences is null or empty:
  Set needs_customer_input: true, line_items: [], all numeric fields: 0,
  notes: "Cannot generate quote — [list what is missing]. Send request-more-info email first."`;
}

function callAnthropic(apiKey, systemPrompt, inquiryJson) {
  const userContent = 'Generate a quote for this catering inquiry:\n\n' + JSON.stringify(inquiryJson, null, 2);

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody),
      }
    };
    const req = https.request(opts, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Secret gate ─────────────────────────────────────────────────────────────
  const secret = process.env.GMAIL_READ_SECRET;
  const provided = (req.query && req.query.secret) || req.headers['x-secret'];
  if (!secret) return res.status(500).json({ error: 'GMAIL_READ_SECRET env var not configured' });
  if (provided !== secret) return res.status(401).json({ error: 'Unauthorized — invalid or missing secret' });

  // ── API key check ────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY env var not configured' });

  // ── Parse input ──────────────────────────────────────────────────────────────
  let inquiry = req.body;
  if (typeof inquiry === 'string') {
    try { inquiry = JSON.parse(inquiry); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
  }
  inquiry = inquiry || {};

  // Determine service type from special_requests or default to unknown
  // Callers can pass service_type directly or we infer from special_requests
  const serviceType = inquiry.service_type ||
    (/delivery.*setup|setup.*delivery|full.service/i.test(inquiry.special_requests || '') ? 'delivery_setup' :
     /delivery/i.test(inquiry.special_requests || '') ? 'delivery' : 'pickup');

  // Map numeric budget to bucket
  const budgetBucket = inquiry.budget
    ? (inquiry.budget < 1000 ? 'tight' : inquiry.budget > 5000 ? 'flexible' : 'unknown')
    : 'unknown';

  const guestCount = inquiry.guest_count || null;
  const menuPrefs = inquiry.menu_preferences;

  // Build system prompt with pre-computed fees/charge
  const systemPrompt = buildSystemPrompt(serviceType, budgetBucket, guestCount);

  // ── Call Claude ──────────────────────────────────────────────────────────────
  let anthropicResp;
  try {
    anthropicResp = await callAnthropic(apiKey, systemPrompt, inquiry);
  } catch (e) {
    return res.status(502).json({ error: 'Anthropic API request failed', detail: e.message });
  }

  if (anthropicResp.status >= 300) {
    return res.status(502).json({
      error: 'Anthropic API error ' + anthropicResp.status,
      detail: anthropicResp.body
    });
  }

  const rawText = (anthropicResp.body.content && anthropicResp.body.content[0] &&
                   anthropicResp.body.content[0].text) || '';

  let quote;
  try {
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    quote = JSON.parse(jsonStr);
  } catch (e) {
    return res.status(502).json({
      error: 'Claude returned non-JSON response',
      raw: rawText.slice(0, 500),
      detail: e.message
    });
  }

  // ── Server-side math verification ────────────────────────────────────────────
  // Re-compute totals from line items to catch any Claude arithmetic errors
  if (!quote.needs_customer_input && Array.isArray(quote.line_items) && quote.line_items.length > 0) {
    const computedFoodSubtotal = Math.round(
      quote.line_items.reduce((sum, li) => sum + (li.qty * li.unit_price), 0) * 100
    ) / 100;
    const computedChargePct   = typeof quote.service_charge_pct === 'number' ? quote.service_charge_pct : 0;
    const computedCharge      = Math.round(computedFoodSubtotal * computedChargePct / 100 * 100) / 100;
    const computedDelivery    = typeof quote.delivery_fee === 'number' ? quote.delivery_fee : 0;
    const computedTotal       = Math.round((computedFoodSubtotal + computedCharge + computedDelivery) * 100) / 100;

    // Patch any discrepancies
    quote.food_subtotal  = computedFoodSubtotal;
    quote.service_charge = computedCharge;
    quote.total          = computedTotal;

    // Also patch individual line subtotals
    for (const li of quote.line_items) {
      li.subtotal = Math.round(li.qty * li.unit_price * 100) / 100;
    }
  }

  return res.status(200).json({
    ok: true,
    quote,
    model: 'claude-sonnet-4-6',
    input_tokens:  anthropicResp.body.usage && anthropicResp.body.usage.input_tokens,
    output_tokens: anthropicResp.body.usage && anthropicResp.body.usage.output_tokens,
    generatedAt: new Date().toISOString(),
  });
};
