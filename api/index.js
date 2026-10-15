// Entrypoint da Vercel: toda rota /api/* cai aqui (ver rewrites em
// vercel.json) e o runtime Node da Vercel chama `app(req, res)` direto,
// porque um Express app já tem a assinatura (req, res) que o handler espera.
//
// Importa o SERVIDOR JÁ COMPILADO (server/dist), não o .ts fonte — o build da
// Vercel roda `npm run build` (ver vercel.json) antes de empacotar as
// funções, então dist/ já existe nesse ponto.
export { default } from "../server/dist/index.js";
