// POST /api/confirmar  ->  convidado pede para entrar na lista (fica "pendente" até a família aprovar)
// GET  /api/confirmar  ->  verificação simples de que o serviço está no ar (não devolve dados)
import { json, readBody, clean, normDoc, idFor, load, save, parseCompanions, ping } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try { await ping(); return json(res, 200, { ok: true, online: true }); }
    catch (err) { console.error(err); return json(res, 503, { ok: false, online: false }); }
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'Método não permitido.' });

  const body = await readBody(req);
  // Campo escondido que só robôs preenchem
  if (body.site) return json(res, 200, { ok: true, status: 'pendente' });

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
    const anterior = await load(id);
    if (anterior && anterior.status !== 'pendente') {
      // Já analisado pela família: não deixa sobrescrever (evita alguém trocar o nome de um convidado aprovado)
      return json(res, 200, { ok: true, repetido: true });
    }
    const registro = anterior
      ? { ...anterior, nome, documento, telefone: telefone || anterior.telefone || '', acompanhantes, atualizadoEm: agora, alteradoPeloConvidado: true }
      : { id, nome, documento, telefone, acompanhantes, status: 'pendente', origem: 'site', criadoEm: agora, atualizadoEm: agora };
    await save(registro);
    return json(res, 200, { ok: true, atualizado: Boolean(anterior) });
  } catch (err) {
    console.error(err);
    return json(res, 500, { ok: false, erro: 'Não conseguimos salvar agora. Tente de novo em alguns minutos.' });
  }
}
