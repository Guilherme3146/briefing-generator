import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gerarEstruturado, type ChaveCliente, type Uso } from "./anthropic.js";
import {
  AlteracaoSchema,
  SugestaoReuniaoSchema,
  SugestaoSchema,
  type Alteracao,
  type OrigemPedido,
  type Sugestao,
  type SugestaoReuniao,
} from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Camada de IA — extracao.
 *
 * Faz UMA coisa: separar o texto do cliente em alteracoes. Nao calcula status,
 * nao valida lacuna (isso e o lint, deterministico), nao escolhe imagem.
 *
 * Tudo que sai daqui chega na tela como RASCUNHO, com confirmado=false, e
 * bloqueia a geracao ate o analista confirmar card a card.
 *
 * Duas origens, dois prompts:
 *
 *   mensagem — o cliente escreveu. O que ele digitou entre aspas pode ir direto
 *              para o site.
 *   reuniao  — transcricao automatica. NADA pode ir direto para o site: a
 *              maquina chuta as palavras e erra justo em nome proprio, URL,
 *              telefone e codigo de cor. Alem disso o assunto volta na conversa,
 *              entao decisao revertida precisa ser rastreada.
 */

const PROMPTS: Record<OrigemPedido, string> = {
  mensagem: ler("extrator.md"),
  reuniao: ler("extrator-reuniao.md"),
};

function ler(arquivo: string): string {
  return fs.readFileSync(path.join(__dirname, "prompts", arquivo), "utf8");
}

/** Compatibilidade: o prompt de mensagem continua exportado com o nome antigo. */
export const PROMPT_SISTEMA = PROMPTS.mensagem;
export const PROMPT_REUNIAO = PROMPTS.reuniao;

/**
 * Limite de entrada por origem.
 *
 * Mensagem: evita colar um PDF inteiro por acidente.
 * Reuniao: fala rende ~45-50 mil caracteres por hora, entao 60 mil cortaria uma
 * reuniao de 90 minutos no meio. 150 mil cobre com folga.
 */
export const MAX_CARACTERES: Record<OrigemPedido, number> = {
  mensagem: Number(process.env.MAX_CARACTERES_PEDIDO ?? 60_000),
  reuniao: Number(process.env.MAX_CARACTERES_REUNIAO ?? 150_000),
};

export type ResultadoSugestao = {
  alteracoes: Alteracao[];
  trechos_ignorados: string[];
  /** so na origem "reuniao"; vazio em mensagem */
  decisoes_revertidas: string[];
  origem: OrigemPedido;
  uso: Uso;
};

export async function sugerir(
  textoDoCliente: string,
  origem: OrigemPedido = "mensagem",
  chaveCliente?: ChaveCliente,
): Promise<ResultadoSugestao> {
  const texto = textoDoCliente.trim();
  const limite = MAX_CARACTERES[origem];

  if (!texto) {
    throw new Error(
      origem === "reuniao" ? "A transcrição está vazia." : "O pedido do cliente está vazio.",
    );
  }
  if (texto.length > limite) {
    throw new Error(
      `O texto tem ${texto.length.toLocaleString("pt-BR")} caracteres e o limite para ` +
        `${origem === "reuniao" ? "transcrição" : "mensagem"} é ` +
        `${limite.toLocaleString("pt-BR")}. Divida em partes.`,
    );
  }

  const esquema = origem === "reuniao" ? SugestaoReuniaoSchema : SugestaoSchema;

  const { dados: bruto, uso } = await gerarEstruturado<Sugestao | SugestaoReuniao>(
    {
      sistema: PROMPTS[origem],
      usuario: texto,
      schema: esquema,
      maxTokens: 16000,
    },
    chaveCliente,
  );

  return {
    alteracoes: paraAlteracoes(bruto),
    trechos_ignorados: limpar(bruto.trechos_ignorados),
    decisoes_revertidas: limpar(
      (bruto as SugestaoReuniao).decisoes_revertidas ?? [],
    ),
    origem,
    uso,
  };
}

/**
 * Converte a saida da IA em cards do app.
 *
 * Renumera a ordem (o modelo as vezes pula numero) e marca TUDO como nao
 * confirmado — e esse campo que trava o botao de gerar.
 */
export function paraAlteracoes(sugestao: {
  alteracoes: Sugestao["alteracoes"];
}): Alteracao[] {
  return [...sugestao.alteracoes]
    .sort((a, b) => a.ordem - b.ordem)
    .map((s, i) =>
      AlteracaoSchema.parse({
        ...s,
        ordem: i + 1,
        link_conteudo: limpar(s.link_conteudo),
        duvidas: limpar(s.duvidas),
        origem: "ia",
        confirmado: false,
      }),
    );
}

function limpar(lista: string[]): string[] {
  return lista.map((t) => t.trim()).filter(Boolean);
}
