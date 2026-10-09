import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import {
  ABA_ALTERACAO,
  abaAlteracao,
  abrir,
  acrescentarAlteracoes,
  gerarPlanilha,
  linhasOcupadas,
  possiveisDuplicadas,
  primeiraLinhaLivre,
  textoDaCelula,
} from "./xlsx.js";
import { BriefingSchema, type Briefing } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "..", "..", "templates", "briefing-modelo.xlsx");

function briefing(solicitacoes: string[]): Briefing {
  return BriefingSchema.parse({
    cliente: "Cliente Exemplo",
    url_base: "https://exemplo.com.br/",
    alteracoes: solicitacoes.map((s, i) => ({
      ordem: i + 1,
      solicitacao: s,
      url_pagina: "https://exemplo.com.br/",
      secao: "home",
    })),
  });
}

/** Planilha "em execução": 3 alterações, a primeira já finalizada pela produção. */
async function planilhaEmExecucao(): Promise<Buffer> {
  const inicial = await gerarPlanilha({
    templatePath: TEMPLATE,
    briefing: briefing(["trocar o banner", "remover o rodapé antigo", "ajustar o menu"]),
  });
  const wb = await abrir(inicial);
  const ws = abaAlteracao(wb);
  ws.getCell("G3").value = "Finalizado";
  ws.getCell("H3").value = true;
  ws.getCell("F4").value = "não dá no modelo mpi plus";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// --------------------------------------------------------------- onde escreve

test("acrescenta depois da última linha ocupada", async () => {
  const r = await acrescentarAlteracoes({
    arquivo: await planilhaEmExecucao(),
    briefing: briefing(["incluir a seção de parceiros", "trocar o telefone do rodapé"]),
  });
  assert.equal(r.jaExistiam, 3);
  assert.equal(r.primeiraLinha, 6);
  assert.equal(r.ultimaLinha, 7);

  const ws = abaAlteracao(await abrir(r.arquivo));
  assert.match(textoDaCelula(ws.getCell("A6").value), /parceiros/);
  assert.match(textoDaCelula(ws.getCell("A7").value), /telefone/);
});

test("buraco no meio não é preenchido — a produção executa de cima para baixo", async () => {
  const wb = await abrir(await planilhaEmExecucao());
  const ws = abaAlteracao(wb);
  ws.getCell("A4").value = null; // alguém apagou a do meio
  const comBuraco = Buffer.from(await wb.xlsx.writeBuffer());

  const wsBuraco = abaAlteracao(await abrir(comBuraco));
  assert.equal(primeiraLinhaLivre(wsBuraco), 6, "deve ir depois da última, não para a 4");

  const r = await acrescentarAlteracoes({
    arquivo: comBuraco,
    briefing: briefing(["nova alteração"]),
  });
  assert.equal(r.primeiraLinha, 6);
  const depois = abaAlteracao(await abrir(r.arquivo));
  assert.equal(textoDaCelula(depois.getCell("A4").value), "", "a linha 4 continua vazia");
});

// ------------------------------------------------------------- o que preserva

test("não encosta nas linhas que já existiam", async () => {
  const antes = await planilhaEmExecucao();
  const wsAntes = abaAlteracao(await abrir(antes));
  const original = linhasOcupadas(wsAntes);

  const r = await acrescentarAlteracoes({
    arquivo: antes,
    briefing: briefing(["nova alteração"]),
  });
  const wsDepois = abaAlteracao(await abrir(r.arquivo));

  for (const linha of original) {
    const atual = textoDaCelula(wsDepois.getCell(linha.linha, 1).value);
    assert.equal(atual, linha.solicitacao, `linha ${linha.linha} foi alterada`);
  }
});

test("preserva o estado de execução em G, H e I", async () => {
  const r = await acrescentarAlteracoes({
    arquivo: await planilhaEmExecucao(),
    briefing: briefing(["nova alteração"]),
  });
  const ws = abaAlteracao(await abrir(r.arquivo));
  assert.equal(ws.getCell("G3").value, "Finalizado");
  assert.equal(ws.getCell("H3").value, true);
  assert.equal(textoDaCelula(ws.getCell("F4").value), "não dá no modelo mpi plus");
  // a linha nova entra no estado inicial, nao "pronta"
  assert.equal(ws.getCell("G6").value, "Aguardando");
});

test("preserva abas, fórmula de progresso e os prints do template", async () => {
  const r = await acrescentarAlteracoes({
    arquivo: await planilhaEmExecucao(),
    briefing: briefing(["nova alteração"]),
  });
  const wb = await abrir(r.arquivo);
  assert.deepEqual(wb.worksheets.map((w) => w.name), [
    "Site",
    ABA_ALTERACAO,
    "Complemento de Mockup",
    "Prints",
    "FAQ",
  ]);
  const a1: any = abaAlteracao(wb).getCell("A1").value;
  assert.ok(a1?.formula, "a fórmula de progresso tem que sobreviver");
  assert.equal(wb.getWorksheet("Prints")!.getImages().length, 3);
  assert.equal(wb.getWorksheet("FAQ")!.rowCount, 52);
});

test("print novo entra ancorado na linha certa, sem derrubar os que já estavam", async () => {
  const base = await planilhaEmExecucao();
  const wb0 = await abrir(base);
  const ws0 = abaAlteracao(wb0);
  const id = wb0.addImage({ buffer: Buffer.from(PNG_1PX, "base64") as any, extension: "png" });
  ws0.addImage(id, { tl: { col: 4, row: 2 } as any, ext: { width: 100, height: 50 } });
  const comPrint = Buffer.from(await wb0.xlsx.writeBuffer());

  const r = await acrescentarAlteracoes({
    arquivo: comPrint,
    briefing: briefing(["alteração com print"]),
    prints: [{ ordem: 1, buffer: Buffer.from(PNG_1PX, "base64"), extensao: "png" }],
  });

  const ws = abaAlteracao(await abrir(r.arquivo));
  const imgs = ws.getImages();
  assert.equal(imgs.length, 2, "o print antigo continua lá");
  assert.ok(
    imgs.some((i) => i.range.tl.nativeRow + 1 === 6 && i.range.tl.nativeCol === 4),
    "o print novo fica na coluna E da linha 6",
  );
});

// ------------------------------------------------------------------- travas

test("recusa quando não cabe", async () => {
  const cheia = await gerarPlanilha({
    templatePath: TEMPLATE,
    briefing: briefing(Array.from({ length: 94 }, (_, i) => `alteração ${i + 1}`)),
  });
  await assert.rejects(
    () => acrescentarAlteracoes({ arquivo: cheia, briefing: briefing(["a", "b", "c", "d"]) }),
    /cabem mais 2|limite é a linha 98/,
  );
});

test("recusa briefing vazio", async () => {
  const arquivo = await planilhaEmExecucao();
  await assert.rejects(
    () =>
      acrescentarAlteracoes({
        arquivo,
        briefing: BriefingSchema.parse({ cliente: "", url_base: "", alteracoes: [] }),
      }),
    /Nenhuma alteração/,
  );
});

test("recusa arquivo que não é um briefing da casa", async () => {
  const outro = new ExcelJS.Workbook();
  outro.addWorksheet("Planilha1");
  const buf = Buffer.from(await outro.xlsx.writeBuffer());
  await assert.rejects(
    () => acrescentarAlteracoes({ arquivo: buf, briefing: briefing(["x"]) }),
    /não tem a aba/,
  );
});

// -------------------------------------------------------------- duplicadas

test("avisa quando a alteração já parece estar na planilha", async () => {
  const ws = abaAlteracao(await abrir(await planilhaEmExecucao()));
  const existentes = linhasOcupadas(ws);
  const d = possiveisDuplicadas(
    existentes,
    briefing(["TROCAR O BANNER", "alteração inédita"]).alteracoes,
  );
  assert.equal(d.length, 1);
  assert.equal(d[0].linha, 3);
  assert.equal(d[0].ordem, 1);
});

test("a comparação ignora os marcadores de grupo que o gerador acrescenta", async () => {
  const inicial = await gerarPlanilha({
    templatePath: TEMPLATE,
    briefing: BriefingSchema.parse({
      cliente: "X",
      url_base: "",
      alteracoes: [
        {
          ordem: 1,
          solicitacao: "substituir as imagens de acrílico",
          url_pagina: "https://x.com.br/produtos",
          grupo: "mudanças na página de produtos",
        },
      ],
    }),
  });
  const ws = abaAlteracao(await abrir(inicial));
  const d = possiveisDuplicadas(
    linhasOcupadas(ws),
    briefing(["substituir as imagens de acrílico"]).alteracoes,
  );
  assert.equal(d.length, 1, "o '**** início de ...' não pode esconder a duplicata");
});

/** PNG 1x1 transparente */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
