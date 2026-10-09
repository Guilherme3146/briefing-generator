import ExcelJS from "exceljs";
import {
  PRIMEIRA_LINHA_DADOS,
  ULTIMA_LINHA_DADOS,
  type Alteracao,
  type Briefing,
} from "./schema.js";

/**
 * Escrita no .xlsx — sempre CARREGANDO o arquivo e preenchendo, nunca gerando
 * do zero.
 *
 * Isso preserva, verificado no arquivo real:
 *   - as 5 abas (Site, Alteração, Complemento de Mockup [oculta], Prints, FAQ)
 *   - a formula de matriz em A1 ("Progresso: X%")
 *   - as validacoes de lista (G = Aguardando/Pendente/Finalizado)
 *   - as celulas mescladas e os 3 prints fixos da aba Prints
 *
 * IMPORTANTE: use ExcelJS de ponta a ponta. Um .xlsx salvo por openpyxl
 * quebra na leitura do ExcelJS ("Cannot read properties of undefined
 * (reading 'anchors')") — nao misture as duas bibliotecas no mesmo arquivo.
 */

export const ABA_ALTERACAO = "Alteração";

/** coluna E (Obs. Implementação), 0-based, onde os prints sao ancorados */
const COLUNA_PRINT = 4;

export type Print = {
  ordem: number;
  buffer: Buffer;
  extensao: "png" | "jpeg" | "gif";
};

// ------------------------------------------------------------------ leitura

export async function abrir(origem: string | Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (typeof origem === "string") await wb.xlsx.readFile(origem);
  else await wb.xlsx.load(origem as any);
  return wb;
}

export function abaAlteracao(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(ABA_ALTERACAO);
  if (!ws) {
    throw new Error(
      `A planilha não tem a aba "${ABA_ALTERACAO}". Confira se é mesmo um briefing no modelo da casa.`,
    );
  }
  return ws;
}

/** Texto util de uma celula, ignorando formula/richText do ExcelJS. */
export function textoDaCelula(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (typeof valor === "object") {
    const v = valor as unknown as Record<string, unknown>;
    if (typeof v.result === "string") return v.result.trim();
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((t) => t.text ?? "").join("").trim();
    }
    if (typeof v.text === "string") return v.text.trim();
  }
  return "";
}

export type LinhaExistente = {
  linha: number;
  solicitacao: string;
  url_pagina: string;
  secao: string;
  val_producao: string;
};

/**
 * A coluna A e o marcador canonico de linha ocupada — e o que a propria
 * formula de progresso usa (COUNTA(A3:A98)). G/H/I vem preenchidos de fabrica
 * no template ("Aguardando"/false) e por isso NAO servem para dizer se a linha
 * tem conteudo.
 */
export function linhasOcupadas(ws: ExcelJS.Worksheet): LinhaExistente[] {
  const linhas: LinhaExistente[] = [];
  for (let r = PRIMEIRA_LINHA_DADOS; r <= ULTIMA_LINHA_DADOS; r++) {
    const solicitacao = textoDaCelula(ws.getCell(r, 1).value);
    if (!solicitacao) continue;
    linhas.push({
      linha: r,
      solicitacao,
      url_pagina: textoDaCelula(ws.getCell(r, 2).value),
      secao: textoDaCelula(ws.getCell(r, 3).value),
      val_producao: textoDaCelula(ws.getCell(r, 7).value),
    });
  }
  return linhas;
}

/**
 * Primeira linha livre DEPOIS da ultima ocupada.
 *
 * Nao e "a primeira linha vazia": se alguem apagou o texto da linha 5 mas
 * deixou a 6 preenchida, escrever na 5 inseriria a alteracao no meio de uma
 * sequencia que a producao ja esta executando de cima para baixo.
 */
export function primeiraLinhaLivre(ws: ExcelJS.Worksheet): number {
  const ocupadas = linhasOcupadas(ws);
  if (ocupadas.length === 0) return PRIMEIRA_LINHA_DADOS;
  return ocupadas[ocupadas.length - 1].linha + 1;
}

// ------------------------------------------------------------------ escrita

function escrever(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  alteracoes: Alteracao[],
  linhaInicial: number,
  prints: Print[],
): void {
  const ordenadas = [...alteracoes].sort((a, b) => a.ordem - b.ordem);
  const textos = comMarcadoresDeGrupo(ordenadas);

  ordenadas.forEach((alt, i) => {
    const linha = linhaInicial + i;

    // trava final: nunca sobrescrever conteudo de outra pessoa
    const existente = textoDaCelula(ws.getCell(linha, 1).value);
    if (existente) {
      throw new Error(
        `A linha ${linha} já tem conteúdo ("${existente.slice(0, 40)}…"). ` +
          `Nada foi gravado.`,
      );
    }

    ws.getCell(linha, 1).value = textos[i] || null; // A
    ws.getCell(linha, 2).value = alt.url_pagina.trim() || null; // B
    ws.getCell(linha, 3).value = alt.secao.trim() || null; // C
    ws.getCell(linha, 4).value = linksDaCelula(alt.link_conteudo); // D
    ws.getCell(linha, 5).value = alt.obs_implementacao.trim() || null; // E
    ws.getCell(linha, 6).value = alt.obs_producao.trim() || null; // F
    // G, H, I: nao tocar — pertencem a producao / implementacao / design
  });

  // prints vao ancorados na coluna E da linha da propria alteracao,
  // que e exatamente como a equipe cola hoje direto no Excel
  for (const print of prints) {
    const indice = ordenadas.findIndex((a) => a.ordem === print.ordem);
    if (indice < 0) continue;
    const linha = linhaInicial + indice;
    const id = wb.addImage({ buffer: print.buffer as any, extension: print.extensao });
    ws.addImage(id, {
      tl: { col: COLUNA_PRINT, row: linha - 1 } as any, // 0-based
      ext: { width: 420, height: 210 },
    });
  }
}

export type OpcoesGeracao = {
  templatePath: string;
  briefing: Briefing;
  prints?: Print[];
};

/** Primeira rodada: parte do template limpo e escreve a partir da linha 3. */
export async function gerarPlanilha({
  templatePath,
  briefing,
  prints = [],
}: OpcoesGeracao): Promise<Buffer> {
  if (briefing.alteracoes.length === 0) {
    throw new Error("Nenhuma alteração para gerar.");
  }
  const capacidade = ULTIMA_LINHA_DADOS - PRIMEIRA_LINHA_DADOS + 1;
  if (briefing.alteracoes.length > capacidade) {
    throw new Error(
      `O template comporta ${capacidade} alterações (linhas 3 a 98) e foram enviadas ` +
        `${briefing.alteracoes.length}. Divida em mais de uma planilha.`,
    );
  }

  const wb = await abrir(templatePath);
  const ws = abaAlteracao(wb);
  escrever(wb, ws, briefing.alteracoes, PRIMEIRA_LINHA_DADOS, prints);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type OpcoesAcrescimo = {
  arquivo: Buffer;
  briefing: Briefing;
  prints?: Print[];
};

export type ResultadoAcrescimo = {
  arquivo: Buffer;
  primeiraLinha: number;
  ultimaLinha: number;
  jaExistiam: number;
};

/**
 * Fase 4 — acrescenta a uma planilha que JA ESTA EM EXECUCAO.
 *
 * E o caminho que o briefing original nao previa: a planilha nao e um documento
 * entregue e esquecido. Ela continua sendo escrita por producao, implementacao
 * e design nas colunas G/H/I, e alimenta o "Progresso: X%" em A1. Gerar um
 * arquivo novo quebraria o link que ja esta no Salesforce e descartaria esse
 * estado.
 */
export async function acrescentarAlteracoes({
  arquivo,
  briefing,
  prints = [],
}: OpcoesAcrescimo): Promise<ResultadoAcrescimo> {
  if (briefing.alteracoes.length === 0) {
    throw new Error("Nenhuma alteração para acrescentar.");
  }

  const wb = await abrir(arquivo);
  const ws = abaAlteracao(wb);

  const jaExistiam = linhasOcupadas(ws).length;
  const primeiraLinha = primeiraLinhaLivre(ws);
  const ultimaLinha = primeiraLinha + briefing.alteracoes.length - 1;

  if (ultimaLinha > ULTIMA_LINHA_DADOS) {
    const livres = ULTIMA_LINHA_DADOS - primeiraLinha + 1;
    throw new Error(
      `A planilha já tem ${jaExistiam} alteração(ões) e cabem mais ${Math.max(0, livres)} ` +
        `(o limite é a linha ${ULTIMA_LINHA_DADOS}). Foram enviadas ${briefing.alteracoes.length}.`,
    );
  }

  escrever(wb, ws, briefing.alteracoes, primeiraLinha, prints);

  return {
    arquivo: Buffer.from(await wb.xlsx.writeBuffer()),
    primeiraLinha,
    ultimaLinha,
    jaExistiam,
  };
}

export type Duplicada = {
  ordem: number;
  linha: number;
  solicitacao: string;
};

/**
 * Alteracoes que parecem ja estar na planilha.
 *
 * Nao bloqueia nada — so avisa. O caso real e o analista reabrir o rascunho do
 * navegador (que fica em localStorage) e acrescentar de novo o mesmo lote que
 * ja mandou de manha, duplicando linha numa planilha que a producao ja comecou.
 *
 * A comparacao ignora acento, caixa e espaco, e tambem os marcadores de grupo,
 * que sao acrescentados na hora de escrever e nao existem no card.
 */
export function possiveisDuplicadas(
  existentes: LinhaExistente[],
  alteracoes: Alteracao[],
): Duplicada[] {
  const chave = (t: string) =>
    t
      .replace(/\*{3,}/g, " ")
      .replace(/^\s*(in[íi]cio|fim) de .*$/gim, " ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const naPlanilha = new Map<string, number>();
  for (const e of existentes) {
    const k = chave(e.solicitacao);
    if (k && !naPlanilha.has(k)) naPlanilha.set(k, e.linha);
  }

  const achadas: Duplicada[] = [];
  for (const alt of alteracoes) {
    const k = chave(alt.solicitacao);
    const linha = k ? naPlanilha.get(k) : undefined;
    if (linha) achadas.push({ ordem: alt.ordem, linha, solicitacao: alt.solicitacao });
  }
  return achadas;
}

// ----------------------------------------------------------------- auxiliares

/**
 * Os blocos de alteracoes relacionadas sao expressos em texto livre na coluna A,
 * como a equipe ja faz hoje:
 *
 *     ****
 *     inicio de mudancas na pagina de produtos
 *     ...
 *     fim de mudancas na pagina de produtos
 *     ***
 */
function comMarcadoresDeGrupo(alteracoes: Alteracao[]): string[] {
  return alteracoes.map((alt, i) => {
    const grupo = alt.grupo.trim();
    let texto = alt.solicitacao.trim();
    if (!grupo) return texto;

    const anterior = alteracoes[i - 1]?.grupo.trim() ?? "";
    const proximo = alteracoes[i + 1]?.grupo.trim() ?? "";

    if (anterior !== grupo) texto = `****\ninício de ${grupo}\n\n${texto}`;
    if (proximo !== grupo) texto = `${texto}\n\nfim de ${grupo}\n***`;
    return texto;
  });
}

function linksDaCelula(links: string[]): string | null {
  const limpos = links.map((l) => l.trim()).filter(Boolean);
  return limpos.length ? limpos.join("\n") : null;
}

/** Nome de arquivo no padrao que a equipe reconhece, sem caractere proibido. */
export function nomeDoArquivo(cliente: string, data = new Date()): string {
  const base = (cliente.trim() || "briefing")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  const iso = data.toISOString().slice(0, 10);
  return `${base}-alteracao-${iso}.xlsx`;
}
