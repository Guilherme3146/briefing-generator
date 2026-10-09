import "./env.js"; // precisa vir antes de qualquer leitura de process.env
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";

/**
 * Configuracao e chamada de IA compartilhadas (extrator e revisor).
 *
 * Dois provedores, escolhidos por variavel de ambiente:
 *
 *   anthropic — ANTHROPIC_API_KEY (pago por uso)
 *   gemini    — GEMINI_API_KEY (tem faixa gratuita no Google AI Studio)
 *
 * IA_PROVEDOR forca um deles; sem ele, vale o que tiver chave (anthropic ganha
 * se as duas existirem). O resto do app so conhece `gerarEstruturado`.
 */

export type Provedor = "anthropic" | "gemini";

export function provedor(): Provedor | null {
  if (process.env.IA_ATIVA === "false") return null;
  const temAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const temGemini = Boolean(process.env.GEMINI_API_KEY);
  const forcado = process.env.IA_PROVEDOR;
  if (forcado === "gemini") return temGemini ? "gemini" : null;
  if (forcado === "anthropic") return temAnthropic ? "anthropic" : null;
  if (temAnthropic) return "anthropic";
  if (temGemini) return "gemini";
  return null;
}

export function iaAtiva(): boolean {
  return provedor() !== null;
}

const MODELO_ANTHROPIC = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
// "-latest" e um alias que o Google mantem apontando para o Flash atual; nomes
// fixos (ex.: gemini-2.5-flash) sao aposentados e passam a dar 404 em conta nova.
const MODELO_GEMINI = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

/** Nome do modelo do provedor ativo (ou do padrao da Anthropic se nenhum). */
export const MODELO = provedor() === "gemini" ? MODELO_GEMINI : MODELO_ANTHROPIC;

/** Extracao e revisao estruturadas nao precisam de "high". So vale p/ Anthropic. */
export const ESFORCO = (process.env.ANTHROPIC_EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high";

let cliente: Anthropic | null = null;

/** Criado sob demanda: importar este modulo sem chave nao estoura. */
export function getCliente(): Anthropic {
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

export type Uso = {
  entrada: number;
  saida: number;
  cache_lido: number;
  cache_escrito: number;
  modelo: string;
};

export const USO_ZERO: Uso = {
  entrada: 0,
  saida: 0,
  cache_lido: 0,
  cache_escrito: 0,
  modelo: MODELO,
};

export function somarUso(a: Uso, b: Uso): Uso {
  return {
    entrada: a.entrada + b.entrada,
    saida: a.saida + b.saida,
    cache_lido: a.cache_lido + b.cache_lido,
    cache_escrito: a.cache_escrito + b.cache_escrito,
    modelo: b.modelo || a.modelo,
  };
}

/** Normaliza o `usage` da resposta para o nosso formato. */
export function usoDaResposta(resposta: {
  model: string;
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}): Uso {
  const u = resposta.usage;
  return {
    entrada: u.input_tokens ?? 0,
    saida: u.output_tokens ?? 0,
    cache_lido: u.cache_read_input_tokens ?? 0,
    cache_escrito: u.cache_creation_input_tokens ?? 0,
    modelo: resposta.model,
  };
}

// ------------------------------------------------------------ chamada unificada

export type PedidoEstruturado<T> = {
  /** prompt de sistema (estavel; na Anthropic vai no prefixo cacheavel) */
  sistema: string;
  /** o conteudo do usuario */
  usuario: string;
  /** schema Zod da saida; a validacao final e sempre nossa */
  schema: z.ZodType<T>;
  maxTokens: number;
};

/**
 * Pede ao provedor ativo uma saida que case com o schema e devolve ja validada.
 * Lanca Error com mensagem legivel para o analista — as rotas repassam como esta.
 */
export async function gerarEstruturado<T>(
  p: PedidoEstruturado<T>,
): Promise<{ dados: T; uso: Uso }> {
  const qual = provedor();
  if (qual === "gemini") return viaGemini(p);
  if (qual === "anthropic") return viaAnthropic(p);
  throw new Error("A IA está desligada.");
}

async function viaAnthropic<T>(p: PedidoEstruturado<T>): Promise<{ dados: T; uso: Uso }> {
  const resposta = await getCliente().messages.parse({
    model: MODELO_ANTHROPIC,
    max_tokens: p.maxTokens,
    // o prompt de sistema e estavel -> fica no prefixo cacheavel.
    // confira usage.cache_read_input_tokens para saber se o cache pegou.
    system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
    output_config: {
      // o helper do SDK tipa o schema de forma mais estreita que o nosso generico
      format: zodOutputFormat(p.schema as never),
      effort: ESFORCO,
    },
    messages: [{ role: "user", content: p.usuario }],
  });

  if (resposta.stop_reason === "refusal") {
    throw new Error(
      "O modelo recusou processar este texto. Confira se há algo fora do comum no conteúdo.",
    );
  }
  if (!resposta.parsed_output) {
    throw new Error(
      "A IA não devolveu uma resposta no formato esperado. Tente de novo; se repetir, preencha à mão.",
    );
  }
  return { dados: resposta.parsed_output as T, uso: usoDaResposta(resposta) };
}

// ---------------------------------------------------------------------- Gemini

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** O Gemini aceita um subconjunto de JSON Schema; tira o que ele estranha. */
export function schemaParaGemini(schema: z.ZodType): Record<string, unknown> {
  const limpar = (no: unknown): unknown => {
    if (Array.isArray(no)) return no.map(limpar);
    if (no && typeof no === "object") {
      const saida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(no)) {
        if (k === "$schema") continue;
        // limites de "inteiro seguro" que o Zod acrescenta a z.number().int()
        if ((k === "maximum" || k === "minimum") && Math.abs(Number(v)) >= Number.MAX_SAFE_INTEGER) {
          continue;
        }
        saida[k] = limpar(v);
      }
      return saida;
    }
    return no;
  };
  return limpar(z.toJSONSchema(schema)) as Record<string, unknown>;
}

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  error?: { message?: string; details?: unknown[] };
};

/** 503 = "alta demanda", passageiro. Tenta de novo antes de incomodar o analista. */
const TENTATIVAS_GEMINI = 3;
const ESPERA_GEMINI_MS = Number(process.env.GEMINI_ESPERA_MS ?? 3000);

async function viaGemini<T>(p: PedidoEstruturado<T>): Promise<{ dados: T; uso: Uso }> {
  const pedido: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: p.sistema }] },
      contents: [{ role: "user", parts: [{ text: p.usuario }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: schemaParaGemini(p.schema),
        maxOutputTokens: p.maxTokens,
        temperature: 0.2,
      },
    }),
  };
  const url = `${GEMINI_URL}/${encodeURIComponent(MODELO_GEMINI)}:generateContent`;

  let r = await fetch(url, pedido);
  for (let i = 1; r.status === 503 && i < TENTATIVAS_GEMINI; i++) {
    await new Promise((ok) => setTimeout(ok, ESPERA_GEMINI_MS * i));
    r = await fetch(url, pedido);
  }

  const corpo = (await r.json().catch(() => ({}))) as RespostaGemini;

  if (!r.ok) {
    if (r.status === 503) {
      throw new Error("O Gemini está sobrecarregado agora. Tente de novo em instantes.");
    }
    if (r.status === 429) {
      // a faixa gratuita tem limite por minuto (passa logo) e por DIA (só volta
      // horas depois, e é separado por modelo) — o aviso precisa distinguir
      const detalhes = JSON.stringify(corpo.error?.details ?? []);
      if (detalhes.includes("PerDay")) {
        const segundos = Number(/"retryDelay":"(\d+)s?"/.exec(detalhes)?.[1] ?? 0);
        const volta = segundos > 0 ? `, volta em cerca de ${Math.max(1, Math.round(segundos / 3600))}h` : "";
        throw new Error(
          `O limite diário gratuito do Gemini acabou para o modelo ${MODELO_GEMINI}${volta}. ` +
            "A cota é separada por modelo: troque GEMINI_MODEL no .env por outro (ex.: gemini-3.7-flash) ou espere.",
        );
      }
      throw new Error(
        "O limite gratuito do Gemini foi atingido. Espere um minuto e tente de novo.",
      );
    }
    if (r.status === 400 || r.status === 403) {
      throw new Error(
        `O Gemini recusou a chamada (${r.status}): ${corpo.error?.message ?? "confira a GEMINI_API_KEY e o modelo."}`,
      );
    }
    throw new Error(`Erro ${r.status} no Gemini: ${corpo.error?.message ?? "sem detalhes."}`);
  }

  if (corpo.promptFeedback?.blockReason) {
    throw new Error(
      `O Gemini bloqueou este texto (${corpo.promptFeedback.blockReason}). Confira se há algo fora do comum no conteúdo.`,
    );
  }

  const candidato = corpo.candidates?.[0];
  if (candidato?.finishReason === "MAX_TOKENS") {
    throw new Error("A resposta do Gemini foi cortada por tamanho. Divida o pedido em partes.");
  }
  const texto = (candidato?.content?.parts ?? []).map((x) => x.text ?? "").join("").trim();
  if (!texto) {
    throw new Error(
      "A IA não devolveu uma resposta. Tente de novo; se repetir, preencha à mão.",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    throw new Error(
      "A IA não devolveu uma resposta no formato esperado. Tente de novo; se repetir, preencha à mão.",
    );
  }
  const validado = p.schema.safeParse(json);
  if (!validado.success) {
    throw new Error(
      "A IA devolveu uma resposta fora do formato esperado. Tente de novo; se repetir, preencha à mão.",
    );
  }

  const u = corpo.usageMetadata ?? {};
  return {
    dados: validado.data,
    uso: {
      entrada: u.promptTokenCount ?? 0,
      // o raciocinio interno do Gemini 2.5 conta como saida na cobranca
      saida: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cache_lido: u.cachedContentTokenCount ?? 0,
      cache_escrito: 0,
      modelo: corpo.modelVersion ?? MODELO_GEMINI,
    },
  };
}
