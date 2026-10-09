import type { Alteracao, Briefing } from "./schema.js";

/**
 * Checagem de lacunas — DETERMINISTICA, nunca via IA.
 *
 * As regras nao sao opiniao: saem da aba FAQ do proprio template, o que as
 * torna defensaveis numa conversa ("e o procedimento de voces").
 *
 * Severidade:
 *   "erro"  — bloqueia a geracao. So para o que o FAQ trata como obrigatorio.
 *   "aviso" — aparece no card, nao bloqueia.
 *
 * Por que quase tudo e aviso: regras ingenuas geram falso positivo. Medido nas
 * 3 planilhas reais, "deixar o logo na header com largura de 122px" disparava
 * "fala de imagem sem link" sendo que e mudanca de tamanho. Cada regra precisa
 * de uma rodada de ajuste contra planilha real antes de virar bloqueio.
 */

export type Severidade = "erro" | "aviso";

export type Achado = {
  ordem: number;
  regra: string;
  faq: string;
  severidade: Severidade;
  mensagem: string;
};

export type Contexto = {
  /** quantos prints o analista anexou nesta alteracao */
  prints: number;
};

// ---------------------------------------------------------------- utilidades

/**
 * Tres listas de verbo, de proposito.
 *
 * VERBO_INSERIR e estreito porque a regra de imagem depende dele: incluir
 * "deixar" aqui faria "deixar o logo na header com largura de 122px" acusar
 * "imagem sem link", que e falso positivo medido na planilha da Brasil Vending.
 *
 * VERBO_ESTILO e largo porque pedido de cor quase sempre vem como "deixar o
 * fundo do rodape azul".
 */
const VERBO_INSERIR = /\b(inserir|incluir|adicionar|substitu\w*|troca\w*|coloca\w*|habilita\w*)\b/i;
const VERBO_ESTILO = /\b(deixa\w*|deixe|aplica\w*|ajusta\w*|muda\w*|altera\w*|troca\w*|substitu\w*|coloca\w*|inserir|incluir)\b/i;
const VERBO_TEXTO = /\b(corrig\w*|reescrev\w*|reconstru\w*|atualiza\w*|ajusta\w*|muda\w*|altera\w*|troca\w*|substitu\w*|inserir|incluir|adicionar|remover)\b/i;
const VERBO_REMOVER = /\b(remover|retirar|excluir|apagar|tirar)\b/i;

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const TEM_ASPAS = /["“”'']/;
const DESTINO_TEXTO = /(\bpara\s*:|\bpor\s*:|\bdever[áa]\s+ser\b|\bficar[áa]\b|:\s*$)/im;

const SUBSTANTIVO_IMAGEM = /\b(imagem|imagens|foto|fotos|banner|banners|galeria|logo|logotipo|v[íi]deo|v[íi]deos|[íi]cone|[íi]cones)\b/i;
const SUBSTANTIVO_TEXTO = /\b(texto|textos|par[áa]grafo|t[íi]tulo|subt[íi]tulo|frase|chamada|descri[çc][ãa]o)\b/i;

const NOME_COR = /\b(azul|vermelh\w*|verde|amarel\w*|laranja|roxo|rosa|pret\w*|branc\w*|cinza|dourad\w*|prate\w*|bege|marrom)\b/i;
const PALAVRA_COR = /\b(cor|cores|degrad\w*|gradiente)\b/i;

const MENCAO_PRINT = /\b(print|prints|captura|circulad\w*|sinalizad\w*|marcad\w*|em anexo|anexo|screenshot)\b/i;

const REFERENCIA_VAGA = /\b(ess[ae]s?|est[ae]s?|aquel[ae]s?)\s+([a-zà-ÿ]{3,})\b/i;

/** divide em frases para checar proximidade verbo <-> substantivo */
function frases(texto: string): string[] {
  return texto
    .split(/[.;\n]+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/** ha alguma frase onde os dois padroes aparecem juntos? */
function juntos(texto: string, a: RegExp, b: RegExp): boolean {
  return frases(texto).some((f) => a.test(f) && b.test(f));
}

function temLink(alt: Alteracao): boolean {
  return alt.link_conteudo.some((l) => l.trim().length > 0);
}

// -------------------------------------------------------------------- regras

type Regra = {
  nome: string;
  faq: string;
  severidade: Severidade;
  aplica: (alt: Alteracao, ctx: Contexto) => string | null;
  /**
   * Texto a mandar AO CLIENTE quando a regra dispara.
   *
   * Separado de `aplica` de proposito: a mensagem do lint e escrita para o
   * analista ("falta o hex") e nao serve para sair da empresa. Regra sem este
   * campo e lacuna interna — nao vira pergunta.
   */
  perguntaCliente?: (alt: Alteracao) => string;
};

/** "na página /produtos, seção produtos > acrílico" */
export function onde(alt: Alteracao): string {
  const partes: string[] = [];
  const url = alt.url_pagina.trim();
  if (url) {
    let caminho = url;
    try {
      const u = new URL(url);
      caminho = u.pathname === "/" ? u.hostname : u.pathname;
    } catch {
      /* URL incompleta: usa como veio */
    }
    partes.push(`na página ${caminho}`);
  }
  const secao = alt.secao.trim().replace(/\s*\n\s*/g, " > ");
  if (secao) partes.push(`seção ${secao}`);
  return partes.join(", ");
}

function comLocal(alt: Alteracao, pergunta: string): string {
  const local = onde(alt);
  if (!local) return pergunta;
  return `${local.charAt(0).toUpperCase()}${local.slice(1)}: ${pergunta}`;
}

export const REGRAS: Regra[] = [
  {
    nome: "O_QUE_FAZER_AUSENTE",
    faq: "A7",
    severidade: "erro",
    aplica: (alt) =>
      alt.solicitacao.trim().length === 0
        ? "A alteração está sem descrição. 'O que fazer' é obrigatório."
        : null,
  },
  {
    nome: "ONDE_AUSENTE",
    faq: "A7",
    severidade: "erro",
    aplica: (alt) =>
      alt.url_pagina.trim().length === 0
        ? "Falta a URL da página. 'Onde' é obrigatório."
        : null,
  },
  {
    nome: "SECAO_AUSENTE",
    faq: "A7",
    severidade: "aviso",
    aplica: (alt) =>
      alt.secao.trim().length === 0
        ? "Sem seção. A produção vai ter que caçar o lugar na página."
        : null,
  },
  {
    nome: "TEXTO_SEM_DESTINO",
    faq: "A7",
    severidade: "aviso",
    perguntaCliente: (a) =>
      comLocal(a, "qual deve ser o texto novo, exatamente como deve aparecer no site?"),
    aplica: (alt) => {
      const t = alt.solicitacao;
      if (!juntos(t, VERBO_TEXTO, SUBSTANTIVO_TEXTO)) return null;
      if (TEM_ASPAS.test(t) || DESTINO_TEXTO.test(t)) return null;
      return "Pede mudança de texto mas não traz o texto novo. O FAQ A7 chama isso de erro mais comum: 'troque isso' sem dizer 'pra isso'.";
    },
  },
  {
    nome: "IMAGEM_SEM_FONTE",
    faq: "A16",
    severidade: "aviso",
    perguntaCliente: (a) =>
      comLocal(a, "você envia a imagem que devemos usar, ou prefere que a gente escolha?"),
    aplica: (alt, ctx) => {
      if (!juntos(alt.solicitacao, VERBO_INSERIR, SUBSTANTIVO_IMAGEM)) return null;
      if (temLink(alt) || ctx.prints > 0) return null;
      return "Pede inserir/trocar imagem mas não há Link Conteúdo nem print anexado.";
    },
  },
  {
    nome: "COR_SEM_HEX",
    faq: "A13",
    severidade: "aviso",
    perguntaCliente: (a) =>
      comLocal(a, "qual o código exato da cor? (no formato #0d215c)"),
    aplica: (alt) => {
      const t = alt.solicitacao;
      const falaDeCor = PALAVRA_COR.test(t) || juntos(t, VERBO_ESTILO, NOME_COR);
      if (!falaDeCor) return null;
      if (HEX.test(t)) return null;
      return "Cita cor sem código hexadecimal. O FAQ A13 exige o hex — 'azul claro' não basta.";
    },
  },
  {
    nome: "FONTE_SEM_NOME",
    faq: "A14",
    severidade: "aviso",
    perguntaCliente: (a) =>
      comLocal(a, "qual fonte devemos usar? Precisa ser uma das disponíveis no Google Fonts."),
    aplica: (alt) => {
      // so dispara com intencao explicita de trocar a fonte, para nao pegar
      // frases como "atencao a fonte que deve ficar escura" (que fala de cor)
      const t = alt.solicitacao;
      if (!/\b(troca\w*|substitu\w*|altera\w*|muda\w*|inserir|incluir)\s+(a\s+|de\s+)?(fonte|tipografia)\b/i.test(t) &&
          !/\bfonte\s+(para|por)\b/i.test(t)) return null;
      if (/google\s*fonts?/i.test(t)) return null;
      return "Pede troca de fonte. O FAQ A14 pede o nome de uma fonte do Google Fonts.";
    },
  },
  {
    nome: "ICONE_SEM_REF",
    faq: "A15",
    severidade: "aviso",
    perguntaCliente: (a) => comLocal(a, "qual ícone devemos usar?"),
    aplica: (alt) => {
      const t = alt.solicitacao;
      if (!juntos(t, VERBO_INSERIR, /\b[íi]cones?\b/i)) return null;
      if (/font\s*awesome|fa-/i.test(t)) return null;
      return "Pede ícone sem referência. O FAQ A15 pede o ícone da biblioteca Font Awesome.";
    },
  },
  {
    nome: "PRINT_CITADO_SEM_ANEXO",
    faq: "A7",
    severidade: "aviso",
    aplica: (alt, ctx) => {
      if (!MENCAO_PRINT.test(alt.solicitacao + " " + alt.obs_implementacao)) return null;
      if (ctx.prints > 0) return null;
      return "O texto cita um print/marcação, mas nenhuma imagem foi anexada nesta alteração.";
    },
  },
  {
    nome: "REFERENCIA_VAGA",
    faq: "A7",
    severidade: "aviso",
    perguntaCliente: (a) => comLocal(a, "qual item exatamente devemos alterar?"),
    aplica: (alt, ctx) => {
      const t = alt.solicitacao;
      // "remover essa maquina" — passa por toda regra estrutural e e inexecutavel
      if (!VERBO_REMOVER.test(t) && !VERBO_INSERIR.test(t)) return null;
      if (!REFERENCIA_VAGA.test(t)) return null;
      if (TEM_ASPAS.test(t) || ctx.prints > 0 || temLink(alt)) return null;
      if (t.trim().length > 160) return null; // texto longo costuma se explicar
      return "Usa referência vaga ('essa/esse ...') sem identificar o quê, e não há print nem link que resolva. A produção não consegue executar sem perguntar.";
    },
  },
];

// ------------------------------------------------------------------ execucao

export function lintAlteracao(alt: Alteracao, ctx: Contexto): Achado[] {
  const achados: Achado[] = [];

  // Fase 2 — a decisao D1 virou trava: card vindo da IA so passa depois que o
  // analista confirma. Sem isso, "confirmar" vira um clique sobre um
  // formulario pre-preenchido e a ancoragem faz aceitar o rascunho.
  if (!alt.confirmado) {
    achados.push({
      ordem: alt.ordem,
      regra: "NAO_CONFIRMADO",
      faq: "—",
      severidade: "erro",
      mensagem: "Sugestão da IA ainda não confirmada. Revise os campos e confirme.",
    });
  }

  // cada duvida da IA vira um aviso proprio, escrito como pergunta ao cliente
  for (const duvida of alt.duvidas) {
    achados.push({
      ordem: alt.ordem,
      regra: "DUVIDA_DA_IA",
      faq: "—",
      severidade: "aviso",
      mensagem: duvida,
    });
  }

  for (const regra of REGRAS) {
    const mensagem = regra.aplica(alt, ctx);
    if (mensagem) {
      achados.push({
        ordem: alt.ordem,
        regra: regra.nome,
        faq: regra.faq,
        severidade: regra.severidade,
        mensagem,
      });
    }
  }
  return achados;
}

export function lintBriefing(
  briefing: Briefing,
  contextos: Map<number, Contexto> = new Map(),
): Achado[] {
  return briefing.alteracoes.flatMap((alt) =>
    lintAlteracao(alt, contextos.get(alt.ordem) ?? { prints: 0 }),
  );
}

export function temErro(achados: Achado[]): boolean {
  return achados.some((a) => a.severidade === "erro");
}

/** Pergunta ao cliente que a regra gera, ou null se for lacuna interna. */
export function perguntaDaRegra(nome: string, alt: Alteracao): string | null {
  const regra = REGRAS.find((r) => r.nome === nome);
  if (!regra?.perguntaCliente) return null;
  return regra.perguntaCliente(alt);
}
