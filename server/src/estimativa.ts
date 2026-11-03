import { plano } from "./conversa.js";
import type { Alteracao } from "./schema.js";

/**
 * Estimativa de esforço por alteração — POR REGRA, sem IA, e sempre uma ESTIMATIVA:
 * serve para a analista ter ideia do tamanho do briefing, não para virar prazo.
 * A analista pode trocar o nível de qualquer card; o que ela escolhe vale mais.
 *
 * Os níveis e as horas são da equipe: 1=1h, 2=2h, 3=3h, 4=6h, 5=10h.
 */

export const HORAS_POR_NIVEL: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 6, 5: 10 };

export type Estimativa = {
  nivel: number;
  horas: number;
  /** de onde o nível veio, em linguagem de gente: "Trocar telefone/e-mail/texto" */
  motivos: string[];
  /** true quando a analista escolheu o nível (a regra só sugeriu outro) */
  manual: boolean;
};

type Grupo = { nivel: number; rotulo: string; re: RegExp };

// do mais pesado ao mais leve; vale o MAIOR nível que aparecer no texto
const GRUPOS: Grupo[] = [
  {
    nivel: 5,
    rotulo: "Funcionalidade nova ou mudança estrutural",
    re: /\b(carrinho|e-?commerce|loja virtual|login|area restrita|area do cliente|integrac\w+|api|sistema|multi-?idioma|traduc\w+|migrac\w+|redesign|novo layout|layout novo|refazer o site|painel)\b/,
  },
  {
    nivel: 4,
    rotulo: "Página, seção ou formulário novo",
    re: /\b(pagina nova|nova pagina|criar (?:uma )?pagina|nova secao|secao nova|criar (?:uma )?secao|formulario novo|novo formulario|criar (?:um )?formulario|blog|landing|slider novo|novo slider|galeria nova|nova galeria)\b/,
  },
  {
    nivel: 3,
    rotulo: "Menu, categoria, produto ou formulário",
    re: /\b(menu|submenu|categorias?|subcategorias?|formularios?|reorganiz\w+|reordenar|especificacoes? tecnicas?)\b|\b(?:adicion\w+|cadastr\w+|inclu\w+|nov[oa]s?)\s+(?:\w+\s+){0,3}(?:produtos?|catalogo)\b/,
  },
  {
    nivel: 2,
    rotulo: "Imagens, banners, cores, fontes ou ícones",
    re: /\b(imagens?|fotos?|banners?|slides?|galeria|logo(?:tipo|marca)?|favicon|cor|cores|fontes?|tipografia|icones?|videos?|mapa)\b/,
  },
  {
    nivel: 1,
    rotulo: "Trocar telefone, e-mail, endereço, link ou texto",
    re: /\b(telefones?|e-?mails?|endereco|horarios?|whatsapp|links?|textos?|titulos?|subtitulos?|descricao|paragrafos?|frases?|slogan|medidas?|altura|largura|espessura|numero)\b/,
  },
];

const QUANTIDADE = /\b(\d{1,3})\s+(?:novas?\s+|novos?\s+)?(imagens|fotos|banners|produtos|paginas|categorias|itens|icones|videos|slides|textos|links)\b/g;
const TODAS = /\b(todas as|todos os|todas|todos)\b/;

/** Nível pela regra (sem olhar o que a analista escolheu). */
export function estimarPorRegra(alt: Pick<Alteracao, "solicitacao" | "secao" | "url_pagina">): Omit<Estimativa, "manual"> {
  const texto = plano(`${alt.solicitacao}\n${alt.secao}`);
  const motivos: string[] = [];

  const achado = GRUPOS.find((g) => g.re.test(texto));
  let nivel = achado?.nivel ?? 2;
  motivos.push(achado ? achado.rotulo : "Não reconheci o tipo de tarefa: nível 2 de partida, confira");

  const maior = Math.max(0, ...[...texto.matchAll(QUANTIDADE)].map((m) => Number(m[1])));
  if (maior >= 15) {
    nivel += 2;
    motivos.push(`Muitos itens (${maior})`);
  } else if (maior >= 5) {
    nivel += 1;
    motivos.push(`Vários itens (${maior})`);
  } else if (TODAS.test(texto)) {
    nivel += 1;
    motivos.push('Pede "todas/todos"');
  }

  const paginas = alt.url_pagina.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length;
  if (paginas >= 3) {
    nivel += 1;
    motivos.push(`${paginas} páginas`);
  }

  nivel = Math.min(5, Math.max(1, nivel));
  return { nivel, horas: HORAS_POR_NIVEL[nivel], motivos };
}

/** Nível final: o que a analista escolheu, se escolheu; senão o da regra. */
export function estimar(alt: Pick<Alteracao, "solicitacao" | "secao" | "url_pagina" | "nivel">): Estimativa {
  const regra = estimarPorRegra(alt);
  if (alt.nivel && HORAS_POR_NIVEL[alt.nivel]) {
    return {
      nivel: alt.nivel,
      horas: HORAS_POR_NIVEL[alt.nivel],
      motivos: [`Escolhido pela analista (a regra sugeria nível ${regra.nivel})`],
      manual: true,
    };
  }
  return { ...regra, manual: false };
}
