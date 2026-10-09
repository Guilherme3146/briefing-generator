// O tsc so emite .js. Os prompts sao .md versionados em src/prompts/ e
// precisam existir ao lado do codigo compilado, senao a Fase 2 quebra em
// producao com "ENOENT: extrator.md".
import { cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const origem = join(raiz, "src", "prompts");
const destino = join(raiz, "dist", "prompts");

if (!existsSync(origem)) {
  console.error(`[copiar-prompts] nao encontrei ${origem}`);
  process.exit(1);
}

cpSync(origem, destino, { recursive: true });
console.log(`[copiar-prompts] ${readdirSync(destino).join(", ")} -> dist/prompts`);
