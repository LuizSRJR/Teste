// Lista de convidados do Chá do Bryan: funções compartilhadas pelas rotas /api.
// Os cadastros vão para a planilha do Google da família (veja _planilha.js). Se a planilha
// não responder, eles esperam numa fila: um único arquivo JSON num Blob PRIVADO da Vercel
// (só a API, com o token do projeto, consegue ler). Cada gravação confere a versão (ETag)
// para dois envios ao mesmo tempo não apagarem um ao outro.
import crypto from 'node:crypto';
import * as blob from '@vercel/blob';

export const DOC_PATH = 'lista/convidados.json'; // fila de cadastros esperando a planilha
const LEGACY_PREFIX = 'convidados/'; // formato antigo (um arquivo por convidado)
export const MAX_ITENS = 600;

// Chave do autoteste técnico (GET /api/confirmar?diagnostico=...): também só o hash.
const DIAG_HASH = 'a29a8419db065c6dcd21bdd152eea7d10ed5cf26edde0e44ef66b5e0df83a487';

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(data));
}

function sameHash(gotBuf, expectedHex) {
  const expected = Buffer.from(expectedHex, 'hex');
  return gotBuf.length === expected.length && crypto.timingSafeEqual(gotBuf, expected);
}

export function isDiag(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 120) return false;
  return sameHash(crypto.createHash('sha256').update(value).digest(), DIAG_HASH);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lê um arquivo privado. useCache: false garante a versão mais nova.
async function readText(urlOrPathname) {
  const result = await blob.get(urlOrPathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return { text: await new Response(result.stream).text(), etag: (result.blob && result.blob.etag) || null };
}

// Pedidos gravados no formato antigo (um arquivo por convidado), se existirem
async function legacyItems() {
  const page = await blob.list({ prefix: LEGACY_PREFIX, limit: 1000 });
  const urls = page.blobs.map((b) => b.url || b.pathname);
  const itens = [];
  for (let i = 0; i < urls.length; i += 5) {
    const parts = await Promise.all(urls.slice(i, i + 5).map(readText));
    for (const p of parts) {
      try { const item = p && JSON.parse(p.text); if (item && isId(item.id)) itens.push(item); } catch { /* ignora */ }
    }
  }
  return { itens, urls };
}

// Lê a fila inteira: { itens, etag }
export async function readDoc() {
  const found = await readText(DOC_PATH);
  if (!found) return { itens: [], etag: null };
  const data = JSON.parse(found.text); // se o arquivo estiver corrompido, melhor falhar do que sobrescrever
  const itens = Array.isArray(data && data.itens) ? data.itens.filter((i) => i && isId(i.id)) : [];
  return { itens, etag: found.etag };
}

// Traz para a fila pedidos gravados no formato bem antigo (um arquivo por convidado), se existirem.
// Só roda no autoteste, porque listar arquivos conta no limite do plano gratuito.
export async function migrarLegado() {
  const legacy = await legacyItems();
  if (!legacy.urls.length) return 0;
  await mutate((itens) => {
    for (const item of legacy.itens) if (!itens.some((x) => x.id === item.id)) itens.push(item);
    return {};
  });
  await blob.del(legacy.urls);
  return legacy.itens.length;
}

function isConflict(err) {
  if (!err) return false;
  if (blob.BlobPreconditionFailedError && err instanceof blob.BlobPreconditionFailedError) return true;
  return /precondition|already exists/i.test(String(err.name) + ' ' + String(err.message));
}

function isRateLimited(err) {
  return Boolean(err) && /rate.?limit|too many requests/i.test(String(err.name) + ' ' + String(err.message));
}

// Altera a lista com segurança: lê, aplica fn(itens) e grava só se ninguém mudou o arquivo no meio.
// fn pode devolver { semMudanca: true, ... } para não gravar nada.
export async function mutate(fn) {
  for (let attempt = 0; ; attempt++) {
    const { itens, etag } = await readDoc();
    const out = fn(itens) || {};
    if (out.semMudanca) return out;
    const body = JSON.stringify({ versao: 1, atualizadoEm: new Date().toISOString(), itens });
    try {
      await blob.put(DOC_PATH, body, {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: Boolean(etag),
        ...(etag ? { ifMatch: etag } : {}),
        cacheControlMaxAge: 60,
      });
    } catch (err) {
      if (attempt >= 6 || !(isConflict(err) || isRateLimited(err))) throw err;
      const wait = isRateLimited(err) ? 1000 * Math.min(Number(err.retryAfter) || 1, 3) : 0;
      await sleep(wait + 80 + Math.random() * 220 * (attempt + 1));
      continue;
    }
    return out;
  }
}

// Autoteste técnico: grava, lê, testa a trava de versão e apaga um arquivo de teste.
export async function diagnose() {
  const path = 'saude/autoteste.json';
  const stamp = new Date().toISOString();
  const steps = {};
  await blob.put(path, JSON.stringify({ stamp }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  steps.put = true;
  const back = await readText(path);
  steps.get = Boolean(back && JSON.parse(back.text).stamp === stamp);
  steps.etag = Boolean(back && back.etag);
  try {
    await blob.put(path, '{}', { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: '"etag-que-nao-existe"' });
    steps.trava = false;
  } catch (err) {
    steps.trava = isConflict(err);
    if (!steps.trava) steps.travaErro = String(err && (err.name + ': ' + err.message)).slice(0, 200);
  }
  await blob.del(path);
  steps.del = true;
  steps.semArquivo = (await readText(path)) === null;
  return steps;
}

const ORDER = { pendente: 0, aprovado: 1, recusado: 2 };
export function sortItems(items) {
  return items.sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)
    || String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')));
}
