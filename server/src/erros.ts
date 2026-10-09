import multer from "multer";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ErroDeArquivo } from "./arquivo.js";

/**
 * Toda resposta de erro da API é JSON. O front faz `r.json()`; o Express, sem
 * isso, responde HTML ("Cannot POST /api/...", ou a página de erro do multer),
 * o que aparece para o analista como "Unexpected token '<'" e não diz nada.
 */

/** Rota /api/... que não existe: tipicamente um servidor antigo, sem a rota nova. */
export const rotaApiDesconhecida: RequestHandler = (req, res) => {
  res.status(404).json({
    erro:
      `O servidor não conhece a rota ${req.method} ${req.originalUrl.split("?")[0]}. ` +
      "Se o projeto foi atualizado, reinicie o servidor (npm run dev).",
  });
};

export const manipuladorDeErros: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof ErroDeArquivo) {
    return res.status(err.status).json({ erro: err.message });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        erro: "O arquivo passa de 8 MB. Uma transcrição raramente é tão grande: confira se é o arquivo certo.",
      });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        erro: `Campo de arquivo inesperado (${err.field ?? "?"}). O app envia o arquivo no campo "arquivo".`,
      });
    }
    return res.status(400).json({ erro: `Falha no envio do arquivo: ${err.message}` });
  }

  const tipo = (err as { type?: string } | null)?.type;
  if (tipo === "entity.parse.failed") {
    return res.status(400).json({ erro: "O servidor recebeu um JSON inválido." });
  }
  if (tipo === "entity.too.large") {
    return res.status(413).json({ erro: "O envio é grande demais para esta operação." });
  }

  console.error("[erro]", err instanceof Error ? (err.stack ?? err.message) : err);
  res.status(500).json({ erro: "Erro interno do servidor. O detalhe está no terminal onde o npm run dev roda." });
};
