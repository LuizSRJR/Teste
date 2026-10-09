// Lista de convidados do Chá do Bryan: funções compartilhadas pelas rotas /api.
// Os dados ficam num Blob PRIVADO da Vercel (só a API, com o token do projeto, consegue ler).
import crypto from 'node:crypto';
import { put, get, list, del } from '@vercel/blob';

export const PREFIX = 'convidados/';

// Senha da família: só o hash fica no código (PBKDF2, 120 mil rodadas, com sal).
const ADMIN_SALT = 'b8a3b17bec8a4e53302c876b0cf8a53f';
const ADMIN_HASH = '5299edcab8a5a613ddf4df2b6402fe2d6f17aa99c47e673394563cfb1b222ee3';

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(data));
}

export function isAdmin(req) {
  const key = req.headers['x-admin-key'];
  if (typeof key !== 'string' || key.length < 6 || key.length > 120) return false;
  const got = crypto.pbkdf2Sync(key.trim(), ADMIN_SALT, 120000, 32, 'sha256');
  const expected = Buffer.from(ADMIN_HASH, 'hex');
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

export function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Documento normalizado (só letras e números) para comparar RG/CPF digitados de jeitos diferentes.
export function normDoc(value) {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 20);
}

export function idFor(doc) {
  return crypto.createHash('sha256').update('cha-do-bryan:' + doc).digest('hex').slice(0, 32);
}

export function randomId() {
  return crypto.randomBytes(16).toString('hex');
}

export const isId = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);

export function parseCompanions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 8)
    .map((a) => ({ nome: clean(a && a.nome, 80), documento: clean(a && a.documento, 24) }))
    .filter((a) => a.nome.length >= 2);
}

export async function readBody(req) {
  // Na Vercel o corpo JSON já vem pronto em req.body (e o acesso pode falhar se o JSON vier quebrado)
  let pre;
  try { pre = req.body; } catch { return {}; }
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre;
  if (typeof pre === 'string' || Buffer.isBuffer(pre)) {
    try { return JSON.parse(String(pre) || '{}'); } catch { return {}; }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) break;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

async function readJson(urlOrPathname) {
  try {
    // useCache: false garante a versão mais nova (logo depois de aprovar/recusar alguém)
    const result = await get(urlOrPathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch (err) {
    if (err && /not.?found/i.test(String(err.name || err.message))) return null;
    throw err;
  }
}

export async function load(id) {
  return readJson(PREFIX + id + '.json');
}

export async function save(record) {
  await put(PREFIX + record.id + '.json', JSON.stringify(record), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function remove(id) {
  await del(PREFIX + id + '.json');
}

export async function ping() {
  await list({ prefix: PREFIX, limit: 1 });
}

export async function all() {
  const urls = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) urls.push(b.url || b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const out = [];
  for (let i = 0; i < urls.length; i += 16) {
    const batch = await Promise.all(urls.slice(i, i + 16).map(readJson));
    for (const item of batch) if (item && isId(item.id)) out.push(item);
  }
  return out;
}

// Apaga todos os arquivos da lista (usado no "Depois do chá")
export async function removeAll() {
  const urls = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) urls.push(b.url || b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < urls.length; i += 100) await del(urls.slice(i, i + 100));
  return urls.length;
}

const ORDER = { pendente: 0, aprovado: 1, recusado: 2 };
export function sortItems(items) {
  return items.sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)
    || String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')));
}
