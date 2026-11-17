import type ExcelJS from "exceljs";
import { textoDaCelula } from "./xlsx.js";

/**
 * Aba "Planner": a tabela que o Power Automate lê para criar as tarefas no Microsoft
 * Planner (piloto, sem API e sem aprovação da TI: o Excel fica numa pasta do
 * SharePoint e um fluxo com conectores padrão cria uma tarefa por linha).
 *
 * Regras que o fluxo e as rodadas dependem:
 *   - a tabela se chama "Tarefas" (o conector do Excel só lê TABELAS, não células soltas);
 *   - "Chave" identifica a linha ("Linha 5" = linha da aba Alteração) e nunca se repete;
 *   - só as linhas com "Status do envio" = "Pendente de envio" viram tarefa; o fluxo troca
 *     para "Enviada" e escreve o "Link da tarefa" — então uma segunda rodada não recria o que já foi;
 *   - ao acrescentar alterações, as linhas que já estavam aqui são PRESERVADAS como estão
 *     (título, checklist e link podem ter sido ajustados por alguém) e só entram as novas.
 */

export const ABA_PLANNER = "Planner";
export const TABELA_PLANNER = "Tarefas";
export const ST_PENDENTE = "Pendente de envio";
export const ST_ENVIADA = "Enviada";
export const ST_EXISTIA = "Já existia (não enviar)";

const CABECALHO = [
  "Chave",
  "Status do envio",
  "Título",
  "Descrição",
  "Balde",
  "Etiqueta",
  "Checklist",
  "Prints (link da pasta)",
  "Link da tarefa",
] as const;
const LARGURAS = [11, 20, 46, 64, 12, 24, 30, 30, 36];
const LINHA_CABECALHO = 4;
const CHECKLIST_PADRAO = "Fazer a alteração\nConferir no mobile\nSubir para o ar";

export type ItemPlanner = {
  linhaOrigem: number;
  /** posição da alteração no briefing (1 = primeira linha de dados) */
  posicao: number;
  grupo: string;
  solicitacao: string;
  pagina: string;
  secao: string;
  links: string;
  obs: string;
};

export type ContextoPlanner = {
  cliente: string;
  rodada: number;
  /** quantas das últimas alterações entraram agora (as anteriores já estavam na planilha) */
  novas: number;
  /** quantos prints cada linha da aba Alteração tem */
  printsPorLinha: Map<number, number>;
};

const TITULO_MAX = 120;

export function tituloDaTarefa(it: Pick<ItemPlanner, "posicao" | "solicitacao">): string {
  const primeira = it.solicitacao.split("\n").find((l) => l.trim())?.trim() ?? "Sem descrição";
  const base = primeira.length > TITULO_MAX ? primeira.slice(0, TITULO_MAX - 1).trimEnd() + "…" : primeira;
  return `#${it.posicao} ${base}`;
}

/** A descrição da tarefa: texto simples, em blocos, sem seção vazia. O Planner não aceita formatação rica. */
export function descricaoDaTarefa(it: ItemPlanner, ctx: ContextoPlanner): string {
  const blocos: string[] = [`O QUE FAZER\n${it.solicitacao.trim()}`];
  const onde = [it.pagina && `Página: ${it.pagina}`, it.secao && `Seção: ${it.secao}`].filter(Boolean).join("\n");
  if (onde) blocos.push(`ONDE\n${onde}`);
  if (it.links) blocos.push(`LINKS DO CONTEÚDO\n${it.links}`);
  if (it.obs) blocos.push(`OBSERVAÇÕES\n${it.obs}`);
  const nPrints = ctx.printsPorLinha.get(it.linhaOrigem) ?? 0;
  if (nPrints) {
    blocos.push(
      `PRINTS\n${nPrints} ${nPrints === 1 ? "print" : "prints"} desta alteração (veja o arquivo do briefing, aba "Briefing", ou a pasta de prints).`,
    );
  }
  blocos.push(`Briefing: ${ctx.cliente.trim() || "cliente"} · alteração #${it.posicao} · linha ${it.linhaOrigem} da planilha`);
  return blocos.join("\n\n");
}

const chaveDe = (linhaOrigem: number) => `Linha ${linhaOrigem}`;

/** As linhas que já estavam na aba (por Chave), para não perder o que foi enviado ou ajustado. */
function lerExistentes(wb: ExcelJS.Workbook): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  const ws = wb.getWorksheet(ABA_PLANNER);
  if (!ws) return mapa;
  let cab = 0;
  for (let r = 1; r <= 15 && !cab; r++) if (textoDaCelula(ws.getCell(r, 1).value) === "Chave") cab = r;
  if (!cab) return mapa;
  for (let r = cab + 1; r <= ws.rowCount; r++) {
    const chave = textoDaCelula(ws.getCell(r, 1).value);
    if (!chave) continue;
    mapa.set(chave, CABECALHO.map((_, i) => textoDaCelula(ws.getCell(r, i + 1).value)));
  }
  return mapa;
}

export function escreverPlanner(wb: ExcelJS.Workbook, itens: ItemPlanner[], ctx: ContextoPlanner): void {
  const existentes = lerExistentes(wb);
  const antiga = wb.getWorksheet(ABA_PLANNER);
  if (antiga) wb.removeWorksheet(antiga.id);

  const semHistorico = existentes.size === 0;
  const primeiraNova = itens.length - ctx.novas; // índice a partir do qual as alterações são desta rodada

  const linhas = itens.map((it, i): string[] => {
    const guardada = existentes.get(chaveDe(it.linhaOrigem));
    if (guardada) return guardada;
    // planilha que já estava em execução antes desta aba: o que já existia não vira tarefa
    const jaExistia = semHistorico && i < primeiraNova;
    return [
      chaveDe(it.linhaOrigem),
      jaExistia ? ST_EXISTIA : ST_PENDENTE,
      tituloDaTarefa(it),
      descricaoDaTarefa(it, ctx),
      jaExistia ? "Rodada 1" : `Rodada ${ctx.rodada}`,
      it.grupo,
      CHECKLIST_PADRAO,
      "",
      "",
    ];
  });

  const ws = wb.addWorksheet(ABA_PLANNER, { properties: { tabColor: { argb: "FF7B83EB" } }, views: [{ showGridLines: false }] });
  LARGURAS.forEach((l, i) => (ws.getColumn(i + 1).width = l));

  ws.mergeCells(1, 1, 1, CABECALHO.length);
  const t = ws.getCell(1, 1);
  t.value = "Planner — esta aba é lida pelo Power Automate para criar as tarefas";
  t.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FF1F2A44" } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, CABECALHO.length);
  const g = ws.getCell(2, 1);
  g.value =
    `Cada linha vira uma tarefa no Planner. Só entram as linhas com “Status do envio” = “${ST_PENDENTE}”; ` +
    `o fluxo troca para “${ST_ENVIADA}” e preenche o “Link da tarefa”. Pode ajustar título, checklist e a pasta dos prints antes de enviar. ` +
    `Não renomeie a tabela “${TABELA_PLANNER}” nem as colunas.`;
  g.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF7A8499" } };
  g.alignment = { vertical: "middle", wrapText: true, indent: 1 };
  ws.getRow(2).height = 34;

  ws.addTable({
    name: TABELA_PLANNER,
    ref: `A${LINHA_CABECALHO}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: CABECALHO.map((nome) => ({ name: nome, filterButton: true })),
    rows: linhas,
  });

  linhas.forEach((_, i) => {
    const r = LINHA_CABECALHO + 1 + i;
    for (let c = 1; c <= CABECALHO.length; c++) {
      const cel = ws.getCell(r, c);
      cel.alignment = { vertical: "top", wrapText: true };
      cel.font = { name: "Calibri", size: 11 };
    }
    ws.getRow(r).height = Math.min(140, Math.max(45, 15 * (2 + (linhas[i][3].split("\n").length + 1) / 1.6)));
  });
}
