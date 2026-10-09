import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import multer from "multer";
import { ErroDeArquivo } from "./arquivo.js";
import { manipuladorDeErros, rotaApiDesconhecida } from "./erros.js";

/** Sobe um app Express de verdade, numa porta livre qualquer, e devolve a URL base. */
async function comApp(montar: (app: express.Express) => void, uso: (base: string) => Promise<void>) {
  const app = express();
  montar(app);
  const servidor = await new Promise<import("node:http").Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  try {
    await uso(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`);
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

test("arquivo acima do limite: JSON com a explicação, não a página HTML do Express", async () => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 } });
  await comApp(
    (app) => {
      app.post("/api/importar", upload.single("arquivo"), (_req, res) => res.json({ ok: true }));
      app.use(manipuladorDeErros);
    },
    async (base) => {
      const form = new FormData();
      form.append("arquivo", new Blob(["x".repeat(500)]), "grande.txt");
      const r = await fetch(`${base}/api/importar`, { method: "POST", body: form });
      assert.equal(r.status, 413);
      assert.match(r.headers.get("content-type") ?? "", /application\/json/);
      assert.match((await r.json()).erro, /8 MB/);
    },
  );
});

test("campo de arquivo com nome errado: JSON dizendo qual campo o app espera", async () => {
  const upload = multer({ storage: multer.memoryStorage() });
  await comApp(
    (app) => {
      app.post("/api/importar", upload.single("arquivo"), (_req, res) => res.json({ ok: true }));
      app.use(manipuladorDeErros);
    },
    async (base) => {
      const form = new FormData();
      form.append("file", new Blob(["oi"]), "a.txt");
      const r = await fetch(`${base}/api/importar`, { method: "POST", body: form });
      assert.equal(r.status, 400);
      assert.match((await r.json()).erro, /"arquivo"/);
    },
  );
});

test("rota /api desconhecida (servidor antigo): 404 em JSON que manda reiniciar", async () => {
  await comApp(
    (app) => {
      app.use("/api", rotaApiDesconhecida);
      app.use(manipuladorDeErros);
    },
    async (base) => {
      const r = await fetch(`${base}/api/importar`, { method: "POST" });
      assert.equal(r.status, 404);
      assert.match(r.headers.get("content-type") ?? "", /application\/json/);
      const { erro } = await r.json();
      assert.match(erro, /POST \/api\/importar/);
      assert.match(erro, /reinicie o servidor/);
    },
  );
});

test("JSON inválido no corpo: 400 em JSON, não HTML", async () => {
  await comApp(
    (app) => {
      app.use(express.json());
      app.post("/api/x", (_req, res) => res.json({ ok: true }));
      app.use(manipuladorDeErros);
    },
    async (base) => {
      const r = await fetch(`${base}/api/x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{quebrado" });
      assert.equal(r.status, 400);
      assert.match((await r.json()).erro, /JSON inválido/);
    },
  );
});

test("ErroDeArquivo usa o status que carrega", async () => {
  await comApp(
    (app) => {
      app.get("/api/x", () => {
        throw new ErroDeArquivo("não leio isso", 415);
      });
      app.use(manipuladorDeErros);
    },
    async (base) => {
      const r = await fetch(`${base}/api/x`);
      assert.equal(r.status, 415);
      assert.equal((await r.json()).erro, "não leio isso");
    },
  );
});

test("erro de programa: 500 em JSON, sem vazar o stack para o navegador", async () => {
  const antes = console.error;
  console.error = () => undefined;
  try {
    await comApp(
      (app) => {
        app.get("/api/x", () => {
          throw new Error("segredo interno: C:\\caminho\\do\\servidor");
        });
        app.use(manipuladorDeErros);
      },
      async (base) => {
        const r = await fetch(`${base}/api/x`);
        assert.equal(r.status, 500);
        const { erro } = await r.json();
        assert.ok(!/segredo interno|caminho/.test(erro));
      },
    );
  } finally {
    console.error = antes;
  }
});
