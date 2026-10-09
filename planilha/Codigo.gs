/**
 * Lista de convidados do Chá do Bryan
 * Recebe os cadastros do site e organiza nesta planilha, com as caixinhas
 * "Presença autorizada" e "Presença não autorizada" para a família marcar.
 *
 * Como instalar: cole este código em Extensões > Apps Script, salve,
 * rode a função configurarPlanilha uma vez e publique como "App da Web".
 *
 * @OnlyCurrentDoc
 */

// Senha combinada com o site. Não mude (se mudar, o site para de conseguir gravar).
const CHAVE = 'bryan-Il-jMTQ3Mp1RsTzm4jlCWGNO';

const ABA = 'Convidados';
const ABA_ENTRADA = 'Lista da entrada';
const COL = { DATA: 1, NOME: 2, DOC: 3, VEM: 4, ZAP: 5, SIM: 6, NAO: 7, SITUACAO: 8, CODIGO: 9 };
const TITULOS = ['Data do cadastro', 'Nome completo', 'Documento', 'Vem como', 'WhatsApp',
  'Presença autorizada', 'Presença não autorizada', 'Situação', 'Código do cadastro'];
const N_COL = TITULOS.length;
const LOTE = 200;   // quantas linhas de caixinhas são preparadas de cada vez
const FOLGA = 30;   // prepara mais linhas quando sobrarem menos que isso

const COR = {
  titulo: '#1F3D66', fundoTitulo: '#CADCF6', borda: '#97BBE3',
  sim: '#E2F2E6', simTexto: '#1D5A33', nao: '#F7E2DF', naoTexto: '#8A3B34', aguardando: '#FFF7E6'
};

/* ===================== Site -> planilha ===================== */

function doGet() {
  return responder({ ok: true, servico: 'Lista de convidados do Chá do Bryan' });
}

function doPost(e) {
  let dados;
  try {
    dados = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return responder({ ok: false, erro: 'formato' });
  }
  if (!dados || dados.chave !== CHAVE) return responder({ ok: false, erro: 'chave' });
  if (dados.acao === 'ping') return responder({ ok: true, planilha: true });
  if (dados.acao !== 'cadastrar') return responder({ ok: false, erro: 'acao' });

  const trava = LockService.getScriptLock();
  if (!trava.tryLock(25000)) return responder({ ok: false, erro: 'ocupado' });
  try {
    return responder(cadastrar(dados));
  } catch (err) {
    return responder({ ok: false, erro: String((err && err.message) || err).slice(0, 200) });
  } finally {
    trava.releaseLock();
  }
}

function cadastrar(dados) {
  const id = texto(dados.id, 40);
  const nome = texto(dados.nome, 80);
  const documento = texto(dados.documento, 24);
  if (!/^[a-f0-9]{32}$/.test(id) || nome.length < 3) return { ok: false, erro: 'dados' };
  const telefone = texto(dados.telefone, 24);
  const acompanhantes = (Array.isArray(dados.acompanhantes) ? dados.acompanhantes : []).slice(0, 8)
    .map(function (a) { return { nome: texto(a && a.nome, 80), documento: texto(a && a.documento, 24) }; })
    .filter(function (a) { return a.nome.length >= 2; });
  const decisao = dados.status === 'aprovado' ? COL.SIM : dados.status === 'recusado' ? COL.NAO : 0;

  const aba = abaConvidados();
  const anteriores = linhasDoCadastro(aba, id);
  if (anteriores.some(function (l) { return l.sim || l.nao; })) {
    // A família já decidiu sobre este cadastro: não deixa ninguém mudar pelo site
    return { ok: true, situacao: 'repetido' };
  }
  // Pedido ainda sem decisão enviado de novo: troca pela versão nova
  for (let k = anteriores.length - 1; k >= 0; k--) aba.deleteRow(anteriores[k].linha);

  let quando = dados.quando ? new Date(dados.quando) : new Date();
  if (isNaN(quando.getTime())) quando = new Date();
  const pessoas = 1 + acompanhantes.length;
  const linhas = [[quando, seguro(nome), seguro(documento || 'não informado'),
    pessoas > 1 ? 'Titular · grupo de ' + pessoas + ' pessoas' : 'Titular']];
  acompanhantes.forEach(function (a) {
    linhas.push([quando, seguro(a.nome), seguro(a.documento || 'sem documento'), 'Acompanha ' + nome]);
  });

  const inicio = proximaLinhaLivre(aba);
  prepararLinhas(aba, inicio, linhas.length);
  aba.getRange(inicio, COL.DOC, linhas.length, 1).setNumberFormat('@');
  aba.getRange(inicio, COL.DATA, linhas.length, 4).setValues(linhas);
  aba.getRange(inicio, COL.CODIGO, linhas.length, 1).setValues(linhas.map(function () { return [id]; }));
  aba.getRange(inicio, COL.SIM, linhas.length, 2).setValues(linhas.map(function () { return [false, false]; }));
  if (telefone) aba.getRange(inicio, COL.ZAP).setRichTextValue(linkWhats(telefone));
  if (decisao) aba.getRange(inicio, decisao, linhas.length, 1).setValues(linhas.map(function () { return [true]; }));

  return { ok: true, situacao: anteriores.length ? 'atualizado' : 'novo' };
}

/* ===================== Caixinhas: uma desmarca a outra ===================== */

function onEdit(e) {
  if (!e || !e.range) return;
  const r = e.range;
  const aba = r.getSheet();
  if (aba.getName() !== ABA || r.getRow() < 2) return;
  const col = r.getColumn();
  if (col !== r.getLastColumn() || (col !== COL.SIM && col !== COL.NAO)) return;
  const outra = col === COL.SIM ? COL.NAO : COL.SIM;
  const marcados = r.getValues();
  const alvo = aba.getRange(r.getRow(), outra, r.getNumRows(), 1);
  const atuais = alvo.getValues();
  let mudou = false;
  for (let i = 0; i < marcados.length; i++) {
    if (marcados[i][0] === true && atuais[i][0] === true) { atuais[i][0] = false; mudou = true; }
  }
  if (mudou) alvo.setValues(atuais);
}

/* ===================== Menu e configuração ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Chá do Bryan')
    .addItem('Como funciona', 'mostrarAjuda')
    .addItem('Arrumar a planilha de novo', 'configurarPlanilha')
    .addToUi();
}

function mostrarAjuda() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('Lista de convidados do Chá do Bryan',
    'Cada pessoa que se cadastra no site aparece sozinha na aba "Convidados".\n\n' +
    '• Marque "Presença autorizada" para quem PODE ir.\n' +
    '• Marque "Presença não autorizada" para quem NÃO pode ir.\n' +
    '• Linhas amarelas ainda estão aguardando a sua decisão.\n\n' +
    'Para adicionar alguém que não usou o site, é só escrever o nome e o documento na próxima linha vazia.\n\n' +
    'A aba "Lista da entrada" mostra só quem foi autorizado, em ordem alfabética, pronta para imprimir no dia.',
    ui.ButtonSet.OK);
}

function configurarPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = abaConvidados();
  formatarConvidados(aba);
  prepararLinhas(aba, proximaLinhaLivre(aba), 1);
  formatarEntrada(ss.getSheetByName(ABA_ENTRADA) || ss.insertSheet(ABA_ENTRADA));
  ss.setActiveSheet(aba);
  ss.toast('Planilha pronta! Agora é só publicar como App da Web.', 'Chá do Bryan', 10);
}

function abaConvidados() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let aba = ss.getSheetByName(ABA);
  if (aba) {
    if (aba.getRange(1, COL.NOME).getValue() !== TITULOS[COL.NOME - 1]) formatarConvidados(aba);
    return aba;
  }
  const abas = ss.getSheets();
  if (abas.length === 1 && abas[0].getLastRow() === 0 && abas[0].getName() !== ABA_ENTRADA) aba = abas[0].setName(ABA);
  else aba = ss.insertSheet(ABA, 0);
  formatarConvidados(aba);
  return aba;
}

function formatarConvidados(aba) {
  aba.getRange(1, 1, 1, N_COL).setValues([TITULOS])
    .setFontWeight('bold').setFontColor(COR.titulo).setBackground(COR.fundoTitulo)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  aba.setFrozenRows(1);
  aba.setRowHeight(1, 44);
  [150, 250, 160, 250, 150, 150, 170, 140, 120].forEach(function (w, i) { aba.setColumnWidth(i + 1, w); });
  aba.getRange('A2:A').setNumberFormat('dd/mm/yyyy hh:mm');
  aba.getRange('C2:C').setNumberFormat('@');
  aba.getRange('F2:H').setHorizontalAlignment('center');
  aba.getRange('A2:I').setVerticalAlignment('middle');
  aba.hideColumns(COL.CODIGO);
  aba.getRange(1, COL.SIM).setNote('Marque aqui quem PODE ir ao chá.');
  aba.getRange(1, COL.NAO).setNote('Marque aqui quem NÃO pode ir. Marcar uma caixinha desmarca a outra.');
  aba.getRange(1, COL.SITUACAO).setNote('Atualiza sozinha: Aguardando, Autorizada ou Não autorizada.');
  const area = aba.getRange('A2:H');
  aba.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$F2')
      .setBackground(COR.sim).setFontColor(COR.simTexto).setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2')
      .setBackground(COR.nao).setFontColor(COR.naoTexto).setStrikethrough(true).setRanges([aba.getRange('B2:D')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2')
      .setBackground(COR.nao).setFontColor(COR.naoTexto).setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$B2<>""')
      .setBackground(COR.aguardando).setRanges([area]).build()
  ]);
}

function formatarEntrada(aba) {
  const s = separador();
  aba.getRange('A1').setValue('Chá do Bryan · Lista da entrada').setFontSize(16).setFontWeight('bold').setFontColor(COR.titulo);
  aba.getRange('A2').setValue('Domingo, 29/11/2026, às 14h · Av. Dom Pedro I, 886 · Enseada, Guarujá – SP').setFontColor(COR.titulo);
  aba.getRange('A3').setFormula(
    '="Autorizadas: "&SUMPRODUCT((Convidados!B2:B<>"")*Convidados!F2:F)' +
    '&"     Aguardando: "&SUMPRODUCT((Convidados!B2:B<>"")*(1-Convidados!F2:F)*(1-Convidados!G2:G))' +
    '&"     Não autorizadas: "&SUMPRODUCT((Convidados!B2:B<>"")*Convidados!G2:G*(1-Convidados!F2:F))'
  ).setFontWeight('bold').setFontColor(COR.titulo);
  aba.getRange('A5:E5').setValues([['Nº', 'Nome completo', 'Documento', 'Observação', 'Entrou']])
    .setFontWeight('bold').setFontColor(COR.titulo).setBackground(COR.fundoTitulo).setHorizontalAlignment('center');
  aba.getRange('A6').setFormula(('=ARRAYFORMULA(IF(B6:B=""¦""¦ROW(B6:B)-5))').split('¦').join(s));
  aba.getRange('B6').setFormula(('=IFERROR(SORT(FILTER(Convidados!B2:D¦Convidados!F2:F¦Convidados!B2:B<>"")¦1¦TRUE())¦"")').split('¦').join(s));
  aba.setFrozenRows(5);
  [52, 280, 170, 260, 90].forEach(function (w, i) { aba.setColumnWidth(i + 1, w); });
  aba.getRange('A6:A').setHorizontalAlignment('center');
  aba.getRange('A5:E305').setBorder(true, true, true, true, true, true, COR.borda, SpreadsheetApp.BorderStyle.SOLID);
}

/* ===================== Ajudantes ===================== */

// Prepara caixinhas e a coluna "Situação" a partir da linha `inicio` (só em linhas vazias)
function prepararLinhas(aba, inicio, quantidade) {
  const precisa = inicio + quantidade + FOLGA;
  if (precisa <= aba.getMaxRows() && aba.getRange(precisa, COL.SITUACAO).getFormula()) return;
  const ate = Math.max(precisa, inicio + LOTE);
  if (aba.getMaxRows() < ate) aba.insertRowsAfter(aba.getMaxRows(), ate - aba.getMaxRows());
  const n = ate - inicio + 1;
  const s = separador();
  aba.getRange(inicio, COL.SIM, n, 2).insertCheckboxes();
  aba.getRange(inicio, COL.DOC, n, 1).setNumberFormat('@');
  const formulas = [];
  for (let i = 0; i < n; i++) {
    const r = inicio + i;
    formulas.push([('=IF(B' + r + '=""¦""¦IF(F' + r + '¦"Autorizada"¦IF(G' + r + '¦"Não autorizada"¦"Aguardando")))').split('¦').join(s)]);
  }
  aba.getRange(inicio, COL.SITUACAO, n, 1).setFormulas(formulas);
}

function proximaLinhaLivre(aba) {
  const ultima = aba.getMaxRows();
  if (ultima < 2) return 2;
  const nomes = aba.getRange(2, COL.NOME, ultima - 1, 1).getValues();
  for (let i = nomes.length - 1; i >= 0; i--) {
    if (String(nomes[i][0]).trim() !== '') return i + 3;
  }
  return 2;
}

function linhasDoCadastro(aba, id) {
  const ultima = proximaLinhaLivre(aba) - 1;
  if (ultima < 2) return [];
  const valores = aba.getRange(2, 1, ultima - 1, N_COL).getValues();
  const achadas = [];
  valores.forEach(function (linha, i) {
    if (linha[COL.CODIGO - 1] === id) achadas.push({ linha: i + 2, sim: linha[COL.SIM - 1] === true, nao: linha[COL.NAO - 1] === true });
  });
  return achadas;
}

// Separador de argumentos das fórmulas: ";" em planilhas em português, "," em inglês
function separador() {
  const props = PropertiesService.getDocumentProperties();
  const salvo = props.getProperty('separador');
  if (salvo) return salvo;
  let s = ',';
  try {
    const teste = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].getRange(1, 26);
    const antes = teste.getFormula() || teste.getValue();
    teste.setFormula('=SUM(1;2)');
    SpreadsheetApp.flush();
    if (teste.getValue() === 3) s = ';';
    if (typeof antes === 'string' && antes.charAt(0) === '=') teste.setFormula(antes); else teste.setValue(antes);
  } catch (err) {
    const local = String(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetLocale() || '');
    s = /^(en|ja|zh|ko|th|he|hi)/.test(local) ? ',' : ';';
  }
  props.setProperty('separador', s);
  return s;
}

function linkWhats(telefone) {
  let d = String(telefone).replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  const rich = SpreadsheetApp.newRichTextValue().setText(telefone);
  if (d.length >= 12 && d.length <= 13) rich.setLinkUrl('https://wa.me/' + d);
  return rich.build();
}

function texto(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Evita que um nome comece com "=" e vire fórmula
function seguro(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
