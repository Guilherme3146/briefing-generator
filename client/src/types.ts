export type Origem = "analista" | "ia" | "ia_editada" | "regra" | "regra_editada";

/** Um trecho da conversa que originou uma tarefa. `inicio` vale no texto do pedido. */
export type FonteTrecho = { quem: string; tempo: string; trecho: string; inicio: number };

/** De onde veio um card criado pela leitura da conversa (não vai para a planilha). */
export type FonteAlteracao = {
  confianca: "alta" | "media" | "manual";
  motivo: string;
  itens: FonteTrecho[];
};

export type Alteracao = {
  ordem: number;
  grupo: string;
  solicitacao: string;
  url_pagina: string;
  secao: string;
  link_conteudo: string[];
  obs_implementacao: string;
  obs_producao: string;

  // metadados — nao vao para a planilha
  origem: Origem;
  /** card vindo da IA nasce false e bloqueia a geracao ate ser confirmado */
  confirmado: boolean;
  duvidas: string[];
  /** só nos cards vindos da conversa: o trecho original, para conferir */
  fonte?: FonteAlteracao;
};

export type Briefing = {
  cliente: string;
  url_base: string;
  alteracoes: Alteracao[];
};

export type Severidade = "erro" | "aviso";

export type Achado = {
  ordem: number;
  regra: string;
  faq: string;
  severidade: Severidade;
  mensagem: string;
};

export type Uso = {
  entrada: number;
  saida: number;
  cache_lido: number;
  cache_escrito: number;
  modelo: string;
};

/** De onde veio o pedido. Muda o prompt e o que a IA pode tratar como final. */
export type OrigemPedido = "mensagem" | "reuniao";

export type RespostaSugestao = {
  alteracoes: Alteracao[];
  trechos_ignorados: string[];
  /** só na origem "reuniao": decisões tomadas e depois desfeitas na conversa */
  decisoes_revertidas: string[];
  origem: OrigemPedido;
  uso: Uso;
};

export function novaAlteracao(ordem: number, url_base = ""): Alteracao {
  return {
    ordem,
    grupo: "",
    solicitacao: "",
    url_pagina: url_base,
    secao: "",
    link_conteudo: [],
    obs_implementacao: "",
    obs_producao: "",
    origem: "analista",
    confirmado: true,
    duvidas: [],
  };
}

export type Veredito = {
  ordem: number;
  executavel: boolean;
  /** uma frase para o analista; vazio quando executavel */
  motivo: string;
  /** a pergunta a mandar ao cliente; vazio quando executavel */
  pergunta: string;
};

export type RespostaRevisao = {
  vereditos: Veredito[];
  uso: Uso;
  faltantes: number[];
};

export type ItemPergunta = {
  ordem: number;
  origem: "revisor" | "duvida" | "regra";
  texto: string;
  regra?: string;
};

export type RespostaPerguntas = {
  itens: ItemPergunta[];
  texto: string;
};

export type LinhaExistente = {
  linha: number;
  solicitacao: string;
  url_pagina: string;
  secao: string;
  val_producao: string;
};

export type Duplicada = {
  ordem: number;
  linha: number;
  solicitacao: string;
};

export type Inspecao = {
  jaExistiam: number;
  primeiraLinhaLivre: number;
  capacidadeRestante: number;
  /** linhas que a produção já começou (G diferente de "Aguardando") */
  emExecucao: number;
  existentes: LinhaExistente[];
  duplicadas: Duplicada[];
};

/**
 * Identidade do que o revisor julga.
 *
 * O cache da revisao e por conteudo, nao por ordem: reordenar os cards nao
 * descarta o veredito, e editar um card descarta so o dele. E isso que evita
 * pagar de novo pelo que nao mudou.
 */
export function hashRevisao(a: Alteracao): string {
  const base = [
    a.solicitacao.trim(),
    a.url_pagina.trim(),
    a.secao.trim(),
    a.link_conteudo.filter(Boolean).length,
    a.obs_implementacao.trim(),
  ].join(" | ");

  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function temConteudo(a: Alteracao): boolean {
  return Boolean(a.solicitacao.trim() || a.secao.trim() || a.link_conteudo.join("").trim());
}

export type Aba = "pedido" | "alteracoes" | "conferencia" | "planilha" | "ia";

/** Como uma alteração aparece na lista: um estado só, o mais urgente. */
export type Situacao = "ok" | "aviso" | "erro" | "rascunho" | "trava";

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  ok: "Pronta",
  aviso: "Tem avisos",
  erro: "Tem pendência",
  rascunho: "Rascunho da IA — confirmar",
  trava: "A produção vai travar",
};

export function situacaoDe(a: Alteracao, achados: Achado[], veredito?: Veredito): Situacao {
  if (!a.confirmado) return "rascunho";
  if (achados.some((x) => x.severidade === "erro")) return "erro";
  if (veredito && !veredito.executavel) return "trava";
  if (achados.length > 0) return "aviso";
  return "ok";
}

// ---------------------------------------------------------------- conversa

export type TarefaConversa = {
  solicitacao: string;
  assunto: string;
  confianca: "alta" | "media";
  motivo: string;
  fontes: FonteTrecho[];
  duvidas: string[];
};

export type MotivoDescarte = "ja_resolvido" | "pergunta" | "sem_objeto" | "sugestao_sem_acordo" | "processo";

export type DescartadoConversa = {
  motivo: MotivoDescarte;
  detalhe: string;
  quem: string;
  tempo: string;
  trecho: string;
  inicio: number;
};

export type FalanteConversa = { nome: string; turnos: number; palavras: number; papel: "cliente" | "equipe" };

export type Importacao = {
  arquivo: string;
  texto: string;
  formato: "teams" | "vtt" | "texto";
  falantes: FalanteConversa[];
  tarefas: TarefaConversa[];
  descartados: DescartadoConversa[];
  alertas: string[];
  resumo: { turnos: number; frases: number; ruido: number };
};

export const ROTULO_DESCARTE: Record<MotivoDescarte, { titulo: string; ajuda: string }> = {
  sem_objeto: {
    titulo: "Parece pedido, mas não diz sobre o quê",
    ajuda: "Tem verbo de ação, porém o elemento do site não aparece na frase. Costuma depender do que foi dito antes.",
  },
  sugestao_sem_acordo: {
    titulo: "Sugestão da equipe sem o cliente concordar",
    ajuda: "A equipe propôs algo e não achei o cliente aceitando em seguida.",
  },
  pergunta: { titulo: "Perguntas do cliente", ajuda: "Perguntas que não pedem uma mudança no site." },
  ja_resolvido: { titulo: "Já resolvido", ajuda: "Alguém disse que isso já está feito. Confira se não ficou nada pendente." },
  processo: { titulo: "Bastidores da reunião", ajuda: "Conversa sobre como a reunião ou o trabalho acontece." },
};