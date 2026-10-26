const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  page.on("dialog", dialog => dialog.accept());
});

test("pedido, histórico e persistência", async ({ page }) => {
  await page.getByRole("button", { name: "Usar sugestão", exact: true }).click();
  await page.getByRole("button", { name: "Enviar pelo WhatsApp" }).click();
  await expect(page.locator("#textoPedido")).toHaveValue(/^10X - COCA 2LT\n/);
  await page.getByRole("button", { name: "Salvar no histórico" }).click();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page.locator("#total")).toContainText("0 produtos");
  await page.getByRole("button", { name: "Repetir último" }).click();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Quantidade de COCA 2LT", exact: true })).toHaveValue("10");
});

test("cadastro, parâmetros e edição sem perder o pedido", async ({ page }) => {
  await page.getByRole("button", { name: "Cadastros", exact: true }).click();
  await page.getByRole("button", { name: "Categorias", exact: true }).click();
  await page.locator("#categoriaNome").fill("Teste categoria");
  await page.locator("#salvarCategoria").click();
  await page.locator("#cadNovoProduto").click();
  await page.locator("#novoNome").fill("Produto teste");
  await page.locator("#novoCat").selectOption({ label: "Teste categoria" });
  await page.locator("#produtoUnidade").fill("Fardo com 12");
  await page.locator("#produtoUsual").fill("8");
  await page.locator("#produtoMinimo").fill("5");
  await page.locator("#produtoIdeal").fill("20");
  await page.locator("#salvarNovo").click();
  await page.locator("#fecharCadastros").click();
  await page.getByRole("button", { name: "Usar sugestão", exact: true }).click();
  await page.getByRole("button", { name: "Cadastros", exact: true }).click();
  await page.locator("#buscaCadastro").fill("produto teste");
  await page.locator("#cadastroProdutos button").click();
  await page.locator("#novoNome").fill("Produto renomeado");
  await page.locator("#salvarNovo").click();
  await page.locator("#fecharCadastros").click();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Quantidade de PRODUTO RENOMEADO", exact: true })).toHaveValue("8");
  const dados = await page.evaluate(() => JSON.parse(localStorage.getItem("listaCompras.v1")));
  expect(dados.parametros["PRODUTO RENOMEADO"]).toEqual({ unidade: "Fardo com 12", minimo: 5, ideal: 20 });
});

test("validação de duplicados e parâmetros inválidos", async ({ page }) => {
  const mensagens = [];
  page.on("dialog", dialog => mensagens.push(dialog.message()));
  await page.locator("#btnNovo").click();
  await page.locator("#novoNome").fill("coca 2lt");
  await page.locator("#salvarNovo").click();
  await expect(page.locator("#dlgNovo")).toBeVisible();
  await page.locator("#novoNome").fill("Produto exclusivo");
  await page.locator("#produtoMinimo").fill("10");
  await page.locator("#produtoIdeal").fill("5");
  await page.locator("#salvarNovo").click();
  expect(mensagens).toContain("Esse produto já existe.");
  expect(mensagens).toContain("Preencha mínimo e ideal juntos. O ideal deve ser maior ou igual ao mínimo.");
});

test("backup exportado é restaurado e arquivo inválido é rejeitado", async ({ page }) => {
  await page.locator("#btnSugestao").click();
  await page.locator("#btnCadastros").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportarBackup").click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  await page.locator("#fecharCadastros").click();
  await page.locator("#btnLimpar").click();
  await page.locator("#btnCadastros").click();
  await page.locator("#arquivoBackup").setInputFiles(backupPath);
  await expect(page.locator("#total")).not.toContainText("0 produtos");
  await page.locator("#arquivoBackup").setInputFiles({
    name: "invalido.json", mimeType: "application/json", buffer: Buffer.from('{"versao":2}')
  });
  await expect(page.locator("#total")).not.toContainText("0 produtos");
});

test("migração da primeira versão mantém extras, quantidades e histórico", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("listaCompras.v1", JSON.stringify({
    extras: [{nome:"PRODUTO LEGADO",cat:0}], qtd: {"PRODUTO LEGADO":3},
    historico:[{data:"2026-10-26T10:00:00Z",itens:{"COCA 2LT":5}}]
  })));
  await page.reload();
  await expect(page.getByRole("spinbutton", {name:"Quantidade de PRODUTO LEGADO",exact:true})).toHaveValue("3");
  await page.locator("#btnUltimo").click();
  await expect(page.getByRole("spinbutton", {name:"Quantidade de COCA 2LT",exact:true})).toHaveValue("5");
});

for (const width of [320, 360, 390, 430, 768]) {
  test(`layout sem transbordamento em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".item")).toHaveCount(112);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const plus = await page.locator(".mais").first().boundingBox();
    expect(plus.width).toBeGreaterThanOrEqual(44);
    expect(plus.height).toBeGreaterThanOrEqual(44);
    await page.locator("#btnCadastros").click();
    await page.locator("#cadNovoProduto").click();
    const dialog = await page.locator("#dlgNovo").boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/cadastro-${width}.png` });
  });
}

test("abre e permite editar o pedido offline", async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once:true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator(".mais").first().click();
  await expect(page.getByRole("spinbutton", { name: "Quantidade de COCA 2LT", exact:true })).toHaveValue("1");
  await context.setOffline(false);
});
