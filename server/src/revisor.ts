import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USO_ZERO, gerarEstruturado, somarUso, type Uso } from "./anthropic.js";
import { RevisaoSchema, type Alteracao, type Revisao, type Veredito } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Revisor semantico — Fase 3.
 *
 * Responde uma pergunta por alteracao: "um dev que nunca falou com o cliente
 * conseguiria executar isto sozinho?". E o unico lugar onde a IA se paga,
 * porque o defeito que ele pega (referencia que nao se resolve) passa limpo
 * por toda regra estrutural — vide "remover essa maquina", que tem as tres
 * colunas obrigatorias preenchidas e e inexecutavel.
 *
 * NAO entra no /api/revisar, que roda a cada 400ms de debounce. E acao
 * explicita, e o front so manda o que mudou desde a ultima revisao.
 */

export const PROMPT_REVISOR = fs.readFileSync(
  path.join(__dirname, "prompts", "revisor.md"),
  "utf8",
);

/**
 * Quantas alteracoes por chamada.
 *
 * Uma chamada por alteracao reenviaria o prompt de sistema N vezes — com 26
 * alteracoes isso e ~4x mais token de entrada do que agrupar. Agrupar demais,
 * por outro lado, degrada a atencao do modelo. 12 e o meio-termo; o servidor
 * confere se todos os vereditos voltaram e refaz o que faltar.
 */
export const TAMANHO_LOTE = Number(process.env.REVISOR_LOTE ?? 12);

export type ResultadoRevisao = {
  vereditos: Veredito[];
  uso: Uso;
  /** ordens que o modelo nao devolveu nem na segunda tentativa */
  faltantes: number[];
};

/** O revisor ve so o que o dev veria. O texto cru do cliente nunca entra aqui. */
export function paraRevisao(alt: Alteracao): string {
  const linhas = [
    `### Alteração ${alt.ordem}`,
    `O que fazer: ${alt.solicitacao.trim()}`,
    `Página: ${alt.url_pagina.trim() || "(não informada)"}`,
    `Seção: ${alt.secao.trim() || "(não informada)"}`,
  ];
  if (alt.link_conteudo.length) {
    linhas.push(`Link Conteúdo: ${alt.link_conteudo.length} link(s) anexado(s)`);
  }
  if (alt.obs_implementacao.trim()) {
    linhas.push(`Obs. Implementação: ${alt.obs_implementacao.trim()}`);
  }
  return linhas.join("\n");
}

function lotes<T>(itens: T[], tamanho: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) r.push(itens.slice(i, i + tamanho));
  return r;
}

async function revisarLote(alteracoes: Alteracao[]): Promise<{
  vereditos: Veredito[];
  uso: Uso;
}> {
  const { dados: bruto, uso } = await gerarEstruturado<Revisao>({
    sistema: PROMPT_REVISOR,
    usuario: alteracoes.map(paraRevisao).join("\n\n"),
    schema: RevisaoSchema,
    maxTokens: 8000,
  });

  // o modelo pode alucinar uma ordem que nao existe no lote; descarta
  const pedidas = new Set(alteracoes.map((a) => a.ordem));
  const vereditos = bruto.vereditos
    .filter((v) => pedidas.has(v.ordem))
    .map(normalizar);

  return { vereditos, uso };
}

/** Executavel => sem pergunta e sem motivo. Evita texto orfao na tela. */
function normalizar(v: Veredito): Veredito {
  if (v.executavel) return { ...v, motivo: "", pergunta: "" };
  return {
    ...v,
    motivo: v.motivo.trim(),
    pergunta: v.pergunta.trim(),
  };
}

export async function revisar(alteracoes: Alteracao[]): Promise<ResultadoRevisao> {
  // alteracao sem descricao ja e pendencia do lint; nao gasta token com ela
  const elegiveis = alteracoes.filter((a) => a.solicitacao.trim().length > 0);
  if (elegiveis.length === 0) {
    return { vereditos: [], uso: { ...USO_ZERO }, faltantes: [] };
  }

  const resultados = await Promise.all(
    lotes(elegiveis, TAMANHO_LOTE).map((lote) => revisarLote(lote)),
  );

  let uso = resultados.reduce((acc, r) => somarUso(acc, r.uso), { ...USO_ZERO });
  const porOrdem = new Map<number, Veredito>();
  for (const r of resultados) for (const v of r.vereditos) porOrdem.set(v.ordem, v);

  // segunda passada so no que faltou — e barato e evita card sem veredito
  const faltando = elegiveis.filter((a) => !porOrdem.has(a.ordem));
  if (faltando.length > 0) {
    const segunda = await Promise.all(
      lotes(faltando, TAMANHO_LOTE).map((lote) => revisarLote(lote)),
    );
    for (const r of segunda) {
      uso = somarUso(uso, r.uso);
      for (const v of r.vereditos) porOrdem.set(v.ordem, v);
    }
  }

  const faltantes = elegiveis.filter((a) => !porOrdem.has(a.ordem)).map((a) => a.ordem);

  return {
    vereditos: [...porOrdem.values()].sort((a, b) => a.ordem - b.ordem),
    uso,
    faltantes,
  };
}
