import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { decodificarTexto, ErroDeArquivo, textoDoArquivo } from "./arquivo.js";

/**
 * .docx mínimo, de verdade (ZIP com word/document.xml válido), um parágrafo
 * por string. `quebraManual` insere um <w:br/> no meio do primeiro parágrafo,
 * pra testar quebra de linha manual (Shift+Enter) separado de fim de parágrafo.
 */
async function docxCom(paragrafos: string[], quebraManual = false): Promise<Buffer> {
  const corpo = paragrafos
    .map((p, i) => {
      if (i === 0 && quebraManual) {
        const [a, b] = p.split("|");
        return `<w:p><w:r><w:t xml:space="preserve">${a}</w:t><w:br/><w:t xml:space="preserve">${b}</w:t></w:r></w:p>`;
      }
      return `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`;
    })
    .join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${corpo}</w:body></w:document>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

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

// -------------------------------------------------------------------- DOCX

test("DOCX: lê o texto de cada parágrafo, com acentuação", async () => {
  const buffer = await docxCom(["Rebecca Marques 0:04", "Preciso trocar o logo — atenção à ação, né?"]);
  const texto = await textoDoArquivo("reuniao.docx", buffer);
  assert.match(texto, /Rebecca Marques 0:04/);
  assert.match(texto, /Preciso trocar o logo — atenção à ação, né\?/);
});

test("DOCX: fim de parágrafo e quebra manual (Shift+Enter) viram linhas separadas", async () => {
  const buffer = await docxCom(["Linha um|Linha dois (mesmo parágrafo)", "Segundo parágrafo"], true);
  const texto = await textoDoArquivo("reuniao.docx", buffer);
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(linhas, ["Linha um", "Linha dois (mesmo parágrafo)", "Segundo parágrafo"]);
});

test("DOCX corrompido (não é um ZIP válido) dá erro claro, não estoura", async () => {
  await assert.rejects(
    () => textoDoArquivo("reuniao.docx", Buffer.from("isso não é um zip")),
    (e: unknown) => e instanceof ErroDeArquivo && /corrompido/.test(e.message),
  );
});

test("DOCX sem word/document.xml (zip válido, mas não é Word) dá erro claro", async () => {
  const zip = new JSZip();
  zip.file("oi.txt", "nao e um word de verdade");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(
    () => textoDoArquivo("reuniao.docx", buffer),
    (e: unknown) => e instanceof ErroDeArquivo && /Não encontrei o conteúdo/.test(e.message),
  );
});

test("DOCX sem texto nenhum (só estrutura vazia) dá erro claro", async () => {
  const buffer = await docxCom([]);
  await assert.rejects(
    () => textoDoArquivo("reuniao.docx", buffer),
    (e: unknown) => e instanceof ErroDeArquivo && /não tem texto/.test(e.message),
  );
});

test(".doc antigo (binário, não é .docx) continua recusado com o caminho para resolver", async () => {
  // assinatura do formato OLE2 do Word 97-2003
  const bufferDocAntigo = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
  await assert.rejects(
    () => textoDoArquivo("reuniao.doc", bufferDocAntigo),
    (e: unknown) => e instanceof ErroDeArquivo && e.status === 415 && /\.docx/.test(e.message),
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
