import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import nodemailer from 'nodemailer';

// Exported factory allows isolated tests without a real recipient or SMTP credentials.
export function createHandler({ origin, mailEnabled = false, from, to, transport, maxPerWindow = 5 }) {
  const clients = new Map();
  const windowMs = 10 * 60 * 1000;
  const cleanup = () => { const now = Date.now(); for (const [key, value] of clients) if (value.until <= now) clients.delete(key); };
  return async function handler(req, res) {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { status: 'alive', mailEnabled });
    if (req.url !== '/api/lead') return reply(404, { error: 'not_found' });
    if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    if (!origin || req.headers.origin !== origin) return reply(403, { error: 'origin_denied' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'json_required' });
    if (!mailEnabled) return reply(503, { error: 'mail_not_enabled' });
    // Only safe when service binds loopback and local Nginx REPLACES this header.
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown');
    cleanup();
    if (!clients.has(ip)) {
      if (clients.size >= 10000) return reply(503, { error: 'busy' });
      clients.set(ip, { count: 0, until: Date.now() + windowMs });
    }
    const client = clients.get(ip);
    if (++client.count > maxPerWindow) return reply(429, { error: 'too_many_requests' });
    const chunks = [];
    let bytes = 0, exceeded = false;
    try {
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > 16384) { exceeded = true; break; }
        chunks.push(chunk);
      }
      if (exceeded) return reply(413, { error: 'body_too_large' });
      const raw = Buffer.concat(chunks).toString('utf8');
      let data;
      try { data = JSON.parse(raw); } catch { return reply(400, { error: 'invalid_json' }); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, { error: 'invalid_fields' });
      const string = (key, max) => typeof data[key] === 'string' && data[key].length <= max && !data[key].includes('\0');
      if (!string('name', 120) || !data.name.trim() || !string('contact', 200) || !string('message', 3000) || !string('formId', 80) || !data.formId.trim() || !string('page', 500) || data.consent !== true || (data.extra_note !== undefined && !string('extra_note', 200))) return reply(400, { error: 'invalid_fields' });
      const contact = data.contact.trim();
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
      const phone = /^[+()\d\s.-]+$/.test(contact) && contact.replace(/\D/g, '').length >= 7 && contact.replace(/\D/g, '').length <= 15;
      if ((!email && !phone) || /[\r\n]/.test(contact)) return reply(400, { error: 'invalid_contact' });
      const suspicious = !!data.extra_note?.trim();
      const info = await transport.sendMail({
        from, to,
        subject: `${suspicious ? '[Проверить] ' : ''}Заявка с сайта`,
        text: `Имя: ${data.name.trim()}\nКонтакт: ${contact}\nФорма: ${data.formId}\nСтраница: ${data.page}\nСогласие: да\n\n${data.message.trim()}`,
        disableFileAccess: true, disableUrlAccess: true
      });
      if (!info.accepted?.length || info.rejected?.length) throw new Error('Recipient not accepted');
      return reply(200, { status: 'smtp_accepted' });
    } catch {
      // No request bodies, addresses or secrets in logs or error responses.
      console.error('lead_send_failed');
      if (!res.headersSent && !res.destroyed) return reply(502, { error: 'send_failed' });
    }
  };
}

export function startFromEnv(env = process.env) {
  const enabled = env.MAIL_ENABLED === 'true';
  const port = Number(env.PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (enabled) {
    for (const key of ['ALLOWED_ORIGIN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_TO']) {
      if (!env[key] || /[\r\n]/.test(env[key])) throw new Error(`Missing/invalid ${key}`);
    }
    const url = new URL(env.ALLOWED_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN must be exact https origin');
    if (![465, 587].includes(Number(env.SMTP_PORT))) throw new Error('Use SMTP port 465 or 587; adapt explicitly for another provider');
    if ((env.SMTP_SECURE === 'true') !== (Number(env.SMTP_PORT) === 465)) throw new Error('SMTP_SECURE must match SMTP port');
    for (const key of ['MAIL_FROM', 'MAIL_TO']) if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(env[key])) throw new Error(`${key} must be one email address`);
  }
  const transport = enabled ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true
  }) : null;
  const server = http.createServer(createHandler({ origin: env.ALLOWED_ORIGIN, mailEnabled: enabled, from: env.MAIL_FROM, to: env.MAIL_TO, transport }));
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  server.listen(port, '127.0.0.1', () => console.log(`Form service listening on loopback:${port}; mailEnabled=${enabled}`));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try { startFromEnv(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
