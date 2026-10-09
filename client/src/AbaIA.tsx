import { useState } from "react";
import type { OrigemPedido, Uso } from "./types";

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
};

/**
 * Aba da IA. O app só a mostra quando o servidor informa que há chave
 * configurada (/api/health -> ia.ativa); sem chave ela nem existe na tela e o
 * resto do app funciona igual, preenchido à mão.
 */
export default function AbaIA(p: Props) {
  const temPedido = p.pedido.trim().length > 0;
  const gerouAlgo = p.ignorados.length > 0 || p.revertidas.length > 0 || p.naoConfirmadas > 0;

  return (
    <div className="pagina estreita">
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
          <button className="ia-botao cheio" onClick={p.onSugerir} disabled={p.sugerindo || !temPedido}>
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
            disabled={p.revisando || p.aRevisar === 0}
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
