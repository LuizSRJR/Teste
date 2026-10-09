// POST /api/admin  ->  área da família (exige a senha no cabeçalho x-admin-key)
// Ações: verificar, listar, status, adicionar, remover, apagarTudo
import { json, readBody, isAdmin, readDoc, mutate, removeAll, clean, normDoc, idFor, randomId, isId, parseCompanions, sortItems } from './_lib.js';

const STATUS = ['pendente', 'aprovado', 'recusado'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'Método não permitido.' });
  if (!isAdmin(req)) return json(res, 401, { ok: false, erro: 'Senha incorreta.' });

  const body = await readBody(req);
  const agora = new Date().toISOString();
  try {
    switch (body.acao) {
      case 'verificar':
        return json(res, 200, { ok: true });

      case 'listar': {
        const { itens } = await readDoc();
        return json(res, 200, { ok: true, itens: sortItems(itens) });
      }

      case 'status': {
        if (!isId(body.id) || !STATUS.includes(body.status)) return json(res, 400, { ok: false, erro: 'Pedido inválido.' });
        const out = await mutate((itens) => {
          const item = itens.find((x) => x.id === body.id);
          if (!item) return { semMudanca: true, status: 404, resposta: { ok: false, erro: 'Convidado não encontrado. Atualize a lista.' } };
          item.status = body.status;
          item.alteradoPeloConvidado = false;
          item.atualizadoEm = agora;
          return { status: 200, resposta: { ok: true, item } };
        });
        return json(res, out.status, out.resposta);
      }

      case 'adicionar': {
        const nome = clean(body.nome, 80);
        const documento = clean(body.documento, 24);
        const doc = normDoc(documento);
        if (nome.length < 3) return json(res, 400, { ok: false, erro: 'Escreva o nome do convidado.' });
        const id = doc.length >= 5 ? idFor(doc) : randomId();
        const telefone = clean(body.telefone, 24);
        const acompanhantes = parseCompanions(body.acompanhantes);
        const out = await mutate((itens) => {
          const i = itens.findIndex((x) => x.id === id);
          const anterior = i >= 0 ? itens[i] : null;
          const item = {
            ...(anterior || {}),
            id, nome, documento, telefone, acompanhantes,
            status: 'aprovado',
            origem: anterior ? anterior.origem : 'familia',
            criadoEm: anterior ? anterior.criadoEm : agora,
            atualizadoEm: agora,
            alteradoPeloConvidado: false,
          };
          if (i >= 0) itens[i] = item; else itens.push(item);
          return { status: 200, resposta: { ok: true, item } };
        });
        return json(res, out.status, out.resposta);
      }

      case 'remover': {
        if (!isId(body.id)) return json(res, 400, { ok: false, erro: 'Pedido inválido.' });
        await mutate((itens) => {
          const i = itens.findIndex((x) => x.id === body.id);
          if (i < 0) return { semMudanca: true };
          itens.splice(i, 1);
          return {};
        });
        return json(res, 200, { ok: true });
      }

      case 'apagarTudo': {
        if (body.confirmacao !== 'APAGAR') return json(res, 400, { ok: false, erro: 'Digite APAGAR para confirmar.' });
        const removidos = await removeAll();
        return json(res, 200, { ok: true, removidos });
      }

      default:
        return json(res, 400, { ok: false, erro: 'Ação desconhecida.' });
    }
  } catch (err) {
    console.error(err);
    return json(res, 500, { ok: false, erro: 'Erro no servidor. Tente de novo em instantes.' });
  }
}
