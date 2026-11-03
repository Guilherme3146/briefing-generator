import { z } from "zod/v4";

/**
 * O schema espelha 1:1 as colunas A-F da aba "Alteração" do template.
 * As colunas G (Val. Produção), H (Val. Implementação) e I (Val. Design)
 * NAO sao preenchidas por este app — pertencem a quem executa a tarefa.
 */
export const AlteracaoSchema = z.object({
  ordem: z.number().int().min(1),
  /** bloco de alteracoes relacionadas; vira marcador de texto na coluna A */
  grupo: z.string().default(""),
  /** coluna A — Alteração / Solicitação */
  solicitacao: z.string().default(""),
  /** coluna B — URL Página */
  url_pagina: z.string().default(""),
  /** coluna C — Seção (multi-linha: "home\nbanner" ou "produtos > adesivo") */
  secao: z.string().default(""),
  /** coluna D — Link Conteúdo (um por linha na celula) */
  link_conteudo: z.array(z.string()).default([]),
  /** coluna E — Obs. Implementação (texto; os prints vao na mesma celula) */
  obs_implementacao: z.string().default(""),
  /** coluna F — Obs. Produção */
  obs_producao: z.string().default(""),

  // --- metadados: NAO vao para a planilha ---

  /** de onde veio o card. "analista" e o padrao (Fase 1, preenchimento manual) */
  origem: z.enum(["analista", "ia", "ia_editada", "regra", "regra_editada"]).default("analista"),
  /**
   * Mecanismo da decisao D1 ("a IA so sugere, voce confirma cada campo").
   * Card vindo da IA nasce false e BLOQUEIA a geracao ate o analista confirmar.
   * Card criado a mao nasce true — nao ha o que confirmar.
   */
  confirmado: z.boolean().default(true),
  /** perguntas que a IA nao soube responder; viram aviso no card */
  duvidas: z.array(z.string()).default([]),
});

export const BriefingSchema = z.object({
  cliente: z.string().default(""),
  url_base: z.string().default(""),
  alteracoes: z.array(AlteracaoSchema),
});

export type Alteracao = z.infer<typeof AlteracaoSchema>;
export type Briefing = z.infer<typeof BriefingSchema>;

/**
 * O que a IA devolve. E DELIBERADAMENTE diferente de AlteracaoSchema:
 * - sem "ordem" automatica de confianca, sem metadados de UI;
 * - "trechos_ignorados" no topo e a rede de seguranca contra pedido sumido.
 * Converter IA -> Alteracao e trabalho nosso, nao do modelo.
 */
export const AlteracaoSugeridaSchema = z.object({
  ordem: z.number().int().min(1),
  grupo: z.string(),
  solicitacao: z.string(),
  url_pagina: z.string(),
  secao: z.string(),
  link_conteudo: z.array(z.string()),
  obs_implementacao: z.string(),
  obs_producao: z.string(),
  duvidas: z.array(z.string()),
});

export const SugestaoSchema = z.object({
  alteracoes: z.array(AlteracaoSugeridaSchema),
  trechos_ignorados: z.array(z.string()),
});

export type Sugestao = z.infer<typeof SugestaoSchema>;

/**
 * De onde veio o pedido. Muda o prompt, o limite de tamanho e o que a IA pode
 * tratar como texto final.
 */
export const OrigemPedidoSchema = z.enum(["mensagem", "reuniao"]);
export type OrigemPedido = z.infer<typeof OrigemPedidoSchema>;

/**
 * Fase 5 — transcricao de reuniao.
 *
 * Mesma saida da mensagem, mais "decisoes_revertidas": numa reuniao o assunto
 * volta, e uma decisao tomada aos 10 minutos pode ser desfeita aos 40. Sem esse
 * campo nao da para saber se o modelo acompanhou a conversa ou se simplesmente
 * nao viu a reversao.
 */
export const SugestaoReuniaoSchema = z.object({
  alteracoes: z.array(AlteracaoSugeridaSchema),
  trechos_ignorados: z.array(z.string()),
  decisoes_revertidas: z.array(z.string()),
});

export type SugestaoReuniao = z.infer<typeof SugestaoReuniaoSchema>;

/**
 * Fase 3 — o revisor semantico.
 *
 * Responde uma pergunta so: "um dev que nunca falou com o cliente conseguiria
 * executar isto sozinho?". E o unico lugar onde a IA paga o proprio custo,
 * porque a lacuna que ele pega — referencia que nao se resolve — passa limpo
 * por toda regra estrutural.
 */
export const VereditoSchema = z.object({
  ordem: z.number().int().min(1),
  executavel: z.boolean(),
  /** uma frase para o analista; vazio quando executavel */
  motivo: z.string(),
  /** a pergunta a mandar AO CLIENTE; vazio quando executavel */
  pergunta: z.string(),
});

export const RevisaoSchema = z.object({
  vereditos: z.array(VereditoSchema),
});

export type Veredito = z.infer<typeof VereditoSchema>;
export type Revisao = z.infer<typeof RevisaoSchema>;

/** A formula de progresso em A1 cobre A3:A98 — logo, 96 linhas de dados. */
export const PRIMEIRA_LINHA_DADOS = 3;
export const ULTIMA_LINHA_DADOS = 98;
export const MAX_ALTERACOES = ULTIMA_LINHA_DADOS - PRIMEIRA_LINHA_DADOS + 1;
