import PainelConversa from "./PainelConversa";
import type { Briefing, DescartadoConversa, Importacao } from "./types";

type Props = {
  briefing: Briefing;
  pedido: string;
  iaAtiva: boolean;
  onBriefing: (b: Briefing) => void;
  onPedido: (texto: string) => void;
  onComecar: () => void;
  onIrParaIA: () => void;
  onLimpar: () => void;
  conversa: {
    importacao: Importacao | null;
    importando: boolean;
    erro: string | null;
    arquivoNome: string | null;
    onTentarDeNovo: () => void;
    promovidos: Set<number>;
    onArquivo: (arquivo: File) => void;
    onReprocessar: (clientes: string[]) => void;
    onAdicionar: (indices: number[]) => void;
    onPromover: (d: DescartadoConversa) => void;
  };
};

export default function AbaPedido({
  briefing,
  pedido,
  iaAtiva,
  onBriefing,
  onPedido,
  onComecar,
  onIrParaIA,
  onLimpar,
  conversa,
}: Props) {
  return (
    <div className="pagina estreita">
      <section className="painel">
        <header className="painel-topo">
          <h2>Dados do pedido</h2>
          <p>Aparecem no nome do arquivo e preenchem a página das alterações novas.</p>
        </header>
        <div className="dupla">
          <label className="campo">
            <span className="rotulo">Cliente</span>
            <input
              value={briefing.cliente}
              onChange={(e) => onBriefing({ ...briefing, cliente: e.target.value })}
              placeholder="Amorim Letreiros"
            />
          </label>
          <label className="campo">
            <span className="rotulo">URL base do link temporário</span>
            <input
              value={briefing.url_base}
              onChange={(e) => onBriefing({ ...briefing, url_base: e.target.value })}
              placeholder="https://www.site.mpitemporario.com.br/cliente.com.br/"
            />
          </label>
        </div>
      </section>

      <PainelConversa {...conversa} />

      <section className="painel">
        <header className="painel-topo">
          <h2>Pedido do cliente</h2>
          <p>
            Cole aqui o texto do cliente. Ele fica visível ao lado enquanto você preenche as
            alterações, então não precisa alternar de janela.
          </p>
        </header>
        <label className="campo">
          <span className="rotulo">
            Texto do pedido
            {pedido.length > 0 && <em>{pedido.length.toLocaleString("pt-BR")} caracteres</em>}
          </span>
          <textarea
            className="grande"
            rows={14}
            value={pedido}
            onChange={(e) => onPedido(e.target.value)}
            placeholder="Cole aqui a mensagem do cliente, ou a transcrição da reunião."
          />
        </label>

        <div className="acoes">
          <button className="primario" onClick={onComecar}>
            Preencher as alterações →
          </button>
          {iaAtiva && (
            <button className="ia-botao" onClick={onIrParaIA} disabled={!pedido.trim()}>
              Deixar a IA separar em alterações
            </button>
          )}
        </div>
      </section>

      <p className="rodape-aba">
        O rascunho fica salvo neste navegador.{" "}
        <button className="link-discreto" onClick={onLimpar}>
          Apagar tudo e começar do zero
        </button>
      </p>
    </div>
  );
}
