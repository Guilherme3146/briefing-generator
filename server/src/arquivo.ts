import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Tira o texto de um arquivo enviado pelo analista: PDF (exportação do Teams),
 * TXT, VTT ou SRT. Tudo local: não chama IA nem serviço externo.
 *
 * Todo defeito previsível vira `ErroDeArquivo`, com uma mensagem que o analista
 * entende e sabe resolver; o resto é erro de programa.
 */

/** Erro que o analista pode resolver trocando o arquivo. `status` é o HTTP certo para ele. */
export class ErroDeArquivo extends Error {
  readonly status: number;
  constructor(mensagem: string, status = 422) {
    super(mensagem);
    this.name = "ErroDeArquivo";
    this.status = status;
  }
}

/** Um PDF de reunião de 90 minutos tem ~60 páginas; acima disso, quase certo que é outro documento. */
export const MAX_PAGINAS = Number(process.env.IMPORTAR_MAX_PAGINAS ?? 600);
/** O pdfjs pode não terminar num PDF malformado; melhor cortar do que deixar a tela esperando. */
export const TEMPO_MAXIMO_MS = Number(process.env.IMPORTAR_TEMPO_MAXIMO_MS ?? 60_000);

const NAO_LIDOS: Record<string, string> = {
  ".docx": "do Word (.docx)",
  ".doc": "do Word (.doc)",
  ".rtf": "RTF",
  ".odt": "ODT",
  ".xlsx": "do Excel",
  ".xls": "do Excel",
  ".png": "de imagem",
  ".jpg": "de imagem",
  ".jpeg": "de imagem",
  ".gif": "de imagem",
  ".zip": "compactados",
};

const AJUDA = 'Abra o arquivo e salve como PDF ou TXT, ou cole o texto no campo "Pedido do cliente".';

/** Reconhece pelo conteúdo o que a extensão não entrega (arquivo renomeado). */
function tipoPeloConteudo(b: Buffer): string | null {
  const ini = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  if (ini(0x50, 0x4b, 0x03, 0x04)) return "do Word, do Excel ou compactados";
  if (ini(0x7b, 0x5c, 0x72, 0x74, 0x66)) return "RTF";
  if (ini(0xd0, 0xcf, 0x11, 0xe0)) return "do Word antigo (.doc)";
  if (ini(0x89, 0x50, 0x4e, 0x47) || ini(0xff, 0xd8, 0xff) || ini(0x47, 0x49, 0x46, 0x38)) return "de imagem";
  return null;
}

export async function textoDoArquivo(nome: string, buffer: Buffer): Promise<string> {
  const extensao = path.extname(nome).toLowerCase();
  const ehPdf = buffer.subarray(0, 5).toString("latin1") === "%PDF-" || extensao === ".pdf";
  if (ehPdf) return lerPdf(buffer);

  const pelaExtensao = NAO_LIDOS[extensao];
  const pelaAssinatura = tipoPeloConteudo(buffer);
  const naoLido = pelaExtensao ?? pelaAssinatura;
  if (naoLido) {
    throw new ErroDeArquivo(`Ainda não leio arquivos ${naoLido}. ${AJUDA}`, 415);
  }
  return decodificarTexto(buffer);
}

/**
 * UTF-8 (com ou sem BOM), UTF-16 (o "Unicode" do Bloco de Notas) e Windows-1252
 * (acentos de TXT antigo). Texto binário é recusado em vez de virar lixo.
 */
export function decodificarTexto(buffer: Buffer): string {
  const b = buffer;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString("utf8");
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));

  // UTF-16 sem BOM: letras latinas deixam um byte zero a cada dois
  const amostra = b.subarray(0, Math.min(b.length, 400));
  let zerosPares = 0;
  let zerosImpares = 0;
  for (let i = 0; i < amostra.length; i++) {
    if (amostra[i] === 0) {
      if (i % 2) zerosImpares++;
      else zerosPares++;
    }
  }
  if (amostra.length >= 8) {
    if (zerosImpares > amostra.length * 0.25 && zerosPares < amostra.length * 0.05) return new TextDecoder("utf-16le").decode(b);
    if (zerosPares > amostra.length * 0.25 && zerosImpares < amostra.length * 0.05) return new TextDecoder("utf-16be").decode(b);
  }
  if (amostra.includes(0)) {
    throw new ErroDeArquivo(`Este arquivo não parece ser texto. ${AJUDA}`, 415);
  }

  const utf8 = b.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1252").decode(b);
}

async function lerPdf(buffer: Buffer): Promise<string> {
  const carregamento = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });

  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeita) => {
    temporizador = setTimeout(
      () =>
        rejeita(
          new ErroDeArquivo(
            `A leitura do PDF demorou mais de ${Math.round(TEMPO_MAXIMO_MS / 1000)} segundos e foi interrompida. ` +
              "Tente salvar o PDF de novo ou exportar a conversa como TXT.",
          ),
        ),
      TEMPO_MAXIMO_MS,
    );
  });

  try {
    return await Promise.race([textoDoPdf(carregamento), limite]);
  } catch (e) {
    throw traduzirErroDePdf(e);
  } finally {
    clearTimeout(temporizador);
    await carregamento.destroy().catch(() => undefined);
  }
}

async function textoDoPdf(carregamento: ReturnType<typeof getDocument>): Promise<string> {
  const doc = await carregamento.promise;
  if (doc.numPages > MAX_PAGINAS) {
    throw new ErroDeArquivo(
      `O PDF tem ${doc.numPages} páginas; o limite é ${MAX_PAGINAS}. Confira se é a transcrição da reunião.`,
    );
  }

  let saida = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const conteudo = await pagina.getTextContent();
    for (const item of conteudo.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== "string") continue;
      saida += item.str + (item.hasEOL ? "\n" : "");
    }
    // a quebra de página cai no meio da fala: só uma quebra de linha, sem marcador
    if (!saida.endsWith("\n")) saida += "\n";
  }

  // escaneado = quase nenhuma letra por página (um número de página solto não conta como texto)
  if (saida.replace(/\s+/g, "").length < 10 * doc.numPages) {
    throw new ErroDeArquivo(
      "Este PDF não tem texto selecionável (parece ser uma imagem escaneada). " +
        "Ele precisa passar por OCR antes de ser importado.",
    );
  }
  return saida;
}

function traduzirErroDePdf(e: unknown): Error {
  if (e instanceof ErroDeArquivo) return e;
  const nome = (e as { name?: string } | null)?.name ?? "";
  if (nome === "PasswordException") {
    return new ErroDeArquivo("Este PDF está protegido por senha. Salve uma cópia sem senha e envie de novo.");
  }
  if (nome === "InvalidPDFException" || nome === "FormatError" || nome === "MissingPDFException") {
    return new ErroDeArquivo("O arquivo está corrompido ou não é um PDF válido. Abra-o no leitor de PDF para conferir.");
  }
  return e instanceof Error ? e : new Error(String(e));
}
