import { test } from "node:test";
import assert from "node:assert/strict";
import { decodificarTexto, ErroDeArquivo, textoDoArquivo } from "./arquivo.js";

/** PDF mínimo, escrito à mão (sem tabela xref: o pdfjs reconstrói), com o texto dado. */
function pdfCom(linhas: string[]): Buffer {
  const fluxo = linhas.length
    ? "BT /F1 12 Tf 20 150 Td " + linhas.map((l, i) => (i ? "0 -20 Td " : "") + `(${l}) Tj`).join(" ") + " ET"
    : "";
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
      `4 0 obj<</Length ${fluxo.length}>>stream\n${fluxo}\nendstream endobj\n` +
      "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF",
    "latin1",
  );
}

const TEXTO = "Preciso trocar o logo — atenção à ação, né?";

// ------------------------------------------------------------------ codificação

test("UTF-8 comum e com BOM", () => {
  assert.equal(decodificarTexto(Buffer.from(TEXTO, "utf8")), TEXTO);
  assert.equal(decodificarTexto(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXTO, "utf8")])), TEXTO);
});

test('UTF-16 LE e BE com BOM (o "Unicode" do Bloco de Notas)', () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(TEXTO, "utf16le")]);
  assert.equal(decodificarTexto(le), TEXTO);
  const be = Buffer.from(Buffer.from(TEXTO, "utf16le")).swap16();
  assert.equal(decodificarTexto(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), TEXTO);
});

test("UTF-16 sem BOM é reconhecido pelos bytes zero alternados", () => {
  assert.equal(decodificarTexto(Buffer.from(TEXTO, "utf16le")), TEXTO);
});

test("Windows-1252 (acentos de TXT antigo) em vez de virar lixo", () => {
  const w1252 = Buffer.from([0x50, 0x72, 0x65, 0x63, 0x69, 0x73, 0x6f, 0x20, 0x61, 0xe7, 0xe3, 0x6f]); // "Preciso ação"
  assert.equal(decodificarTexto(w1252), "Preciso ação");
});

test("conteúdo binário é recusado com mensagem clara, não lido como lixo", () => {
  const binario = Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03, 0x04, 0x00, 0x05, 0x06, 0x00, 0x07]);
  assert.throws(() => decodificarTexto(binario), (e: unknown) => e instanceof ErroDeArquivo && e.status === 415);
});

// ------------------------------------------------------------- tipos de arquivo

test("DOCX: recusado pela extensão, com o caminho para resolver", async () => {
  await assert.rejects(
    () => textoDoArquivo("reuniao.docx", Buffer.from("qualquer coisa")),
    (e: unknown) => e instanceof ErroDeArquivo && e.status === 415 && /Word/.test(e.message) && /PDF ou TXT/.test(e.message),
  );
});

test("arquivo renomeado: o conteúdo (assinatura de ZIP/PNG) vale mais que a extensão .txt", async () => {
  await assert.rejects(() => textoDoArquivo("reuniao.txt", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), ErroDeArquivo);
  await assert.rejects(() => textoDoArquivo("reuniao.txt", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), ErroDeArquivo);
});

test("TXT e VTT passam pelo mesmo caminho de texto", async () => {
  assert.equal(await textoDoArquivo("a.txt", Buffer.from(TEXTO)), TEXTO);
  assert.equal(await textoDoArquivo("a.vtt", Buffer.from("WEBVTT\n\n")), "WEBVTT\n\n");
});

// ------------------------------------------------------------------------- PDF

test("PDF com texto: devolve o texto da página", async () => {
  const texto = await textoDoArquivo("conversa.pdf", pdfCom(["Maria Souza 0:04", "Preciso trocar o logo do site."]));
  assert.match(texto, /Maria Souza 0:04/);
  assert.match(texto, /Preciso trocar o logo do site/);
});

test("PDF é reconhecido pela assinatura mesmo com a extensão trocada", async () => {
  const texto = await textoDoArquivo("conversa.txt", pdfCom(["Maria Souza 0:04", "Olá"]));
  assert.match(texto, /Maria Souza 0:04/);
});

test("PDF sem texto (imagem escaneada): diz que precisa de OCR", async () => {
  await assert.rejects(
    () => textoDoArquivo("scan.pdf", pdfCom([])),
    (e: unknown) => e instanceof ErroDeArquivo && /OCR/.test(e.message),
  );
});

test("PDF corrompido: mensagem clara em vez de erro interno", async () => {
  await assert.rejects(
    () => textoDoArquivo("quebrado.pdf", Buffer.from("%PDF-1.4 isto nao e um pdf de verdade")),
    (e: unknown) => e instanceof ErroDeArquivo && /corrompido|PDF válido/.test(e.message),
  );
});
