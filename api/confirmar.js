// POST /api/confirmar  ->  convidado pede para entrar na lista; o pedido vai para a planilha da família
// GET  /api/confirmar  ->  verificação simples de que o serviço está no ar (não lê nem grava dados)
import { json, readBody, clean, normDoc, idFor, parseCompanions, diagnose, isDiag, readDoc, migrarLegado } from './_lib.js';
import { planilhaConectada, enviarParaPlanilha, esvaziarFila, guardarNaFila } from './_planilha.js';

// De tempos em tempos (por instância), aproveita um envio bem-sucedido para entregar a fila
let ultimaVerificacaoDaFila = 0;
async function entregarFilaSePreciso() {
  if (Date.now() - ultimaVerificacaoDaFila < 10 * 60 * 1000) return;
  ultimaVerificacaoDaFila = Date.now();
  try { await esvaziarFila(); } catch (err) { console.error('fila:', err.message); }
}

async function diagnostico() {
  const out = { ok: true, planilhaConectada: planilhaConectada() };
  try { out.armazenamento = await diagnose(); } catch (err) { out.ok = false; out.armazenamentoErro = String(err && (err.name + ': ' + err.message)).slice(0, 300); }
  try { out.legado = await migrarLegado(); } catch (err) { out.legadoErro = String(err && err.message).slice(0, 300); }
  if (out.planilhaConectada) {
    try { out.planilha = await enviarParaPlanilha({ acao: 'ping' }); } catch (err) { out.ok = false; out.planilhaErro = String(err.message).slice(0, 300); }
    if (out.planilha) {
      try { out.fila = await esvaziarFila(); } catch (err) { out.filaErro = String(err.message).slice(0, 300); }
    }
  }
  if (!out.fila) {
    try { out.fila = { aguardando: (await readDoc()).itens.length }; } catch (err) { out.filaErro = String(err.message).slice(0, 300); }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const chave = url.searchParams.get('diagnostico');
    if (chave !== null) {
      if (!isDiag(chave)) return json(res, 404, { ok: false });
      return json(res, 200, await diagnostico());
    }
    return json(res, 200, { ok: true, online: true, planilha: planilhaConectada() });
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'Método não permitido.' });

  const body = await readBody(req);
  // Campo escondido que só robôs preenchem
  if (body.site) return json(res, 200, { ok: true });

  const nome = clean(body.nome, 80);
  const documento = clean(body.documento, 24);
  const doc = normDoc(documento);
  const telefone = clean(body.telefone, 24);
  const acompanhantes = parseCompanions(body.acompanhantes);

  if (nome.length < 5 || !/\S+\s+\S+/.test(nome)) {
    return json(res, 400, { ok: false, erro: 'Escreva seu nome completo, com sobrenome.' });
  }
  if (doc.length < 5) {
    return json(res, 400, { ok: false, erro: 'Confira o número do documento (RG ou CPF).' });
  }
  if (body.consentimento !== true) {
    return json(res, 400, { ok: false, erro: 'Marque a autorização para usarmos seus dados na lista.' });
  }

  const registro = { id: idFor(doc), nome, documento, telefone, acompanhantes, quando: new Date().toISOString() };

  if (planilhaConectada()) {
    try {
      const r = await enviarParaPlanilha({ acao: 'cadastrar', ...registro });
      await entregarFilaSePreciso();
      return json(res, 200, { ok: true, repetido: r.situacao === 'repetido', atualizado: r.situacao === 'atualizado' });
    } catch (err) {
      console.error('planilha:', err.message);
    }
  }

  // Planilha fora do ar (ou ainda não conectada): guarda na fila para entregar depois
  try {
    const out = await guardarNaFila(registro);
    ultimaVerificacaoDaFila = 0;
    if (out.cheia) return json(res, 409, { ok: false, erro: 'A lista já está completa. Fale direto com a família.' });
    return json(res, 200, { ok: true, repetido: Boolean(out.repetido), atualizado: Boolean(out.atualizado) });
  } catch (err) {
    console.error(err);
    return json(res, 500, { ok: false, erro: 'Não conseguimos salvar agora. Tente de novo em alguns minutos.' });
  }
}
