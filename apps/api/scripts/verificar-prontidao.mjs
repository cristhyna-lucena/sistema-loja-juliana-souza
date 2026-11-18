import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { createDatabase } from "@sistema/db";

loadEnvFile(new URL("../../../.env", import.meta.url));
const directory = new URL("../../../output/finalizacao/", import.meta.url);
await mkdir(directory, { recursive: true });
const valid = (name) => {
  const value = process.env[name]?.trim();
  return (
    !!value && !/SUBSTITUIR|GERADO_PELO|fictici|example\.invalid/i.test(value)
  );
};
const required = {
  mercadoPago: ["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET"],
  asaas: ["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"],
  pagarme: ["PAGARME_SECRET_KEY", "PAGARME_WEBHOOK_PASSWORD"],
  correios: [
    "CORREIOS_USUARIO",
    "CORREIOS_CODIGO_ACESSO",
    "CORREIOS_CARTAO_POSTAGEM",
  ],
  focusHomologacao: ["FOCUS_TOKEN", "FOCUS_WEBHOOK_TOKEN"],
  focusProducao: ["FOCUS_TOKEN_PRODUCAO", "FOCUS_WEBHOOK_TOKEN"],
  email: ["RESEND_API_KEY", "EMAIL_FROM"],
};
const credentials = Object.fromEntries(
  Object.entries(required).map(([service, keys]) => [
    service,
    {
      presentes: keys.filter(valid),
      ausentes: keys.filter((name) => !valid(name)),
      homologado: false,
    },
  ]),
);
const db = createDatabase(process.env.DATABASE_URL);
try {
  const companies = await db.empresa.findMany({
    where: { ativa: true },
    include: { configuracao: true },
    orderBy: { createdAt: "asc" },
  });
  const companiesReport = [];
  const catalog = [];
  for (const company of companies) {
    const config = company.configuracao;
    const missing = [];
    if (!company.cnpj) missing.push("CNPJ");
    for (const field of [
      "razaoSocial",
      "regimeTributario",
      "email",
      "telefone",
      "cepOrigem",
      "contaOnlineId",
    ])
      if (!config?.[field]) missing.push(field);
    for (const field of [
      "cep",
      "logradouro",
      "numero",
      "bairro",
      "cidade",
      "uf",
      "codigoIbge",
    ])
      if (!config?.endereco?.[field]) missing.push("endereco." + field);
    const admins = await db.usuario.count({
      where: { empresaId: company.id, ativo: true, perfil: "ADMIN" },
    });
    const products = await db.produto.findMany({
      where: { empresaId: company.id },
      include: {
        complemento: true,
        categoria: true,
        imagens: {
          where: { removidaEm: null, hash: { not: null } },
          select: { id: true },
        },
      },
      orderBy: { nome: "asc" },
    });
    const balances = await db.movimentoEstoque.groupBy({
      by: ["produtoId"],
      where: { empresaId: company.id },
      _sum: { quantidade: true },
    });
    for (const product of products) {
      const fiscal = product.complemento;
      const pending = [];
      if (!product.descricao) pending.push("descrição");
      if (!product.categoria?.ativa) pending.push("categoria ativa");
      if (product.precoVenda.lte(0)) pending.push("preço de venda");
      if (!product.imagens.length) pending.push("foto no catálogo comercial");
      if (!fiscal?.publicadoLoja) pending.push("selecionar publicação na loja");
      for (const field of [
        "pesoGramas",
        "alturaCm",
        "larguraCm",
        "comprimentoCm",
      ])
        if (!fiscal?.[field]) pending.push(field);
      if (!fiscal?.ncm) pending.push("NCM");
      if (!fiscal?.cfopVenda) pending.push("CFOP");
      if (!fiscal?.csosn && !fiscal?.cst) pending.push("CST/CSOSN");
      catalog.push({
        empresa: company.nome,
        sku: product.sku,
        nome: product.nome,
        ativo: product.ativo,
        tipo: product.tipo,
        precoVenda: product.precoVenda.toFixed(2),
        saldoMovimentos:
          balances
            .find((balance) => balance.produtoId === product.id)
            ?._sum.quantidade?.toFixed(3) ?? "0.000",
        publicadoLoja: fiscal?.publicadoLoja ?? false,
        pendencias: pending,
      });
    }
    companiesReport.push({
      id: company.id,
      nome: company.nome,
      configuracaoSalva: !!config,
      administradoresAtivos: admins,
      dadosAusentes: missing,
      produtos: products.length,
      produtosPublicados: products.filter(
        (product) =>
          product.ativo &&
          product.complemento?.publicadoLoja &&
          product.tipo !== "INSUMO",
      ).length,
      freteGratisAtivo: config?.freteGratisAtivo ?? false,
      correiosAtivo: config?.correiosAtivo ?? false,
      integracoesHabilitadas: config?.integracoes ?? {},
    });
  }
  const report = {
    geradoEm: new Date().toISOString(),
    somenteLeitura: true,
    publicacaoRealizada: false,
    empresaSelecionada:
      process.env.EMPRESA_ID ??
      (companies.length === 1 ? companies[0].id : null),
    selecaoEmpresaNecessaria: !process.env.EMPRESA_ID && companies.length !== 1,
    credenciais: credentials,
    empresas: companiesReport,
    catalogo: catalog,
    observacoes: [
      "Valores de credenciais não são exibidos neste relatório.",
      "Presença de credencial não comprova validação no provedor.",
      "Saldo é a soma das movimentações; disponibilidade também depende de lotes, validade e reservas.",
      "Campos tributários precisam ser confirmados pela contadora; não são preenchidos por suposição.",
      "Fotos e produtos do HTML de apresentação não são estoque ou preços do catálogo comercial.",
    ],
  };
  await writeFile(
    new URL("prontidao.json", directory),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
  const fields = [
    "empresa",
    "sku",
    "nome",
    "ativo",
    "tipo",
    "precoVenda",
    "saldoMovimentos",
    "publicadoLoja",
    "pendencias",
  ];
  const csv = (value) =>
    '"' +
    String(value)
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  await writeFile(
    new URL("catalogo-revisao.csv", directory),
    "\uFEFF" +
      [
        fields.map(csv).join(";"),
        ...catalog.map((product) =>
          fields
            .map((field) =>
              csv(
                Array.isArray(product[field])
                  ? product[field].join(", ")
                  : product[field],
              ),
            )
            .join(";"),
        ),
      ].join("\r\n") +
      "\r\n",
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        relatorio: fileURLToPath(new URL("prontidao.json", directory)),
        empresas: companiesReport,
        servicosSemCredenciaisCompletas: Object.entries(credentials)
          .filter(([, value]) => value.ausentes.length)
          .map(([key]) => key),
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
