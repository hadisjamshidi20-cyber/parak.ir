// Parak site server: serves parak-site/ and proxies the chatbot to OpenRouter.
// The API key stays here on the server — it is never sent to the browser.
// Run: npm start   →   http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '.env.local')); } catch {}

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const SITE_DIR = path.join(__dirname, 'parak-site');

const MAX_HISTORY = 12;      // messages kept per request
const MAX_CHARS = 1000;      // per user message
const TIMEOUT_MS = 30_000;   // OpenRouter request timeout
const RATE_LIMIT = 20;       // chat requests per IP…
const RATE_WINDOW_MS = 60 * 60 * 1000; // …per hour, to protect OpenRouter credit

const SYSTEM_PROMPT = `تو دستیار فروش و پشتیبانی «پرک» هستی؛ برند ایرانی پوشاک دست‌دوز نوزاد و باکس هدیه.
لحن: گرم، مهربان، کوتاه و محترمانه؛ همیشه به فارسی جواب بده (مگر کاربر زبان دیگری بنویسد).

اطلاعات برند (فقط به همین‌ها تکیه کن و چیزی از خودت نساز):
- محصولات:
  • باکس هدیه «لطافت» — ۲٬۴۵۰٬۰۰۰ تومان — پوشاک نوزاد + کارت پیام دست‌نویس + بسته‌بندی کرم عاجی (پرفروش)
  • ست پوشاک نوزاد — ۹۸۰٬۰۰۰ تومان — پنبه‌ی ۱۰۰٪ ارگانیک، مناسب پوست حساس، شست‌وشو در ۳۰ درجه
  • باکس مناسبتی هدیه — ۳٬۱۰۰٬۰۰۰ تومان — مناسب تولد و مراسم، بسته‌بندی ظریف، تحویل سریع (جدید)
- پارچه‌ها بی‌آزار و مناسب پوست حساس نوزادند و پیش از تولید آزمایش کیفیت می‌شوند.
- ارسال: تهران ۱ تا ۲ روز کاری، سایر شهرها ۲ تا ۴ روز کاری.
- سفارش اختصاصی (کارت پیام و بسته‌بندی سفارشی) از طریق فرم تماس یا اینستاگرام.
- مرجوعی/تعویض: تا ۷ روز پس از دریافت در صورت مشکل کیفیت یا عدم رضایت.
- تماس: تلفن ۰۲۱-۱۲۳۴۵۶۷۸ — ایمیل hello@parak.ir — تهران.

قواعد:
- اگر جواب را نمی‌دانی (موجودی، سایز دقیق، تخفیف، وضعیت سفارش)، صادقانه بگو و کاربر را به تماس با پرک راهنمایی کن.
- برای انتخاب هدیه، سن نوزاد، مناسبت و بودجه را بپرس و یکی از محصولات بالا را پیشنهاد بده.
- توصیه‌ی پزشکی نده؛ برای مسائل پوستی یا سلامت، به پزشک ارجاع بده.
- جواب‌ها را کوتاه نگه دار (حداکثر چند جمله) و از markdown سنگین استفاده نکن.`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Simple in-memory per-IP limiter (resets on restart — enough for a small site).
const hits = new Map();
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) if (times.every(t => now - t >= RATE_WINDOW_MS)) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

async function handleChat(req, res) {
  if (!API_KEY) return sendJson(res, 500, { error: 'کلید OpenRouter روی سرور تنظیم نشده است.' });
  if (rateLimited(req)) return sendJson(res, 429, { error: 'تعداد پیام‌ها زیاد شده؛ لطفاً کمی بعد دوباره امتحان کنید یا با ما تماس بگیرید.' });

  let messages;
  try {
    messages = JSON.parse(await readBody(req)).messages;
  } catch {
    return sendJson(res, 400, { error: 'درخواست نامعتبر است.' });
  }
  if (!Array.isArray(messages) || !messages.length) return sendJson(res, 400, { error: 'پیامی ارسال نشده است.' });

  // Only accept plain user/assistant text from the browser; the system prompt is ours.
  const clean = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': SITE_URL,
        'X-Title': 'Parak',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...clean],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('OpenRouter error:', r.status, data?.error?.message);
      return sendJson(res, 502, { error: 'پاسخ از سرویس هوش مصنوعی دریافت نشد.' });
    }
    // The widget shows plain text, so drop markdown bold/headings the model may add.
    const reply = data.choices?.[0]?.message?.content?.trim()
      ?.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');
    sendJson(res, 200, { reply: reply || 'متأسفم، پاسخی آماده نشد. دوباره امتحان کنید.' });
  } catch (err) {
    console.error('OpenRouter request failed:', err.name === 'TimeoutError' ? 'timed out' : err.message);
    sendJson(res, 502, { error: 'ارتباط با سرویس هوش مصنوعی برقرار نشد.' });
  }
}

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const filePath = path.join(SITE_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(SITE_DIR + path.sep)) { res.writeHead(403); return res.end(); }

  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

http.createServer((req, res) => {
  if (req.url === '/api/chat' && req.method === 'POST') return handleChat(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, () => {
  console.log(`Parak: http://localhost:${PORT}  (model: ${MODEL})`);
  if (!API_KEY) console.warn('⚠ OPENROUTER_API_KEY is not set in .env.local');
});
