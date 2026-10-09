// POST /api/confirmar  ->  convidado pede para entrar na lista (fica "pendente" até a família aprovar)
// GET  /api/confirmar  ->  verificação simples de que o serviço está no ar (não lê nem grava dados)
import { json, readBody, clean, normDoc, idFor, parseCompanions, mutate, diagnose, isDiag, MAX_ITENS } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const chave = url.searchParams.get('diagnostico');
    if (chave !== null) {
      if (!isDiag(chave)) return json(res, 404, { ok: false });
      try { return json(res, 200, { ok: true, etapas: await diagnose() }); }
      catch (err) { console.error(err); return json(res, 500, { ok: false, erro: String(err && (err.name + ': ' + err.message)).slice(0, 300) }); }
    }
    return json(res, 200, { ok: true, online: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
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

  const id = idFor(doc);
  const agora = new Date().toISOString();
  try {
    const out = await mutate((itens) => {
      const i = itens.findIndex((x) => x.id === id);
      const anterior = i >= 0 ? itens[i] : null;
      if (anterior && anterior.status !== 'pendente') {
        // Já analisado pela família: não deixa sobrescrever (evita alguém trocar o nome de um convidado aprovado)
        return { semMudanca: true, status: 200, resposta: { ok: true, repetido: true } };
      }
      if (!anterior && itens.length >= MAX_ITENS) {
        return { semMudanca: true, status: 409, resposta: { ok: false, erro: 'A lista já está completa. Fale direto com a família.' } };
      }
      const registro = anterior
        ? { ...anterior, nome, documento, telefone: telefone || anterior.telefone || '', acompanhantes, atualizadoEm: agora, alteradoPeloConvidado: true }
        : { id, nome, documento, telefone, acompanhantes, status: 'pendente', origem: 'site', criadoEm: agora, atualizadoEm: agora };
      if (i >= 0) itens[i] = registro; else itens.push(registro);
      return { status: 200, resposta: { ok: true, atualizado: Boolean(anterior) } };
    });
    return json(res, out.status, out.resposta);
  } catch (err) {
    console.error(err);
    return json(res, 500, { ok: false, erro: 'Não conseguimos salvar agora. Tente de novo em alguns minutos.' });
  }
}
