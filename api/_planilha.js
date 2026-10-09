// Envio dos cadastros para a planilha do Google da família (Apps Script publicado como "App da Web").
// O código da planilha está em planilha/Codigo.gs.
import { readDoc, mutate, MAX_ITENS } from './_lib.js';

// Endereço do App da Web da planilha (fica vazio até a planilha ser conectada)
const PLANILHA_URL_PADRAO = '';
// Mesma chave escrita no Codigo.gs (só impede que robôs aleatórios gravem na planilha)
const CHAVE_PADRAO = 'bryan-Il-jMTQ3Mp1RsTzm4jlCWGNO';

const URL_PLANILHA = process.env.PLANILHA_URL || PLANILHA_URL_PADRAO;
const CHAVE = process.env.PLANILHA_CHAVE || CHAVE_PADRAO;

export function planilhaConectada() {
  return /^https?:\/\/\S+$/.test(URL_PLANILHA);
}

export async function enviarParaPlanilha(payload, timeoutMs = 15000) {
  const r = await fetch(URL_PLANILHA, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ chave: CHAVE, ...payload }),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Resposta inesperada da planilha (HTTP ${r.status}): ${text.slice(0, 160)}`); }
  if (!data || data.ok !== true) throw new Error('A planilha recusou: ' + ((data && data.erro) || 'sem detalhe'));
  return data;
}

// Converte um cadastro guardado na fila (ou no formato antigo da lista) no pedido para a planilha
function pedido(item) {
  return {
    acao: 'cadastrar',
    id: item.id,
    nome: item.nome,
    documento: item.documento,
    telefone: item.telefone || '',
    acompanhantes: item.acompanhantes || [],
    quando: item.quando || item.criadoEm || item.atualizadoEm,
    status: item.status === 'aprovado' || item.status === 'recusado' ? item.status : undefined,
  };
}
const marca = (item) => String(item.quando || item.atualizadoEm || '');

// Se a planilha estava fora do ar, os cadastros esperam numa fila privada. Isto tenta entregá-los.
export async function esvaziarFila(limite = 25) {
  const { itens } = await readDoc();
  if (!itens.length) return { enviados: 0, restantes: 0 };
  const enviados = [];
  for (const item of itens.slice(0, limite)) {
    try { await enviarParaPlanilha(pedido(item)); enviados.push({ id: item.id, marca: marca(item) }); }
    catch (err) { console.error('fila -> planilha:', err.message); break; }
  }
  if (enviados.length) {
    await mutate((lista) => {
      for (const e of enviados) {
        const i = lista.findIndex((x) => x.id === e.id && marca(x) === e.marca);
        if (i >= 0) lista.splice(i, 1);
      }
      return {};
    });
  }
  return { enviados: enviados.length, restantes: itens.length - enviados.length };
}

// Guarda o cadastro na fila (usado quando a planilha não respondeu)
export async function guardarNaFila(registro) {
  return mutate((itens) => {
    const i = itens.findIndex((x) => x.id === registro.id);
    if (i >= 0 && (itens[i].status === 'aprovado' || itens[i].status === 'recusado')) return { semMudanca: true, repetido: true };
    if (i < 0 && itens.length >= MAX_ITENS) return { semMudanca: true, cheia: true };
    if (i >= 0) itens[i] = registro; else itens.push(registro);
    return { atualizado: i >= 0 };
  });
}
