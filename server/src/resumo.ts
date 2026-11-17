import type ExcelJS from "exceljs";
import { PASSO_LINHAS_PRINT, textoDaCelula } from "./xlsx.js";
import { PRIMEIRA_LINHA_DADOS, ULTIMA_LINHA_DADOS } from "./schema.js";
import { caber, tamanhoDaImagem, type ExtensaoImagem } from "./imagem.js";
import { escreverPlanner } from "./planner.js";

/**
 * Aba "Briefing": a versão para LER e acompanhar o que está na aba "Alteração".
 *
 * A aba "Alteração" é de trabalho (a produção marca o andamento em G/H/I, cola
 * prints etc.) e segue intacta. Esta aqui é montada a partir dela toda vez que a
 * planilha é gerada ou acrescentada, então sempre mostra o conjunto completo — com
 * os prints ao lado de cada alteração — e o ANDAMENTO é ao vivo: vem por fórmula das
 * colunas G/H/I da aba "Alteração", então muda sozinho quando a produção marca lá.
 * É protegida contra edição (sem senha: serve de freio, não de segurança) e guarda
 * o histórico de rodadas.
 *
 * Visual: fundo branco, poucas colunas, só uma linha fina entre as alterações e cor
 * apenas onde ela informa (o status). Quanto menos enfeite, mais fácil de ler.
 */

export const ABA_BRIEFING = "Briefing";
const ABA_PRINTS = "Prints";
// local de propósito: xlsx.ts e este arquivo se importam, e uma constante importada ainda não existe quando este módulo é carregado
const ABA_ALTERACAO = "Alteração";
const TITULO_HISTORICO = "Histórico de rodadas";
const REF = `'${ABA_ALTERACAO}'`;

const FONTE = "Calibri";
const TINTA = "FF1F2A44";
const SUAVE = "FF7A8499";
const LINHA = "FFE3E7EF";
const LINHA_FORTE = "FF1F2A44";
const CABECALHO = "FFF3F5F9";
const FAIXA_GRUPO = "FFF3F5F9";
const AZUL = "FF2F6FED";
const VERDE = "FF1FA971";
const BRANCO = "FFFFFFFF";

/** caixa de cada print dentro do briefing, e espaço entre eles (em pixels) */
const PRINT_L = 270;
const PRINT_A = 180;
const ESPACO = 18;
const EMU = 9525;

/** colunas, na ordem em que aparecem (1-based: a posição é o índice + 1) */
const COLUNAS = [
  { chave: "num", rotulo: "#", largura: 6 },
  { chave: "andamento", rotulo: "Andamento", largura: 22 },
  { chave: "fazer", rotulo: "O que fazer", largura: 62 },
  { chave: "onde", rotulo: "Onde", largura: 38 },
  { chave: "prints", rotulo: "Prints", largura: 40 },
  { chave: "detalhes", rotulo: "Links e observações", largura: 48 },
] as const;
type Chave = (typeof COLUNAS)[number]["chave"];
const col = (chave: Chave) => COLUNAS.findIndex((c) => c.chave === chave) + 1;

type PrintLido = { buffer: Buffer; extensao: ExtensaoImagem };
type Item = {
  linhaOrigem: number;
  grupo: string;
  solicitacao: string;
  pagina: string;
  secao: string;
  links: string;
  obs: string;
  producao: string;
  impl: boolean;
  design: boolean;
};
type Rodada = { numero: number; quando: string; novas: string; total: number };

const dataHora = (d: Date) =>
  `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

/**
 * Tira os marcadores de bloco da coluna A. `grupo` vale para ESTE item (o "início de X"
 * e o "fim de X" ficam na mesma célula do primeiro e do último item do bloco);
 * `grupoDepois` é o que vale para o item seguinte.
 */
export function separarMarcadores(
  bruto: string,
  grupoAtual: string,
): { grupo: string; grupoDepois: string; texto: string } {
  let grupo = grupoAtual;
  let grupoDepois = grupoAtual;
  const linhas: string[] = [];
  for (const l of bruto.split("\n")) {
    const t = l.trim();
    if (/^\*{3,}$/.test(t)) continue;
    const inicio = /^in[ií]cio de (.+)$/i.exec(t);
    if (inicio) {
      grupo = inicio[1].trim();
      grupoDepois = grupo;
      continue;
    }
    if (/^fim de .+$/i.test(t)) {
      grupoDepois = "";
      continue;
    }
    linhas.push(l);
  }
  return { grupo, grupoDepois, texto: linhas.join("\n").trim() };
}

function lerItens(ws: ExcelJS.Worksheet): Item[] {
  const itens: Item[] = [];
  let grupo = "";
  for (let r = PRIMEIRA_LINHA_DADOS; r <= ULTIMA_LINHA_DADOS; r++) {
    const bruto = textoDaCelula(ws.getCell(r, 1).value);
    if (!bruto) continue;
    const m = separarMarcadores(bruto, grupo);
    // o aviso "📎 print na aba Prints" é do trabalho da produção; aqui o print aparece ao lado
    const obs = textoDaCelula(ws.getCell(r, 5).value)
      .split("\n")
      .filter((l) => !l.trim().startsWith("📎"))
      .join("\n")
      .trim();
    const status = textoDaCelula(ws.getCell(r, 7).value);
    itens.push({
      linhaOrigem: r,
      grupo: m.grupo,
      solicitacao: m.texto,
      pagina: textoDaCelula(ws.getCell(r, 2).value),
      secao: textoDaCelula(ws.getCell(r, 3).value).replace(/\s*\n\s*/g, " › "),
      links: textoDaCelula(ws.getCell(r, 4).value),
      obs,
      producao: ["Aguardando", "Pendente", "Finalizado"].includes(status) ? status : "Aguardando",
      impl: ws.getCell(r, 8).value === true,
      design: ws.getCell(r, 9).value === true,
    });
    grupo = m.grupoDepois;
  }
  return itens;
}

/**
 * Os prints de cada alteração, lidos da aba Prints (de rodadas anteriores também).
 * Cada bloco começa num rótulo "Linha N — ..." e os prints ficam de PASSO em PASSO
 * linhas abaixo dele; o que a produção colar à mão fora desse padrão é ignorado.
 */
function lerPrints(wb: ExcelJS.Workbook): Map<number, PrintLido[]> {
  const mapa = new Map<number, PrintLido[]>();
  const ws = wb.getWorksheet(ABA_PRINTS);
  if (!ws) return mapa;

  const rotulos: { linhaAba: number; linhaOrigem: number }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, numero) => {
    const m = /^Linha (\d+) —/.exec(textoDaCelula(row.getCell(1).value));
    if (m) rotulos.push({ linhaAba: numero, linhaOrigem: Number(m[1]) });
  });

  const achados: { linhaOrigem: number; k: number; print: PrintLido }[] = [];
  for (const img of ws.getImages()) {
    const linha0 = img.range.tl.nativeRow; // 0-based: a linha 1-based do rótulo + k*PASSO
    const dono = [...rotulos]
      .reverse()
      .find((x) => linha0 >= x.linhaAba && (linha0 - x.linhaAba) % PASSO_LINHAS_PRINT === 0);
    const media = wb.getImage(Number(img.imageId)) as { buffer?: Buffer; extension?: string } | undefined;
    if (!dono || !media?.buffer) continue;
    const extensao = media.extension as ExtensaoImagem;
    if (!["png", "jpeg", "gif"].includes(extensao)) continue;
    achados.push({
      linhaOrigem: dono.linhaOrigem,
      k: (linha0 - dono.linhaAba) / PASSO_LINHAS_PRINT,
      print: { buffer: Buffer.from(media.buffer), extensao },
    });
  }
  achados.sort((a, b) => a.k - b.k);
  for (const a of achados) mapa.set(a.linhaOrigem, [...(mapa.get(a.linhaOrigem) ?? []), a.print]);
  return mapa;
}

function lerHistorico(wb: ExcelJS.Workbook): Rodada[] {
  const antiga = wb.getWorksheet(ABA_BRIEFING);
  if (!antiga) return [];
  const rodadas: Rodada[] = [];
  let dentro = false;
  antiga.eachRow({ includeEmpty: false }, (row) => {
    const a = textoDaCelula(row.getCell(1).value);
    if (a === TITULO_HISTORICO) {
      dentro = true;
      return;
    }
    const m = dentro ? /^Rodada (\d+)$/.exec(a) : null;
    if (m) {
      rodadas.push({
        numero: Number(m[1]),
        quando: textoDaCelula(row.getCell(2).value),
        novas: textoDaCelula(row.getCell(3).value),
        total: Number(textoDaCelula(row.getCell(4).value)) || 0,
      });
    }
  });
  return rodadas;
}

/** Linhas que o texto ocupa numa coluna com essa largura (estimativa: o Excel não mede sozinho com altura fixa). */
function linhasDoTexto(texto: string, largura: number, negrito = false): number {
  if (!texto) return 0;
  const porLinha = Math.max(8, Math.floor(largura * (negrito ? 0.88 : 1.05)));
  return texto.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / porLinha)), 0);
}

export type OpcoesBriefing = {
  cliente: string;
  urlBase: string;
  /** alterações que acabaram de entrar nesta rodada */
  novas: number;
  /** já estavam na planilha antes desta rodada */
  jaExistiam: number;
  geradoEm?: Date;
};

const PLANO = `${REF}!$A$${PRIMEIRA_LINHA_DADOS}:$A$${ULTIMA_LINHA_DADOS}`;
const STATUS = `${REF}!$G$${PRIMEIRA_LINHA_DADOS}:$G$${ULTIMA_LINHA_DADOS}`;
const TOTAL = `COUNTA(${PLANO})`;
const contar = (s: string) => `SUMPRODUCT((${PLANO}<>"")*(${STATUS}="${s}"))`;

const marca = (v: boolean) => (v ? "✓" : "—");

/** (Re)monta a aba "Briefing" a partir da aba "Alteração" (e da aba "Prints") já preenchidas. */
export async function escreverBriefing(wb: ExcelJS.Workbook, opcoes: OpcoesBriefing): Promise<void> {
  const origem = wb.getWorksheet(ABA_ALTERACAO);
  if (!origem) return;
  const quando = opcoes.geradoEm ?? new Date();

  const itens = lerItens(origem);
  const prints = lerPrints(wb);
  const historico = lerHistorico(wb);
  if (historico.length === 0 && opcoes.jaExistiam > 0) {
    // planilha que já estava em execução antes desta aba existir
    historico.push({ numero: 1, quando: "—", novas: String(opcoes.jaExistiam), total: opcoes.jaExistiam });
  }
  const numero = (historico[historico.length - 1]?.numero ?? 0) + 1;
  historico.push({ numero, quando: dataHora(quando), novas: String(opcoes.novas), total: itens.length });

  const antiga = wb.getWorksheet(ABA_BRIEFING);
  if (antiga) wb.removeWorksheet(antiga.id);
  const LINHA_CABECALHO = 5;
  const ws = wb.addWorksheet(ABA_BRIEFING, {
    properties: { tabColor: { argb: AZUL } },
    views: [{ showGridLines: false, state: "frozen", ySplit: LINHA_CABECALHO }],
  });

  COLUNAS.forEach((c, i) => (ws.getColumn(i + 1).width = c.largura));
  const ate = COLUNAS.length;
  const COL_PRINTS0 = col("prints") - 1; // 0-based, para ancorar as imagens

  const fundo = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const fina = { style: "thin" as const, color: { argb: LINHA } };
  const mescla = (r: number, de: number, para: number) => ws.mergeCells(r, de, r, para);

  // contagens para o cabeçalho (valor guardado, para quem abre sem recalcular; a fórmula atualiza ao vivo)
  const fin = itens.filter((i) => i.producao === "Finalizado").length;
  const pen = itens.filter((i) => i.producao === "Pendente").length;
  const agu = itens.length - fin - pen;
  const pct = itens.length ? fin / itens.length : 0;
  const cheios = Math.round(pct * 20);

  // 1-2: nome do cliente e de onde veio, direto no branco
  mescla(1, 1, ate);
  const titulo = ws.getCell(1, 1);
  titulo.value = opcoes.cliente.trim() || "Briefing";
  titulo.font = { name: FONTE, size: 24, bold: true, color: { argb: TINTA } };
  titulo.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 40;

  mescla(2, 1, ate);
  const site = opcoes.urlBase.trim();
  const sub = ws.getCell(2, 1);
  const textoSub = `${site ? site + "   ·   " : ""}Rodada ${numero}   ·   gerado em ${dataHora(quando)}`;
  sub.value = /^https?:\/\//i.test(site) ? { text: textoSub, hyperlink: site } : textoSub;
  sub.font = { name: FONTE, size: 11, color: { argb: /^https?:\/\//i.test(site) ? AZUL : SUAVE } };
  sub.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 20;

  // 3: andamento AO VIVO (fórmulas sobre as colunas G/H/I da aba Alteração)
  const pctF = `IF(${TOTAL}=0,0,${contar("Finalizado")}/${TOTAL})`;
  mescla(3, 1, 3);
  const andamento = ws.getCell(3, 1);
  andamento.value = {
    formula: `"Andamento: "&${contar("Finalizado")}&" de "&${TOTAL}&" finalizadas ("&TEXT(${pctF},"0%")&")"`,
    result: `Andamento: ${fin} de ${itens.length} finalizadas (${Math.round(pct * 100)}%)`,
  };
  andamento.font = { name: FONTE, size: 12, bold: true, color: { argb: TINTA } };
  andamento.alignment = { vertical: "middle", indent: 1 };

  mescla(3, 4, 5);
  const barra = ws.getCell(3, 4);
  barra.value = {
    formula: `REPT("█",ROUND(${pctF}*20,0))&REPT("░",20-ROUND(${pctF}*20,0))`,
    result: "█".repeat(cheios) + "░".repeat(20 - cheios),
  };
  barra.font = { name: FONTE, size: 12, color: { argb: VERDE } };
  barra.alignment = { vertical: "middle" };

  const contagem = ws.getCell(3, 6);
  contagem.value = {
    formula: `"Aguardando "&(${TOTAL}-${contar("Finalizado")}-${contar("Pendente")})&"  ·  Pendente "&${contar("Pendente")}&"  ·  Finalizado "&${contar("Finalizado")}`,
    result: `Aguardando ${agu}  ·  Pendente ${pen}  ·  Finalizado ${fin}`,
  };
  contagem.font = { name: FONTE, size: 10, color: { argb: SUAVE } };
  contagem.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
  ws.getRow(3).height = 26;

  // 4: dica curta, sem caixa colorida
  mescla(4, 1, ate);
  const dica = ws.getCell(4, 1);
  dica.value = `Esta aba é para ler. O andamento é marcado na aba “${ABA_ALTERACAO}” e aparece aqui sozinho. Clique no número para ir à linha da alteração.`;
  dica.font = { name: FONTE, size: 10, italic: true, color: { argb: SUAVE } };
  dica.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(4).height = 22;

  // 5: cabeçalho da tabela (cinza claro, linha forte embaixo)
  COLUNAS.forEach((c, i) => {
    const cel = ws.getCell(LINHA_CABECALHO, i + 1);
    cel.value = c.rotulo;
    cel.font = { name: FONTE, bold: true, size: 10, color: { argb: SUAVE } };
    cel.fill = fundo(CABECALHO);
    const centro = c.chave === "num" || c.chave === "andamento";
    cel.alignment = { vertical: "middle", horizontal: centro ? "center" : "left", indent: centro ? 0 : 1 };
    cel.border = { bottom: { style: "medium", color: { argb: LINHA_FORTE } } };
  });
  ws.getRow(LINHA_CABECALHO).height = 24;

  // dados
  let r = LINHA_CABECALHO + 1;
  const primeiraLinhaDados = r;
  let grupoAnterior = "";
  for (const it of itens) {
    if (it.grupo && it.grupo !== grupoAnterior) {
      mescla(r, 1, ate);
      const g = ws.getCell(r, 1);
      g.value = it.grupo.toUpperCase();
      g.font = { name: FONTE, bold: true, size: 10, color: { argb: AZUL } };
      g.fill = fundo(FAIXA_GRUPO);
      g.alignment = { vertical: "middle", indent: 1 };
      ws.getRow(r).height = 24;
      r++;
    }
    grupoAnterior = it.grupo;

    const o = it.linhaOrigem;
    const rotulo = (t: string): ExcelJS.RichText => ({ text: t, font: { name: FONTE, size: 9, bold: true, color: { argb: SUAVE } } });
    const normal = (t: string, cor = TINTA): ExcelJS.RichText => ({ text: t, font: { name: FONTE, size: 11, color: { argb: cor } } });

    const onde: ExcelJS.RichText[] = [];
    if (it.pagina) onde.push(rotulo("PÁGINA\n"), normal(it.pagina + (it.secao ? "\n" : ""), /^https?:\/\//i.test(it.pagina) ? AZUL : TINTA));
    if (it.secao) onde.push(rotulo("SEÇÃO\n"), normal(it.secao));
    const detalhes: ExcelJS.RichText[] = [];
    if (it.links) detalhes.push(rotulo("LINKS\n"), normal(it.links + (it.obs ? "\n\n" : ""), AZUL));
    if (it.obs) detalhes.push(rotulo("OBSERVAÇÕES\n"), normal(it.obs));

    const valores: Record<Chave, ExcelJS.CellValue> = {
      num: { text: String(o - PRIMEIRA_LINHA_DADOS + 1), hyperlink: `#${REF}!A${o}` },
      andamento: {
        formula:
          `IF(${REF}!G${o}="","Aguardando",${REF}!G${o})&CHAR(10)&` +
          `"Implem. "&IF(${REF}!H${o}=TRUE,"✓","—")&"  ·  Design "&IF(${REF}!I${o}=TRUE,"✓","—")`,
        result: `${it.producao}\nImplem. ${marca(it.impl)}  ·  Design ${marca(it.design)}`,
      },
      fazer: it.solicitacao,
      onde: onde.length ? { richText: onde } : null,
      prints: null,
      detalhes: detalhes.length ? { richText: detalhes } : null,
    };

    for (const c of COLUNAS) {
      const cel = ws.getCell(r, col(c.chave));
      cel.value = valores[c.chave];
      const centro = c.chave === "num" || c.chave === "andamento";
      cel.alignment = {
        vertical: "middle",
        wrapText: true,
        horizontal: centro ? "center" : "left",
        indent: centro ? 0 : 1,
      };
      cel.border = { bottom: fina };
      cel.font =
        c.chave === "num"
          ? { name: FONTE, size: 12, bold: true, color: { argb: AZUL }, underline: false }
          : c.chave === "andamento"
            ? { name: FONTE, size: 10, bold: true, color: { argb: TINTA } }
            : { name: FONTE, size: c.chave === "fazer" ? 13 : 11.5, bold: c.chave === "fazer", color: { argb: TINTA } };
    }

    // prints ao lado da alteração, empilhados, na proporção original
    const imagens = (prints.get(o) ?? []).map((p) => ({ p, ext: caber(tamanhoDaImagem(p.buffer), PRINT_L, PRINT_A) }));
    const alturaImagens = imagens.reduce((s, x) => s + x.ext.height + ESPACO, ESPACO);
    const textoOnde = [it.pagina, it.secao].filter(Boolean).join("\n");
    const linhasTexto = Math.max(
      linhasDoTexto(it.solicitacao, COLUNAS[col("fazer") - 1].largura, true),
      linhasDoTexto(textoOnde, COLUNAS[col("onde") - 1].largura) + (it.pagina ? 1 : 0) + (it.secao ? 1 : 0),
      linhasDoTexto([it.links, it.obs].filter(Boolean).join("\n\n"), COLUNAS[col("detalhes") - 1].largura) +
        (it.links ? 1 : 0) +
        (it.obs ? 1 : 0),
      2,
    );
    ws.getRow(r).height = Math.max(linhasTexto * 18 + 44, imagens.length ? alturaImagens * 0.75 + 12 : 0, 76);

    let y = ESPACO;
    for (const { p, ext } of imagens) {
      const id = wb.addImage({ buffer: p.buffer as any, extension: p.extensao });
      ws.addImage(id, {
        tl: { nativeCol: COL_PRINTS0, nativeColOff: 8 * EMU, nativeRow: r - 1, nativeRowOff: y * EMU } as any,
        ext,
      });
      y += ext.height + ESPACO;
    }

    r++;
  }
  const ultimaLinhaDados = r - 1;

  // cores só nos status, e valem para o que a produção marcar depois, não só para o que existe agora
  if (ultimaLinhaDados >= primeiraLinhaDados) {
    const colA = ws.getColumn(col("andamento")).letter;
    const regra = (texto: string, bg: string, fg: string, prioridade: number) => ({
      type: "containsText" as const,
      operator: "containsText" as const,
      text: texto,
      priority: prioridade,
      style: { fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: bg } }, font: { color: { argb: fg }, bold: true } },
    });
    ws.addConditionalFormatting({
      ref: `${colA}${primeiraLinhaDados}:${colA}${ultimaLinhaDados}`,
      rules: [
        regra("Finalizado", "FFD9F2E6", "FF0E6B47", 1),
        regra("Pendente", "FFFFF1C9", "FF7A4F00", 2),
        regra("Aguardando", "FFEEF1F6", "FF5B6B8C", 3),
      ],
    });
  }

  // legenda dos status, para todo mundo entender
  r += 1;
  ws.getCell(r, 1).value = "Legenda dos status";
  ws.getCell(r, 1).font = { name: FONTE, bold: true, size: 11, color: { argb: TINTA } };
  r++;
  const legenda: [string, string, string, string][] = [
    ["Aguardando", "Ainda não foi iniciada.", "FFEEF1F6", "FF5B6B8C"],
    ["Pendente", "Depende de algo para continuar (material ou resposta do cliente, dúvida).", "FFFFF1C9", "FF7A4F00"],
    ["Finalizado", "Pronta.", "FFD9F2E6", "FF0E6B47"],
  ];
  for (const [nome, texto, bg, fg] of legenda) {
    const c = ws.getCell(r, col("andamento"));
    c.value = nome;
    c.fill = fundo(bg);
    c.font = { name: FONTE, bold: true, size: 10, color: { argb: fg } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    mescla(r, col("andamento") + 1, ate);
    const d = ws.getCell(r, col("andamento") + 1);
    d.value = texto;
    d.font = { name: FONTE, size: 10, color: { argb: SUAVE } };
    d.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(r).height = 20;
    r++;
  }
  r++;

  // histórico de rodadas: o que cresceu, e quando
  const titH = ws.getCell(r, 1);
  titH.value = TITULO_HISTORICO;
  titH.font = { name: FONTE, bold: true, size: 11, color: { argb: TINTA } };
  r++;
  ["Rodada", "Quando", "Entraram", "Total na planilha"].forEach((t, i) => {
    const cel = ws.getCell(r, i + 1);
    cel.value = t;
    cel.font = { name: FONTE, bold: true, size: 9, color: { argb: SUAVE } };
    cel.border = { bottom: fina };
  });
  r++;
  for (const h of historico) {
    ws.getCell(r, 1).value = `Rodada ${h.numero}`;
    ws.getCell(r, 2).value = h.quando;
    ws.getCell(r, 3).value = h.novas;
    ws.getCell(r, 4).value = h.total;
    for (let c = 1; c <= 4; c++) ws.getCell(r, c).font = { name: FONTE, size: 10, color: { argb: TINTA } };
    r++;
  }

  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${LINHA_CABECALHO}:${LINHA_CABECALHO}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  // protegida contra edição acidental; sem senha de propósito (é um freio, não segurança)
  await ws.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
  });

  // aba que o Power Automate lê para criar as tarefas no Planner (piloto)
  escreverPlanner(
    wb,
    itens.map((it, i) => ({
      linhaOrigem: it.linhaOrigem,
      posicao: it.linhaOrigem - PRIMEIRA_LINHA_DADOS + 1,
      grupo: it.grupo,
      solicitacao: it.solicitacao,
      pagina: it.pagina,
      secao: it.secao,
      links: it.links,
      obs: it.obs,
    })),
    {
      cliente: opcoes.cliente,
      rodada: numero,
      novas: opcoes.novas,
      printsPorLinha: new Map([...prints].map(([linha, lista]) => [linha, lista.length])),
    },
  );

  // as fórmulas de andamento recalculam ao abrir, mesmo que o arquivo tenha vindo de outro programa
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };

  // abre já nesta aba: é a que a analista e o cliente leem
  const indice = wb.worksheets.findIndex((w) => w.id === ws.id);
  if (wb.views.length === 0) {
    wb.views = [{ x: 0, y: 0, width: 20000, height: 10000, firstSheet: 0, activeTab: indice, visibility: "visible" }];
  } else {
    wb.views[0].activeTab = indice;
  }
  for (const w of wb.worksheets) {
    // só uma aba selecionada: duas selecionadas viram "grupo" e a edição vale para as duas
    for (const v of w.views) (v as { tabSelected?: boolean }).tabSelected = w.id === ws.id;
  }
}
