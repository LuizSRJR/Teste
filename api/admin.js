// POST /api/admin  ->  área da família (exige a senha no cabeçalho x-admin-key)
// Ações: verificar, listar, status, adicionar, remover, apagarTudo
import { json, readBody, isAdmin, all, load, save, remove, removeAll, clean, normDoc, idFor, randomId, isId, parseCompanions, sortItems } from './_lib.js';

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

      case 'listar':
        return json(res, 200, { ok: true, itens: sortItems(await all()) });

      case 'status': {
        if (!isId(body.id) || !STATUS.includes(body.status)) return json(res, 400, { ok: false, erro: 'Pedido inválido.' });
        const item = await load(body.id);
        if (!item) return json(res, 404, { ok: false, erro: 'Convidado não encontrado. Atualize a lista.' });
        item.status = body.status;
        item.alteradoPeloConvidado = false;
        item.atualizadoEm = agora;
        await save(item);
        return json(res, 200, { ok: true, item });
      }

      case 'adicionar': {
        const nome = clean(body.nome, 80);
        const documento = clean(body.documento, 24);
        const doc = normDoc(documento);
        if (nome.length < 3) return json(res, 400, { ok: false, erro: 'Escreva o nome do convidado.' });
        const id = doc.length >= 5 ? idFor(doc) : randomId();
        const anterior = await load(id);
        const item = {
          ...(anterior || {}),
          id, nome, documento,
          telefone: clean(body.telefone, 24),
          acompanhantes: parseCompanions(body.acompanhantes),
          status: 'aprovado',
          origem: anterior ? anterior.origem : 'familia',
          criadoEm: anterior ? anterior.criadoEm : agora,
          atualizadoEm: agora,
          alteradoPeloConvidado: false,
        };
        await save(item);
        return json(res, 200, { ok: true, item });
      }

      case 'remover':
        if (!isId(body.id)) return json(res, 400, { ok: false, erro: 'Pedido inválido.' });
        await remove(body.id);
        return json(res, 200, { ok: true });

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
