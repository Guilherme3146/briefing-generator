import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gerarPlanilha } from "./xlsx.js";
import { garantirCaixasDeMarcacao } from "./caixas.js";

const MODELO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "briefing-modelo.xlsx");
const briefing = {
  cliente: "X",
  url_base: "https://x.com",
  alteracoes: [
    { ordem: 1, grupo: "", solicitacao: "Trocar banner", url_pagina: "https://x.com", secao: "home", link_conteudo: [], obs_implementacao: "", obs_producao: "", origem: "analista" as const, confirmado: true, duvidas: [] },
  ],
};

test("a planilha gerada sai só com o padrão da produção e com as caixas de marcação em H e I", async () => {
  const zip = await JSZip.loadAsync(await gerarPlanilha({ templatePath: MODELO, briefing }));
  assert.ok(zip.file("xl/featurePropertyBag/featurePropertyBag.xml"), "parte das caixas existe");
  const estilos = await zip.file("xl/styles.xml")!.async("string");
  assert.match(estilos, /xfpb:xfComplement/);
  const tipos = await zip.file("[Content_Types].xml")!.async("string");
  assert.match(tipos, /featurePropertyBag\.xml/);
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  assert.match(rels, /relationships\/FeaturePropertyBag/);
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  assert.doesNotMatch(wb, /name="Briefing"|name="Planner"/);
});

test("aplicar duas vezes não duplica nada", async () => {
  const uma = await gerarPlanilha({ templatePath: MODELO, briefing });
  const duas = await garantirCaixasDeMarcacao(uma);
  const a = await (await JSZip.loadAsync(uma)).file("xl/styles.xml")!.async("string");
  const b = await (await JSZip.loadAsync(duas)).file("xl/styles.xml")!.async("string");
  assert.equal(a, b);
  const rels = await (await JSZip.loadAsync(duas)).file("xl/_rels/workbook.xml.rels")!.async("string");
  assert.equal((rels.match(/FeaturePropertyBag"/g) ?? []).length, 1);
});
