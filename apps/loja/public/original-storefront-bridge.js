/* Integrações da loja real sobre os controles do HTML original da cliente. */
(() => {
  document.addEventListener("click", (event) => {
    const element = event.target.closest("button,a");
    if (!element) return;
    let target;
    if (element.dataset.action === "account") target = "/conta";
    if (element.dataset.action === "cart") target = "/carrinho";
    if (element.dataset.action === "allProducts") target = "/produtos";
    if (element.id === "adminMode" || ["openAdmin", "adminHome"].includes(element.dataset.action)) target = (window.lojaAdminOrigin || "http://127.0.0.1:3001") + "/login";
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.assign(target);
  }, true);
  const badge = document.querySelector('[data-action="cart"] .soon-dot');
  if (badge) badge.textContent = "Comprar";
  const note = document.querySelector(".catalog-note");
  if (note) note.textContent = "Conheça os detalhes de cada linha e consulte os produtos disponíveis para compra na loja.";
  const footerNote = document.querySelector(".footer-grid > div:last-child > p");
  if (footerNote) footerNote.textContent = "Beleza, cuidado e carinho. Confira os produtos disponíveis na nossa loja.";
  const body = document.getElementById("dialogBody");
  if (new URLSearchParams(window.location.search).get("favoritos") === "1") document.getElementById("favoritesToggle")?.click();
  function conectarProduto() {
    const detail = body?.querySelector(".detail-copy");
    if (!detail || detail.querySelector("[data-loja-comprar]")) return;
    for (const paragraph of detail.querySelectorAll("p"))
      if (/compra online.*(não|disponível)/i.test(paragraph.textContent)) paragraph.textContent = "Consulte preço, estoque e opções de pagamento nos produtos disponíveis na loja.";
    const link = document.createElement("a");
    link.dataset.lojaComprar = "true";
    link.className = "gold-button";
    link.textContent = "Ver opções de compra";
    const name = body.querySelector("#dialogTitle")?.textContent || "";
    link.href = "/produtos?q=" + encodeURIComponent(name);
    detail.append(link);
  }
  if (body) new MutationObserver(conectarProduto).observe(body, { childList: true, subtree: true });
})();
