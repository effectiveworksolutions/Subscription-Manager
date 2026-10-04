// ═══════════════════════════════════════════════════════════════════════
//  SubTracker — find subscriptions from email
//
//  Connects a mailbox with OAuth (Gmail via Google Identity Services,
//  Outlook / Hotmail via Microsoft MSAL + Graph), searches the last year
//  for receipts, renewals and trial emails, and turns them into
//  subscription suggestions the person reviews before importing.
//
//  Privacy rules baked in here:
//   • read-only scopes only; we never ask for a password
//   • everything runs in the browser — email never touches our server
//   • the access token lives in memory only and is revoked when the scan
//     finishes (or the sheet closes)
//   • we keep the result (name, price, date, card last-4), not the emails
//
//  Also exports the parser (Discover.parse / analyze) so a pasted receipt
//  from any other mailbox (iCloud, Yahoo, work) goes through the same code.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const CFG = root.SUBTRACKER_CONFIG || {};
  const LIB = () => root.SERVICE_LIBRARY || [];
  const ALIASES = () => root.SERVICE_ALIASES || {};

  // ── small helpers ────────────────────────────────────────────────────
  const MULTI_TLD = /\.(com|co|net|org|edu|gov|ac)\.(au|nz|uk|jp|za|br|in|sg|hk|ar|mx|id|il|th|tr|pk|bd|ke|ng|ug|tz|eg|my|ph|vn|kr|tw)$/i;
  function baseDomain(host) {
    host = String(host || '').toLowerCase().replace(/^.*@/, '').replace(/[>\s].*$/, '').replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    return MULTI_TLD.test(host) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
  }
  function parseFrom(from) {
    // "Netflix <info@mailer.netflix.com>"  →  { name: 'Netflix', email: 'info@mailer.netflix.com' }
    const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
    const e = String(from || '').trim().toLowerCase();
    return { name: '', email: e };
  }
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  function htmlToText(html) {
    let h = String(html || '')
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(td|th)>/gi, '  ')
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer|blockquote|pre)>/gi, '\n');
    let text;
    if (typeof DOMParser !== 'undefined') {
      try { text = new DOMParser().parseFromString(h, 'text/html').body.textContent || ''; } catch { text = null; }
    }
    if (text == null) text = h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
    return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  function b64urlToText(s) {
    try {
      const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch { return ''; }
  }
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const dayDiff = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
  const pad2 = n => String(n).padStart(2, '0');
  const isoDate = d => { const x = new Date(d); return isNaN(x) ? '' : `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };

  // ── classification ───────────────────────────────────────────────────
  const RECEIPT_RE = /\b(receipt|invoice|payment|charged|billed|billing|renew(al|ed|s|ing)?|subscription|membership|order confirmation|your order|trial|statement|thanks? (you )?for (your )?(purchase|payment|order|subscribing)|purchase|confirmation of your|has been processed|auto-?renew|plan)\b/i;
  const MARKETING_RE = /\b(newsletter|what'?s new|new on|this week|coming soon|recommended for you|digest|sale|% off|webinar|don'?t miss|last chance|introducing|top picks|just added|new arrivals|watch now|new episodes|your weekly|tips|survey|feedback)\b/i;
  const CANCEL_RE = /\b(cancel(l)?ed|cancellation|has ended|membership ended|subscription ended|we'?re sorry to see you go|sorry to see you go|will not renew|won'?t renew|has expired|expired)\b/i;
  const TRIAL_RE = /\b(free trial|trial (period|ends|ending|started|has started|will end|expires)|your trial|start(ed)? your trial|trial subscription)\b/i;
  const FAILED_RE = /\b(payment (failed|declined|unsuccessful|didn'?t go through|could not|was declined)|declined|unable to process|update your payment|action required)\b/i;

  function classify(subject, snippet) {
    const s = clean(subject), both = s + ' ' + clean(snippet);
    const money = findAmounts(both).length > 0;
    const receipt = RECEIPT_RE.test(s) || (money && RECEIPT_RE.test(both));
    const marketing = MARKETING_RE.test(s) && !money;
    return { receipt: receipt && !marketing, marketing, cancelled: CANCEL_RE.test(s), trial: TRIAL_RE.test(both), failed: FAILED_RE.test(s), money };
  }

  // ── money ────────────────────────────────────────────────────────────
  const CUR_SYMBOL = { 'A$': 'AUD', 'AU$': 'AUD', 'AUD$': 'AUD', 'US$': 'USD', 'NZ$': 'NZD', 'CA$': 'CAD', '$': '', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  const MONEY_RE = /(?:(AUD\$|AU\$|A\$|US\$|NZ\$|CA\$|\$|€|£|¥)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?))|(?:(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})\s?(AUD|USD|EUR|GBP|NZD|CAD|JPY)\b)|(?:\b(AUD|USD|EUR|GBP|NZD|CAD|JPY)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}))/g;
  function findAmounts(text) {
    const out = []; let m; MONEY_RE.lastIndex = 0;
    const t = String(text || '');
    while ((m = MONEY_RE.exec(t))) {
      const raw = (m[2] || m[3] || m[6] || '').replace(/,/g, '');
      const value = parseFloat(raw);
      if (!isFinite(value) || value <= 0 || value > 50000) continue;
      const currency = m[1] ? CUR_SYMBOL[m[1]] || '' : (m[4] || m[5] || '');
      out.push({ value: Math.round(value * 100) / 100, currency, index: m.index, len: m[0].length });
    }
    return out;
  }
  // Pick the amount most likely to be "what you were charged"
  function pickAmount(text) {
    const amounts = findAmounts(text);
    if (!amounts.length) return null;
    const t = String(text);
    let best = null;
    amounts.forEach((a, i) => {
      const before = t.slice(Math.max(0, a.index - 70), a.index).toLowerCase();
      const after = t.slice(a.index + a.len, a.index + a.len + 40).toLowerCase();
      let score = 0;
      if (/\b(total|amount (charged|paid|due|billed)|you (paid|were charged)|charged|payment of|paid|billed|grand total|total charged|amount)\b[^\n]{0,30}$/.test(before)) score += 4;
      if (/\b(total|amount)\b/.test(before.slice(-25))) score += 2;
      if (/\b(subscription|renew|plan|membership)\b/.test(before)) score += 1;
      if (/\b(gst|tax|vat|subtotal|sub-total|discount|saved|savings|credit|refund|fee)\b[^\n]{0,15}$/.test(before)) score -= 3;
      if (/\b(was|previously|instead of|regular(ly)?|normally|rrp|save|off)\b[^\n]{0,15}$/.test(before)) score -= 2;
      if (/^\s*(off|discount|savings|saved|credit)/.test(after)) score -= 3;
      if (/^\s*(\/|per)\s?(month|mo|year|yr|week|wk)\b/.test(after)) score += 1;
      score += i / amounts.length; // later mentions (totals) win ties
      if (!best || score > best.score) best = { ...a, score };
    });
    return best;
  }

  // ── cycle, card, dates ───────────────────────────────────────────────
  const YEAR_RE = /\b(annual(ly)?|yearly|per year|per annum|\/\s?(year|yr|annum)|every (12 months|year)|12[- ]month|1[- ]year|one[- ]year)\b/i;
  const MONTH_RE = /\b(monthly|per month|\/\s?(month|mo)|each month|every month|1[- ]month|one[- ]month|30 days)\b/i;
  const WEEK_RE = /\b(weekly|per week|\/\s?(week|wk)|every week|each week|7 days)\b/i;
  function detectCycle(text, amount) {
    const t = String(text || '');
    if (amount) { // look right after the price first: "$22.99/month"
      const after = t.slice(amount.index + amount.len, amount.index + amount.len + 30);
      if (MONTH_RE.test(after)) return 'monthly';
      if (YEAR_RE.test(after)) return 'yearly';
      if (WEEK_RE.test(after)) return 'weekly';
      const before = t.slice(Math.max(0, amount.index - 60), amount.index);
      if (/\b(monthly|month)\b/i.test(before) && !/\b(annual|year)/i.test(before)) return 'monthly';
      if (/\b(annual|yearly|year)\b/i.test(before) && !/\bmonth/i.test(before)) return 'yearly';
    }
    const y = YEAR_RE.test(t), m = MONTH_RE.test(t), w = WEEK_RE.test(t);
    if (m && !y) return 'monthly';
    if (y && !m) return 'yearly';
    if (w && !m && !y) return 'weekly';
    return null;
  }
  const BRAND_RE = /\b(visa|mastercard|master card|amex|american express|discover|diners|paypal|apple pay|google pay|afterpay|zip pay|direct debit|bank account|klarna)\b/i;
  const LAST4_RE = /(?:ending(?: in| with)?|ends (?:in|with)|last (?:4|four) digits?(?: are)?|card number ending|card ending|\*{2,}\s?|x{2,}\s?|•{2,}\s?|·{2,}\s?|\.{2,}\s?|XXXX[- ]?|xxxx[- ]?)\s*:?\s*(\d{4})\b/i;
  const BRAND_LAST4_RE = /\b(visa|mastercard|master card|amex|american express|discover|diners)\b[^\d\n]{0,12}(\d{4})\b/i;
  const CARD_BRANDS = /\b(visa|mastercard|master card|amex|american express|discover|diners)\b/i;
  const niceBrand = b => b.replace(/\b\w/g, c => c.toUpperCase()).replace('Master Card', 'Mastercard').replace('Paypal', 'PayPal');
  function detectCard(text) {
    const t = String(text || '');
    let l = t.match(LAST4_RE), brand = '';
    if (l) { const near = (t.slice(Math.max(0, l.index - 30), l.index) + ' ' + t.slice(l.index + l[0].length, l.index + l[0].length + 16)).match(CARD_BRANDS); brand = near ? niceBrand(near[1]) : ''; }
    else { l = t.match(BRAND_LAST4_RE); if (l) { brand = niceBrand(l[1]); l = [l[0], l[2]]; } }
    if (l) return `${brand || 'Card'} •••• ${l[1]}`;
    const b = t.match(BRAND_RE);
    return b ? niceBrand(b[1]) : '';
  }
  function detectRenewalDate(text) {
    // "renews on 15 Nov 2026", "next billing date: 2026-11-15", "will renew on November 15, 2026"
    const t = String(text || '');
    const m = t.match(/\b(renew(?:s|al|ing)?(?: date)?|next (?:billing|payment|charge|renewal)(?: date)?|bills? again|charged again|due)\b[^\n.]{0,25}?\b(?:on|date|:)?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+[0-9]{4}|[A-Za-z]{3,9}\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i);
    if (!m) return '';
    return isoDate(m[2].replace(/(\d)(st|nd|rd|th)/g, '$1'));
  }

  // ── which service is this? ───────────────────────────────────────────
  const AGGREGATORS = { 'paypal.com': 'PayPal', 'paypal.com.au': 'PayPal', 'apple.com': 'Apple', 'itunes.com': 'Apple', 'google.com': 'Google Play', 'stripe.com': 'Stripe', 'shopify.com': 'Shopify', 'squareup.com': 'Square', 'afterpay.com': 'Afterpay', 'zip.co': 'Zip', 'paddle.com': 'Paddle', 'fastspring.com': 'FastSpring', 'gumroad.com': 'Gumroad', 'patreon.com': 'Patreon', 'amazon.com': 'Amazon', 'amazon.com.au': 'Amazon' };
  const NOISE_NAME_RE = /\b(no[- ]?reply|do[- ]?not[- ]?reply|noreply|billing|receipts?|invoices?|payments?|notifications?|team|support|accounts?|info|mailer|news|hello|customer (service|care))\b/gi;

  function findService(name, domain) {
    const lib = LIB();
    const d = baseDomain(domain || '');
    let svc = d ? lib.find(s => s.domain && (s.domain === d || baseDomain(s.domain) === d)) : null;
    if (!svc && name) {
      const key = clean(name).toLowerCase();
      svc = lib.find(s => s.name.toLowerCase() === key) || (ALIASES()[key] ? lib.find(s => s.name === ALIASES()[key]) : null)
        || lib.find(s => s.name.length > 3 && key.includes(s.name.toLowerCase()));
    }
    return svc && svc.name !== 'Custom…' ? svc : null;
  }
  function merchantFromAggregator(agg, subject, text) {
    const s = clean(subject), t = String(text || '');
    let m;
    if (agg === 'PayPal') {
      m = s.match(/(?:payment|receipt|you (?:sent|paid|made a payment))[^\n]*?\bto\s+(.+?)(?:\s*[-–|(]|\s+for\b|$)/i) || t.match(/\b(?:you (?:sent|paid|made an? (?:automatic )?payment)(?: of [^\s]+)?|payment sent) to\s+([^\n.]+?)(?:\s*[-–|(.]|\n|$)/i) || t.match(/\bMerchant:?\s*([^\n]+)/i) || t.match(/\bto\s+([A-Z][\w&' .-]{2,40}?)\s+(?:for|\$|A\$)/);
      if (m) return clean(m[1]);
    }
    if (agg === 'Apple') {
      m = t.match(/([A-Za-z0-9][^\n$()]{1,60}?)\s*\((?:Monthly|Yearly|Annual|Weekly|1 Month|1 Year|6 Months|3 Months|Quarterly)\)/) || t.match(/\bSubscription\s*(?:to|:)?\s*([^\n]+)/i) || t.match(/\bApp\s*:?\s*([^\n]+)/i);
      if (m) return clean(m[1]).replace(/\s*[-–,]\s*$/, '');
    }
    if (agg === 'Google Play') {
      m = t.match(/\bItem\s*:?\s*\n?\s*([^\n]+)/i) || s.match(/receipt from\s+(.+?)(?:\s*[-–|(]|$)/i) || t.match(/\(([^()\n]{2,40})\)\s*\n?[^\n]*\$/);
      if (m) return clean(m[1]).replace(/\s*\(.*$/, '');
    }
    if (agg === 'Stripe' || agg === 'Paddle' || agg === 'FastSpring' || agg === 'Shopify' || agg === 'Square' || agg === 'Gumroad') {
      m = s.match(/(?:your )?receipt from\s+(.+?)(?:\s*[-–|#(]|$)/i) || s.match(/(?:invoice|receipt)[^\n]*?\bfrom\s+(.+?)(?:\s*[-–|#(]|$)/i) || t.match(/\breceipt from\s+([^\n]+)/i);
      if (m) return clean(m[1]);
    }
    if (agg === 'Afterpay' || agg === 'Zip') {
      m = s.match(/(?:order|purchase|payment)\s+(?:from|at|to|with)\s+(.+?)(?:\s*[-–|(]|$)/i);
      if (m) return clean(m[1]);
    }
    if (agg === 'Amazon') {
      m = s.match(/\b(Prime|Kindle Unlimited|Audible|Amazon Music|Prime Video)\b/i) || t.match(/\b(Prime membership|Kindle Unlimited|Audible|Amazon Music Unlimited|Prime Video Channels?)\b/i);
      if (m) return /prime/i.test(m[1]) && !/video/i.test(m[1]) ? 'Amazon Prime' : clean(m[1]);
    }
    return '';
  }
  function identify(msg) {
    const f = parseFrom(msg.from);
    const domain = baseDomain(f.email);
    const agg = AGGREGATORS[domain] || '';
    let name = '', svc = null, via = '';
    if (agg) {
      const merchant = merchantFromAggregator(agg, msg.subject, msg.text || msg.snippet);
      via = agg;
      if (merchant) { svc = findService(merchant, ''); name = svc ? svc.name : merchant.replace(/\s+(pty\.? ltd\.?|ltd\.?|inc\.?|llc|limited|corp\.?|co\.?)\s*$/i, '').replace(/,\s*$/, ''); }
      else name = agg; // unmatched aggregator receipt: keep as "PayPal" / "Apple" so the person can rename it
    } else {
      svc = findService(f.name, domain);
      name = svc ? svc.name : clean(f.name.replace(NOISE_NAME_RE, ' ').replace(/[<>"]/g, '')) || (domain.split('.')[0] || 'Unknown').replace(/^\w/, c => c.toUpperCase());
    }
    const key = (svc ? svc.name : (via ? via + ':' + name : domain || name)).toLowerCase();
    return { key, name, svc, domain: svc ? svc.domain : (via ? '' : domain), via };
  }

  // ── parse one message into a candidate ──────────────────────────────
  function parseMessage(msg) {
    // msg: { id, from, subject, date, snippet?, text? }
    const text = String(msg.text || '') || clean(msg.snippet);
    const cls = classify(msg.subject, text.slice(0, 600));
    const who = identify({ ...msg, text });
    const amount = pickAmount(text) || pickAmount(msg.subject);
    const cycle = detectCycle(text, amount) || detectCycle(msg.subject, null);
    return {
      id: msg.id, date: isoDate(msg.date), subject: clean(msg.subject),
      ...who, ...cls,
      amount: amount ? amount.value : null, currency: amount ? amount.currency : '',
      cycle, card: detectCard(text), renews: detectRenewalDate(text), hasText: !!msg.text,
    };
  }

  // ── group messages into subscription suggestions ─────────────────────
  function analyze(messages, opts) {
    opts = opts || {};
    const existing = opts.existing || [];
    const parsed = messages.map(parseMessage).filter(p => p.date);
    const groups = new Map();
    for (const p of parsed) {
      if (!groups.has(p.key)) groups.set(p.key, []);
      groups.get(p.key).push(p);
    }
    const items = [];
    for (const [key, msgs] of groups) {
      msgs.sort((a, b) => b.date.localeCompare(a.date));
      const receipts = msgs.filter(m => m.receipt && !m.failed && !m.cancelled);
      const svc = msgs.find(m => m.svc) ? msgs.find(m => m.svc).svc : null;
      const relevant = receipts.length ? receipts : (svc && msgs.length >= 2 ? msgs.filter(m => !m.marketing) : []);
      if (!relevant.length) continue;
      const newest = relevant[0];
      const priced = relevant.find(m => m.amount != null);
      const price = priced ? priced.amount : null;
      const currency = priced ? priced.currency : '';
      // billing cycle: stated in the email, else from how often the receipts arrive
      let cycle = (priced && priced.cycle) || relevant.map(m => m.cycle).find(Boolean) || null, cycleSource = cycle ? 'email' : '';
      const dates = [...new Set(receipts.map(m => m.date))].sort();
      if (!cycle && dates.length >= 2) {
        const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(dayDiff(dates[i - 1], dates[i]));
        const g = median(gaps.filter(x => x > 2));
        if (g >= 25 && g <= 36) cycle = 'monthly'; else if (g >= 340 && g <= 390) cycle = 'yearly'; else if (g >= 6 && g <= 8) cycle = 'weekly';
        if (cycle) cycleSource = 'spacing';
      }
      let note = '';
      let finalPrice = price, finalCycle = cycle === 'weekly' ? 'monthly' : (cycle || 'monthly');
      if (cycle === 'weekly' && price != null) { finalPrice = Math.round(price * 52 / 12 * 100) / 100; note = `Billed weekly (${currency || '$'}${price.toFixed(2)}/week) — shown as a monthly amount`; }
      const cancelled = msgs.some(m => m.cancelled && m.date >= newest.date);
      const trial = newest.trial && !cancelled;
      const name = newest.name || key;
      const card = relevant.map(m => m.card).find(Boolean) || (newest.via === 'PayPal' ? 'PayPal' : '');
      const ex = matchExisting(existing, name, svc, newest.domain);
      const confidence = (svc && price != null) ? 'high' : price != null ? 'medium' : 'low';
      items.push({
        key, name, svc, domain: newest.domain, via: newest.via,
        price: finalPrice, currency, cycle: finalCycle, cycleSource, note,
        lastDate: newest.date, firstDate: relevant[relevant.length - 1].date, renews: relevant.map(m => m.renews).find(Boolean) || '',
        count: relevant.length, card, status: cancelled ? 'cancelled' : trial ? 'trial' : 'active',
        confidence, existing: ex,
        marketingOnly: !receipts.length,
        checked: !ex && !cancelled && confidence !== 'low',
        evidence: relevant.slice(0, 4).map(m => ({ id: m.id, subject: m.subject, date: m.date, amount: m.amount })),
        accountEmail: opts.accountEmail || '', provider: opts.provider || '',
      });
    }
    // best first: high confidence, then most recent
    const rank = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => (a.existing ? 1 : 0) - (b.existing ? 1 : 0) || rank[a.confidence] - rank[b.confidence] || b.lastDate.localeCompare(a.lastDate));
    return items;
  }
  function matchExisting(existing, name, svc, domain) {
    const n = clean(name).toLowerCase();
    return existing.find(s => {
      if (s.deletedAt) return false;
      const sn = clean(s.name).toLowerCase();
      if (sn === n) return true;
      if (svc && (sn === svc.name.toLowerCase() || ALIASES()[sn] === svc.name)) return true;
      if (domain && s.domain && baseDomain(s.domain) === baseDomain(domain)) return true;
      return sn.length > 3 && (n.includes(sn) || sn.includes(n));
    }) || null;
  }

  // Convert a reviewed item into a subscription object for the app
  function toSubscription(item, uuid) {
    const svc = item.svc;
    const emoji = svc ? svc.emoji : (root.EMOJI_MAP || {}).other || '📦';
    return {
      id: uuid(), name: clean(item.name), emoji,
      category: svc ? svc.category : 'other',
      price: item.price != null ? Number(item.price) : 0,
      cycle: item.cycle === 'yearly' ? 'yearly' : 'monthly',
      status: item.status || 'active',
      startDate: item.lastDate || '',
      paymentMethod: item.card || '',
      url: svc ? svc.url : '', domain: svc ? svc.domain : (item.domain || ''),
      notes: [item.note, item.via ? `Paid through ${item.via}` : ''].filter(Boolean).join(' · '),
      accountEmail: item.accountEmail || '',
      source: item.provider ? 'email:' + item.provider : 'email',
      updatedAt: new Date().toISOString(),
    };
  }

  // ── search terms shared by the providers ─────────────────────────────
  const SUBJECT_TERMS = ['receipt', 'invoice', 'subscription', 'renewal', 'renewed', 'membership', '"payment confirmation"', '"payment received"', '"your payment"', '"has been charged"', '"free trial"', '"trial ends"', '"your order"', '"tax invoice"', '"billing statement"', '"thanks for your payment"', '"thank you for your purchase"'];
  function libraryDomains() {
    const seen = new Set();
    for (const s of LIB()) { const d = s.domain && baseDomain(s.domain); if (d && !AGGREGATORS[d]) seen.add(d); }
    return [...seen];
  }
  const AGG_DOMAINS = Object.keys(AGGREGATORS);
  const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

  // ── script loading (SDKs are loaded only when the person opens the sheet) ──
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      if (typeof document === 'undefined') return rej(new Error('no document'));
      const s = document.createElement('script'); s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  async function pool(items, limit, fn, onEach) {
    const out = new Array(items.length); let i = 0, done = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } done++; if (onEach) onEach(done, items.length); }
    });
    await Promise.all(workers); return out;
  }

  // ═══ Gmail ═══════════════════════════════════════════════════════════
  const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const gmail = {
    id: 'gmail', label: 'Gmail', hint: 'Google accounts (gmail.com, Google Workspace)',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    ready: () => !!CFG.GOOGLE_CLIENT_ID,
    _tc: null,
    async prepare() { await loadScript('https://accounts.google.com/gsi/client'); },
    // Must be called from a click handler (opens Google's popup)
    connect(opts) {
      opts = opts || {};
      return new Promise((resolve, reject) => {
        const g = root.google && root.google.accounts && root.google.accounts.oauth2;
        if (!g) return reject(new Error('Google sign-in did not load — check your connection and try again'));
        const tc = g.initTokenClient({
          client_id: CFG.GOOGLE_CLIENT_ID, scope: gmail.scope, login_hint: opts.loginHint || undefined,
          callback: r => (r && r.access_token) ? resolve({ provider: 'gmail', token: r.access_token, expiresAt: Date.now() + (r.expires_in || 3600) * 1000 }) : reject(new Error(r && r.error === 'access_denied' ? 'cancelled' : (r && r.error) || 'cancelled')),
          error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? 'cancelled' : (e && e.type) || 'popup_failed')),
        });
        tc.requestAccessToken({ prompt: opts.prompt || '' });
      });
    },
    async api(session, path, params) {
      const u = new URL(GMAIL + path); Object.entries(params || {}).forEach(([k, v]) => Array.isArray(v) ? v.forEach(x => u.searchParams.append(k, x)) : u.searchParams.set(k, v));
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + session.token } });
      if (r.status === 401) throw new Error('Google access expired — connect again');
      if (r.status === 403) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || 'Google refused the request (is Gmail reading allowed for this app?)'); }
      if (!r.ok) throw new Error('Gmail error ' + r.status);
      return r.json();
    },
    async profile(session) { const p = await gmail.api(session, '/profile'); return p.emailAddress || ''; },
    async listIds(session, q, cap) {
      const ids = []; let pageToken;
      do {
        const j = await gmail.api(session, '/messages', { q, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
        (j.messages || []).forEach(m => ids.push(m.id)); pageToken = j.nextPageToken;
      } while (pageToken && ids.length < cap);
      return ids.slice(0, cap);
    },
    async search(session, { months, onProgress }) {
      const age = `newer_than:${months || 12}m`;
      const queries = [
        `${age} subject:(${SUBJECT_TERMS.join(' OR ')})`,
        ...chunk(libraryDomains(), 30).map(ds => `${age} from:(${ds.join(' OR ')})`),
        `${age} from:(${AGG_DOMAINS.join(' OR ')}) (receipt OR payment OR invoice OR subscription OR renew OR order)`,
      ];
      const ids = new Set();
      for (let i = 0; i < queries.length; i++) {
        onProgress && onProgress({ stage: 'search', done: i, total: queries.length });
        try { (await gmail.listIds(session, queries[i], 300)).forEach(id => ids.add(id)); } catch (e) { if (/expired|refused/.test(e.message)) throw e; }
        if (ids.size > 900) break;
      }
      const all = [...ids].slice(0, 900);
      onProgress && onProgress({ stage: 'headers', done: 0, total: all.length });
      const metas = await pool(all, 8, async id => {
        const m = await gmail.api(session, '/messages/' + id, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
        const h = {}; (m.payload && m.payload.headers || []).forEach(x => { h[x.name.toLowerCase()] = x.value; });
        return { id, from: h.from || '', subject: h.subject || '', date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : h.date || '', snippet: m.snippet || '' };
      }, (d, t) => onProgress && onProgress({ stage: 'headers', done: d, total: t }));
      return metas.filter(Boolean);
    },
    async body(session, id) {
      const m = await gmail.api(session, '/messages/' + id, { format: 'full' });
      const out = { text: '', html: '' };
      const walk = p => { if (!p) return; const mt = (p.mimeType || '').toLowerCase(); if (p.body && p.body.data) { const s = b64urlToText(p.body.data); if (mt.startsWith('text/html')) out.html += s; else if (mt.startsWith('text/plain')) out.text += s + '\n'; } (p.parts || []).forEach(walk); };
      walk(m.payload);
      return out.html ? htmlToText(out.html) : clean(out.text) ? out.text : clean(m.snippet || '');
    },
    disconnect(session) {
      try { const g = root.google && root.google.accounts && root.google.accounts.oauth2; if (g && session && session.token) g.revoke(session.token, () => {}); } catch {}
    },
  };

  // ═══ Outlook / Hotmail / Microsoft 365 (MSAL + Graph) ═══════════════
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const outlook = {
    id: 'outlook', label: 'Outlook', hint: 'Outlook.com, Hotmail, Live and Microsoft 365 accounts',
    scopes: ['Mail.Read', 'User.Read'],
    ready: () => !!CFG.MS_CLIENT_ID,
    _pca: null,
    async prepare() {
      await loadScript('https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js');
      if (!outlook._pca) {
        outlook._pca = new root.msal.PublicClientApplication({
          // must match a registered SPA redirect URI exactly: the app folder, never index.html
          auth: { clientId: CFG.MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/common', redirectUri: location.origin + location.pathname.replace(/index\.html?$/i, '') },
          cache: { cacheLocation: 'sessionStorage' },
        });
        await outlook._pca.initialize();
      }
    },
    async connect(opts) {
      opts = opts || {};
      const pca = outlook._pca; if (!pca) throw new Error('Microsoft sign-in did not load — check your connection and try again');
      let r;
      try { r = await pca.loginPopup({ scopes: outlook.scopes, prompt: opts.loginHint ? undefined : 'select_account', loginHint: opts.loginHint || undefined }); }
      catch (e) {
        if (e && /user_cancelled|popup_window_error|empty_window_error|monitor_window_timeout/.test(e.errorCode || '')) {
          if (e.errorCode === 'user_cancelled') throw new Error('cancelled');
          // popups blocked (iOS PWA etc.) → full-page redirect; the app resumes the scan on return
          try { sessionStorage.setItem('subtracker_discover_resume', 'outlook'); } catch {}
          await pca.loginRedirect({ scopes: outlook.scopes, prompt: 'select_account' });
          return new Promise(() => {}); // page navigates away
        }
        throw e;
      }
      return { provider: 'outlook', token: r.accessToken, expiresAt: r.expiresOn ? r.expiresOn.getTime() : Date.now() + 3600000, account: r.account, email: (r.account && r.account.username) || '' };
    },
    // After a loginRedirect round-trip: returns a session if one is waiting, else null
    async resume() {
      let pending = ''; try { pending = sessionStorage.getItem('subtracker_discover_resume') || ''; sessionStorage.removeItem('subtracker_discover_resume'); } catch {}
      if (pending !== 'outlook' || !outlook.ready()) return null;
      await outlook.prepare();
      const r = await outlook._pca.handleRedirectPromise();
      if (!r || !r.accessToken) return null;
      return { provider: 'outlook', token: r.accessToken, expiresAt: r.expiresOn ? r.expiresOn.getTime() : Date.now() + 3600000, account: r.account, email: (r.account && r.account.username) || '' };
    },
    async api(session, url, headers) {
      const r = await fetch(url.startsWith('http') ? url : GRAPH + url, { headers: { Authorization: 'Bearer ' + session.token, ...(headers || {}) } });
      if (r.status === 401) throw new Error('Microsoft access expired — connect again');
      if (r.status === 429) { await new Promise(res => setTimeout(res, 2000)); return outlook.api(session, url, headers); }
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || 'Outlook error ' + r.status); }
      return r.json();
    },
    async profile(session) {
      if (session.email) return session.email;
      const me = await outlook.api(session, '/me?$select=mail,userPrincipalName'); return me.mail || me.userPrincipalName || '';
    },
    async search(session, { months, onProgress }) {
      const since = new Date(); since.setMonth(since.getMonth() - (months || 12));
      const sinceIso = since.toISOString().slice(0, 10);
      const sel = '$select=id,subject,from,receivedDateTime,bodyPreview&$top=100';
      const queries = [
        `(${SUBJECT_TERMS.map(t => `subject:${t}`).join(' OR ')})`,
        ...chunk(libraryDomains(), 25).map(ds => `(${ds.map(d => `from:${d}`).join(' OR ')})`),
        `(${AGG_DOMAINS.map(d => `from:${d}`).join(' OR ')}) AND (receipt OR payment OR invoice OR subscription)`,
      ];
      const seen = new Map();
      let dateClauseOk = true; // KQL date filter; if Graph rejects it we fall back to filtering client-side
      const runQuery = async q => {
        let url = `${GRAPH}/me/messages?$search=${encodeURIComponent('"' + q.replace(/"/g, '\\"') + '"')}&${sel}`;
        let n = 0;
        while (url && n < 250) {
          const j = await outlook.api(session, url);
          for (const m of (j.value || [])) {
            if (m.receivedDateTime && m.receivedDateTime < since.toISOString()) continue;
            const fa = m.from && m.from.emailAddress || {};
            seen.set(m.id, { id: m.id, from: `${fa.name || ''} <${fa.address || ''}>`, subject: m.subject || '', date: m.receivedDateTime || '', snippet: m.bodyPreview || '' });
            n++;
          }
          url = j['@odata.nextLink'] || '';
        }
      };
      for (let i = 0; i < queries.length; i++) {
        onProgress && onProgress({ stage: 'search', done: i, total: queries.length });
        try {
          if (dateClauseOk) { try { await runQuery(`${queries[i]} AND received>=${sinceIso}`); } catch (e) { if (/expired/.test(e.message)) throw e; dateClauseOk = false; await runQuery(queries[i]); } }
          else await runQuery(queries[i]);
        } catch (e) { if (/expired/.test(e.message)) throw e; }
        if (seen.size > 900) break;
      }
      return [...seen.values()];
    },
    async body(session, id) {
      const m = await outlook.api(session, `/me/messages/${encodeURIComponent(id)}?$select=body,bodyPreview`, { Prefer: 'outlook.body-content-type="text"' });
      const b = m.body && m.body.content || '';
      return (m.body && m.body.contentType === 'html') ? htmlToText(b) : (clean(b) || m.bodyPreview || '');
    },
    disconnect(session) {
      try { if (outlook._pca && session && session.account) outlook._pca.clearCache({ account: session.account }); } catch {}
    },
  };

  const providers = { gmail, outlook };

  // ═══ the whole scan ══════════════════════════════════════════════════
  // opts: { months, existing, onProgress }
  async function scan(session, opts) {
    opts = opts || {};
    const p = providers[session.provider];
    const progress = s => opts.onProgress && opts.onProgress(s);
    const email = session.email || await p.profile(session).catch(() => '');
    const metas = await p.search(session, { months: opts.months || 12, onProgress: progress });

    // First pass on headers + snippets, then fetch the full text of up to
    // 3 recent receipt-like emails per sender to read the amount / card / cycle.
    const prelim = metas.map(m => ({ m, p: parseMessage(m) }));
    const bySender = new Map();
    for (const x of prelim) { if (!bySender.has(x.p.key)) bySender.set(x.p.key, []); bySender.get(x.p.key).push(x); }
    const toFetch = [];
    for (const [, list] of bySender) {
      list.sort((a, b) => b.p.date.localeCompare(a.p.date));
      const svcKnown = list.some(x => x.p.svc);
      const picks = list.filter(x => x.p.receipt && !x.p.marketing).slice(0, 3);
      if (!picks.length && svcKnown) picks.push(...list.filter(x => !x.p.marketing).slice(0, 2));
      picks.forEach(x => toFetch.push(x));
    }
    progress({ stage: 'read', done: 0, total: toFetch.length });
    await pool(toFetch, 5, async x => { x.m.text = await p.body(session, x.m.id); }, (d, t) => progress({ stage: 'read', done: d, total: t }));
    progress({ stage: 'analyze', done: 0, total: 1 });
    const items = analyze(metas, { existing: opts.existing || [], accountEmail: email, provider: session.provider });
    try { p.disconnect(session); } catch {}
    return { email, items, scanned: metas.length, read: toFetch.length };
  }

  root.Discover = {
    providers, scan, analyze, parseMessage, toSubscription,
    // for pasted receipts (any mailbox)
    fromPasted(text, opts) {
      opts = opts || {};
      const t = String(text || '');
      const from = (t.match(/^\s*From:\s*(.+)$/im) || [])[1] || '';
      const subject = (t.match(/^\s*Subject:\s*(.+)$/im) || [])[1] || '';
      const date = (t.match(/^\s*(?:Date|Sent):\s*(.+)$/im) || [])[1] || new Date().toISOString();
      const body = t.replace(/^\s*(From|To|Subject|Date|Sent|Cc):.*$/gim, '').trim();
      const items = analyze([{ id: 'pasted', from: from || (opts.fromName || 'Unknown <unknown@unknown.invalid>'), subject: subject || body.split('\n')[0].slice(0, 120), date, snippet: body.slice(0, 300), text: body || t }],
        { existing: opts.existing || [], accountEmail: opts.accountEmail || '', provider: 'pasted' });
      if (!items.length) { // force one candidate even if it didn't look like a receipt
        const p = parseMessage({ id: 'pasted', from: from || 'Unknown <unknown@unknown.invalid>', subject, date, text: body || t });
        items.push({ key: p.key, name: p.name, svc: p.svc, domain: p.domain, via: p.via, price: p.amount, currency: p.currency, cycle: p.cycle === 'yearly' ? 'yearly' : 'monthly', cycleSource: p.cycle ? 'email' : '', note: '', lastDate: p.date || isoDate(new Date()), firstDate: p.date, renews: p.renews, count: 1, card: p.card, status: p.cancelled ? 'cancelled' : p.trial ? 'trial' : 'active', confidence: p.amount != null ? 'medium' : 'low', existing: matchExisting(opts.existing || [], p.name, p.svc, p.domain), checked: true, evidence: [], accountEmail: opts.accountEmail || '', provider: 'pasted' });
      }
      return items;
    },
    _internal: { baseDomain, parseFrom, htmlToText, findAmounts, pickAmount, detectCycle, detectCard, detectRenewalDate, classify, identify, libraryDomains, matchExisting },
  };
})(typeof window !== 'undefined' ? window : globalThis);
