"use client";
import { ShopFrame, useShopData } from "./shop-common";
export function ShopPolicy({ privacidade = false }: { privacidade?: boolean }) {
  const config = useShopData<{
    nome: string;
    email: string | null;
    telefone: string | null;
  }>("configuracao");
  return (
    <ShopFrame>
      <h1>{privacidade ? "Privacidade" : "Trocas e atendimento"}</h1>
      {privacidade ? (
        <>
          <p>
            Usamos os dados do seu cadastro para identificar sua conta,
            registrar pedidos, processar pagamentos, emitir documentos fiscais e
            organizar a entrega.
          </p>
          <p>
            Nome, documento, contato e dados do pedido podem ser enviados ao
            provedor de pagamento escolhido, à integração fiscal e ao serviço de
            entrega para executar sua compra. Os dados do cartão são informados
            no ambiente do provedor de pagamento.
          </p>
          <p>
            A loja usa cookies para manter sua sessão e armazenamento local do
            navegador para guardar os itens do carrinho. Você pode encerrar sua
            conta na área Minha conta.
          </p>
          <p>
            Para solicitar acesso, correção ou exclusão de dados pessoais, entre
            em contato com a loja pelos canais abaixo.
          </p>
        </>
      ) : (
        <>
          <p>
            Para solicitar troca, devolução ou ajuda com uma compra, informe o
            número do pedido e descreva o que aconteceu. A equipe da loja
            orientará o atendimento pelo canal de contato.
          </p>
          <p>Acompanhe os pedidos e o rastreamento na área Minha conta.</p>
        </>
      )}
      {config.data?.email && (
        <p>
          E-mail <a href={"mailto:" + config.data.email}>{config.data.email}</a>
        </p>
      )}
      {config.data?.telefone && <p>Telefone {config.data.telefone}</p>}
      {config.error && <p role="alert">{config.error}</p>}
      {config.data && !config.data.email && !config.data.telefone && (
        <p>Os canais de atendimento estão sendo configurados pela loja.</p>
      )}
    </ShopFrame>
  );
}
