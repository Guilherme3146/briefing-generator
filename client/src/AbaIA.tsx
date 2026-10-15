import { useState } from "react";
import type { ModoIA, OrigemPedido, ProvedorIA, Uso } from "./types";

type Props = {
  pedido: string;
  origem: OrigemPedido;
  sugerindo: boolean;
  revisando: boolean;
  aRevisar: number;
  totalAlteracoes: number;
  naoConfirmadas: number;
  ignorados: string[];
  revertidas: string[];
  uso: Uso | null;
  onOrigem: (o: OrigemPedido) => void;
  onSugerir: () => void;
  onRevisar: () => void;
  onVerAlteracoes: () => void;
  onIrParaPedido: () => void;
  /** "servidor" = funciona de graça; "proprio" = precisa da chave abaixo */
  modo: ModoIA;
  /** true quando dá pra clicar e realmente disparar uma chamada */
  pronta: boolean;
  chave: string;
  onChave: (v: string) => void;
  provedor: ProvedorIA;
  provedorSugerido: ProvedorIA;
  onProvedor: (p: ProvedorIA) => void;
};

/**
 * Aba da IA. O app só a mostra quando o servidor informa que a IA existe
 * (/api/health -> ia.ativa) — isso cobre dois casos bem diferentes:
 *
 *   modo "servidor" — o operador configurou uma chave no .env; funciona de
 *                      graça para qualquer visitante, sem pedir nada.
 *   modo "proprio"  — o servidor não tem chave nenhuma; cada visitante cola a
 *                      PRÓPRIA (ex.: uma chave gratuita do Gemini) antes de
 *                      usar. Fica só no navegador dele — nunca é salva no
 *                      servidor, e só viaja pra lá quando ele aperta um botão
 *                      de IA (ver App.tsx -> headersIA).
 *
 * Com IA_ATIVA=false no servidor, a aba nem aparece: o resto do app funciona
 * igual, preenchido à mão.
 */
export default function AbaIA(p: Props) {
  const temPedido = p.pedido.trim().length > 0;
  const gerouAlgo = p.ignorados.length > 0 || p.revertidas.length > 0 || p.naoConfirmadas > 0;

  return (
    <div className="pagina estreita">
      {p.modo === "proprio" && (
        <ConfigurarIA
          chave={p.chave}
          onChave={p.onChave}
          provedor={p.provedor}
          provedorSugerido={p.provedorSugerido}
          onProvedor={p.onProvedor}
        />
      )}

      <section className="painel ia">
        <header className="painel-topo">
          <h2>1. Ler o pedido</h2>
          <p>
            A IA separa o texto em alterações e anota as dúvidas. Ela só sugere: cada alteração
            nasce como rascunho e você confirma uma a uma.
          </p>
        </header>

        <div className="campo">
          <span className="rotulo">De onde veio</span>
          <div className="segmentado" role="group">
            <button
              className={p.origem === "mensagem" ? "ativo" : ""}
              onClick={() => p.onOrigem("mensagem")}
            >
              Mensagem
            </button>
            <button
              className={p.origem === "reuniao" ? "ativo" : ""}
              onClick={() => p.onOrigem("reuniao")}
            >
              Reunião
            </button>
          </div>
          <small>
            {p.origem === "reuniao"
              ? "Transcrição é chute da máquina: nada dela vira texto final do site — tudo que for publicado vira pergunta."
              : "O que o cliente escreveu entre aspas pode ir direto para o site."}
          </small>
        </div>

        {temPedido ? (
          <div className="previa-pedido">
            <span className="rotulo">
              Texto que será lido <em>{p.pedido.length.toLocaleString("pt-BR")} caracteres</em>
            </span>
            <p>{p.pedido.slice(0, 280)}{p.pedido.length > 280 ? "…" : ""}</p>
          </div>
        ) : (
          <div className="vazio">
            <p>Cole o pedido do cliente na aba Pedido para a IA ler.</p>
            <button className="secundario" onClick={p.onIrParaPedido}>
              Ir para o Pedido
            </button>
          </div>
        )}

        <div className="acoes">
          <button
            className="ia-botao cheio"
            onClick={p.onSugerir}
            disabled={p.sugerindo || !temPedido || !p.pronta}
            title={p.pronta ? undefined : "Cole sua chave de IA acima primeiro"}
          >
            {p.sugerindo
              ? p.origem === "reuniao"
                ? "Lendo a reunião…"
                : "Lendo o pedido…"
              : "Sugerir alterações"}
          </button>
        </div>
        <small className="nota">
          Cada clique é uma chamada à IA. O app nunca chama sozinho, nem enquanto você digita.
        </small>
      </section>

      {gerouAlgo && (
        <section className="painel">
          <header className="painel-topo">
            <h2>Resultado</h2>
            <p>
              {p.totalAlteracoes} {p.totalAlteracoes === 1 ? "alteração" : "alterações"} no briefing
              {p.naoConfirmadas > 0 && `, ${p.naoConfirmadas} aguardando confirmação`}.
            </p>
          </header>

          <div className="acoes">
            <button className="primario" onClick={p.onVerAlteracoes}>
              Conferir as alterações →
            </button>
          </div>

          {p.revertidas.length > 0 && (
            <Recolhivel
              titulo={`Decisões revertidas na reunião (${p.revertidas.length})`}
              tom="neutro"
              nota="Foi decidido e depois desfeito na própria conversa. Não virou alteração — confira se a IA leu certo."
              itens={p.revertidas}
            />
          )}
          {p.ignorados.length > 0 && (
            <Recolhivel
              titulo={`Não virou alteração (${p.ignorados.length})`}
              tom="atencao"
              nota="Trechos que a IA não transformou em nada. Confira se algum deveria ter virado alteração."
              itens={p.ignorados}
            />
          )}
        </section>
      )}

      <section className="painel ia">
        <header className="painel-topo">
          <h2>2. Revisar antes de gerar</h2>
          <p>
            Para cada alteração, a IA pergunta: um desenvolvedor que nunca falou com o cliente
            conseguiria executar isto? Pega o que nenhuma regra pega, como “remover essa máquina”.
            Só revisa o que mudou desde a última vez.
          </p>
        </header>
        <div className="acoes">
          <button
            className="ia-botao"
            onClick={p.onRevisar}
            disabled={p.revisando || p.aRevisar === 0 || !p.pronta}
            title={p.pronta ? undefined : "Cole sua chave de IA acima primeiro"}
          >
            {p.revisando
              ? "Revisando…"
              : p.aRevisar === 0
                ? "Tudo revisado"
                : `Revisar ${p.aRevisar} ${p.aRevisar === 1 ? "alteração" : "alterações"}`}
          </button>
        </div>
      </section>

      {p.uso && (
        <p className="uso">
          Último uso: {p.uso.modelo} · entrada {p.uso.entrada.toLocaleString("pt-BR")} · saída{" "}
          {p.uso.saida.toLocaleString("pt-BR")}
          {p.uso.cache_lido > 0 && ` · cache ${p.uso.cache_lido.toLocaleString("pt-BR")}`}
        </p>
      )}
    </div>
  );
}

const LINKS_CHAVE: Record<ProvedorIA, { rotulo: string; url: string; nota: string }> = {
  gemini: {
    rotulo: "Google AI Studio",
    url: "https://aistudio.google.com/apikey",
    nota: "Tem camada gratuita — leva menos de 2 minutos e não pede cartão.",
  },
  anthropic: {
    rotulo: "Console da Anthropic",
    url: "https://console.anthropic.com/settings/keys",
    nota: "Pago por uso (a chamada que este app faz custa centavos).",
  },
};

/**
 * Formulário de "traga sua própria chave" — só aparece no modo "proprio",
 * quando o servidor não tem IA configurada para todo mundo.
 *
 * A chave nunca é mandada para lugar nenhum além do header das chamadas de IA
 * deste próprio app (ver App.tsx -> headersIA); fica salva só no localStorage
 * deste navegador, nunca no rascunho que pode ser exportado/limpo.
 */
function ConfigurarIA({
  chave,
  onChave,
  provedor,
  provedorSugerido,
  onProvedor,
}: {
  chave: string;
  onChave: (v: string) => void;
  provedor: ProvedorIA;
  provedorSugerido: ProvedorIA;
  onProvedor: (p: ProvedorIA) => void;
}) {
  const [mostrar, setMostrar] = useState(false);
  const link = LINKS_CHAVE[provedor];

  return (
    <section className={`painel ia configurar-ia ${chave.trim() ? "ok" : "pendente"}`}>
      <header className="painel-topo">
        <h2>Configurar IA</h2>
        <p>
          Esta instância não tem uma chave de IA hospedada — por isso ninguém gasta a chave de
          outra pessoa. Cole a sua para usar; ela fica só neste navegador.
        </p>
      </header>

      <div className="campo">
        <span className="rotulo">Provedor</span>
        <div className="segmentado" role="group">
          <button className={provedor === "gemini" ? "ativo" : ""} onClick={() => onProvedor("gemini")}>
            Gemini
          </button>
          <button className={provedor === "anthropic" ? "ativo" : ""} onClick={() => onProvedor("anthropic")}>
            Anthropic
          </button>
        </div>
        {provedor === provedorSugerido && (
          <small>Sugestão desta instância — pode trocar à vontade.</small>
        )}
      </div>

      <div className="campo">
        <span className="rotulo">Chave de API</span>
        <div className="campo-chave">
          <input
            type={mostrar ? "text" : "password"}
            value={chave}
            onChange={(e) => onChave(e.target.value)}
            placeholder={provedor === "gemini" ? "AIza…" : "sk-ant-…"}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="secundario" onClick={() => setMostrar((v) => !v)}>
            {mostrar ? "Ocultar" : "Mostrar"}
          </button>
          {chave && (
            <button type="button" className="secundario" onClick={() => onChave("")}>
              Remover
            </button>
          )}
        </div>
        <small>
          Não tem uma chave?{" "}
          <a href={link.url} target="_blank" rel="noreferrer">
            Criar no {link.rotulo} →
          </a>{" "}
          {link.nota}
        </small>
      </div>
    </section>
  );
}

function Recolhivel({
  titulo,
  nota,
  itens,
  tom,
}: {
  titulo: string;
  nota: string;
  itens: string[];
  tom: "atencao" | "neutro";
}) {
  const [aberto, setAberto] = useState(true);
  return (
    <div className={`recolhivel ${tom}`}>
      <button className="recolhivel-topo" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <span>{titulo}</span>
        <span className="seta">{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div className="recolhivel-corpo">
          <p className="nota">{nota}</p>
          <ul>
            {itens.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
