import { lintBriefing, onde, perguntaDaRegra, type Contexto } from "./lint.js";
import type { Briefing, Veredito } from "./schema.js";

/**
 * Monta a lista de perguntas a mandar AO CLIENTE.
 *
 * Deterministico: junta tres fontes que ja existem e nao chama IA nenhuma.
 *
 *   duvida   — veio do extrator (Fase 2), ja escrita como pergunta
 *   revisor  — veio do revisor semantico (Fase 3), a mais especifica
 *   regra    — veio do lint, traduzida pelo template da propria regra
 *
 * O ponto do produto esta aqui: o gargalo declarado no briefing nao e digitar,
 * e entender o que o cliente quis. Esta lista e o unico lugar do app que ataca
 * isso diretamente — ela encurta a ida e volta em vez de so acelerar a digitacao.
 */

export type OrigemPergunta = "revisor" | "duvida" | "regra";

export type ItemPergunta = {
  ordem: number;
  origem: OrigemPergunta;
  texto: string;
  /** nome da regra do lint, quando a origem for "regra" */
  regra?: string;
};

export type ResultadoPerguntas = {
  itens: ItemPergunta[];
  /** bloco pronto para colar no e-mail/WhatsApp do cliente */
  texto: string;
};

/**
 * Regras cuja pergunta o revisor cobre melhor.
 *
 * REFERENCIA_VAGA e uma heuristica ("qual item exatamente?"); quando o revisor
 * reprovou a mesma alteracao, ele diz QUAL e a ambiguidade. Perguntar as duas
 * coisas ao cliente seria repetir a mesma duvida com palavras diferentes.
 */
const COBERTAS_PELO_REVISOR = new Set(["REFERENCIA_VAGA"]);

export function montarPerguntas(
  briefing: Briefing,
  vereditos: Veredito[] = [],
  contextos: Map<number, Contexto> = new Map(),
): ResultadoPerguntas {
  const reprovadas = new Map(
    vereditos.filter((v) => !v.executavel).map((v) => [v.ordem, v]),
  );

  const itens: ItemPergunta[] = [];
  const vistos = new Set<string>();

  const add = (item: ItemPergunta) => {
    const texto = item.texto.trim();
    if (!texto) return;
    const chave = `${item.ordem}|${texto.toLowerCase()}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    itens.push({ ...item, texto });
  };

  const achados = lintBriefing(briefing, contextos);
  const porOrdem = new Map(briefing.alteracoes.map((a) => [a.ordem, a]));

  for (const alt of [...briefing.alteracoes].sort((a, b) => a.ordem - b.ordem)) {
    // 1. o revisor e o mais especifico — vem primeiro
    const reprovada = reprovadas.get(alt.ordem);
    if (reprovada?.pergunta) {
      add({ ordem: alt.ordem, origem: "revisor", texto: reprovada.pergunta });
    }

    // 2. duvidas do extrator ja vem escritas como pergunta ao cliente
    for (const duvida of alt.duvidas) {
      add({ ordem: alt.ordem, origem: "duvida", texto: duvida });
    }

    // 3. regras do FAQ que o cliente pode responder
    for (const achado of achados.filter((a) => a.ordem === alt.ordem)) {
      if (reprovada && COBERTAS_PELO_REVISOR.has(achado.regra)) continue;
      const pergunta = perguntaDaRegra(achado.regra, porOrdem.get(achado.ordem)!);
      if (pergunta) {
        add({ ordem: alt.ordem, origem: "regra", texto: pergunta, regra: achado.regra });
      }
    }
  }

  return { itens, texto: formatar(briefing, itens) };
}

/** Bloco de texto pronto para colar, agrupado por alteracao. */
function formatar(briefing: Briefing, itens: ItemPergunta[]): string {
  if (itens.length === 0) return "";

  const cliente = briefing.cliente.trim();
  const linhas: string[] = [
    cliente
      ? `Olá! Antes de começarmos as alterações do site da ${cliente}, ficaram algumas dúvidas:`
      : "Olá! Antes de começarmos as alterações do site, ficaram algumas dúvidas:",
    "",
  ];

  const porOrdem = new Map(briefing.alteracoes.map((a) => [a.ordem, a]));
  let n = 0;
  let ordemAtual: number | null = null;
  let localNoCabecalho = "";

  for (const item of itens) {
    if (item.ordem !== ordemAtual) {
      ordemAtual = item.ordem;
      localNoCabecalho = "";
      const alt = porOrdem.get(item.ordem);
      const resumo = alt ? primeiraLinha(alt.solicitacao) : "";
      if (resumo) {
        const local = alt ? onde(alt) : "";
        if (n > 0) linhas.push("");
        linhas.push(`Sobre "${resumo}"${local ? ` (${local})` : ""}:`);
        localNoCabecalho = local;
      }
    }
    n += 1;
    linhas.push(`${n}. ${semLocalRepetido(item.texto, localNoCabecalho)}`);
  }

  linhas.push("", "Assim que nos responder, seguimos com a produção. Obrigado!");
  return linhas.join("\n");
}

/**
 * O cabecalho do grupo ja diz a pagina e a secao. Repetir dentro da pergunta
 * deixa a mensagem ao cliente pesada e com cara de automatica.
 *
 * O texto do item continua autocontido em `itens` — quem consome a API recebe a
 * pergunta inteira; so o bloco formatado e que enxuga.
 */
function semLocalRepetido(texto: string, local: string): string {
  if (!local) return texto;
  const prefixo = `${local.charAt(0).toUpperCase()}${local.slice(1)}: `;
  if (!texto.startsWith(prefixo)) return texto;
  const resto = texto.slice(prefixo.length);
  return resto.charAt(0).toUpperCase() + resto.slice(1);
}

function primeiraLinha(texto: string, limite = 70): string {
  const linha = texto.trim().split("\n")[0]?.trim() ?? "";
  return linha.length > limite ? `${linha.slice(0, limite - 1)}…` : linha;
}
