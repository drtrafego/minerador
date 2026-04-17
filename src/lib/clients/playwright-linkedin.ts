import "server-only";
import type { BrowserContext, Page } from "playwright";
import {
  loadBrowserSession,
  saveBrowserSession,
} from "@/lib/clients/browser/storage";
import {
  withBrowser,
  type BrowserSessionPayload,
} from "@/lib/clients/browser/runtime";
import {
  humanDelay,
  humanMoveTo,
  humanScroll,
  randomInt,
  typeHumanLike,
} from "@/lib/clients/browser/human";

export class LinkedInBlockedError extends Error {
  constructor(message = "LinkedIn bloqueou a sessao") {
    super(message);
    this.name = "LinkedInBlockedError";
  }
}

export class LinkedInNeedsReloginError extends Error {
  constructor(message = "LinkedIn precisa de novo login") {
    super(message);
    this.name = "LinkedInNeedsReloginError";
  }
}

export class LinkedInProfileNotFoundError extends Error {
  constructor(profileUrl: string, detail?: string) {
    super(
      `LinkedIn profile ${profileUrl} nao encontrado${
        detail ? `, detalhe, ${detail}` : ""
      }`,
    );
    this.name = "LinkedInProfileNotFoundError";
  }
}

const LOCATOR_TIMEOUT = 15000;

async function detectNeedsLogin(page: Page): Promise<boolean> {
  const url = page.url();
  if (/\/uas\/login/i.test(url) || /\/login/i.test(url)) return true;
  const needles = [
    "Sign in to LinkedIn",
    "Entrar no LinkedIn",
    "Iniciar sesion en LinkedIn",
  ];
  for (const needle of needles) {
    try {
      const loc = page.getByText(needle, { exact: false });
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function detectProfileNotFound(page: Page): Promise<boolean> {
  const needles = [
    "This profile is not available",
    "Este perfil nao esta disponivel",
    "Esta pagina nao existe",
    "Page not found",
    "Pagina nao encontrada",
  ];
  for (const needle of needles) {
    try {
      const loc = page.getByText(needle, { exact: false });
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function detectRateLimit(page: Page): Promise<boolean> {
  const needles = [
    "You've reached the weekly invitation limit",
    "Voce atingiu o limite semanal",
    "Nao foi possivel enviar a mensagem",
    "Unable to send message",
    "Too many requests",
  ];
  for (const needle of needles) {
    try {
      const loc = page.getByText(needle, { exact: false });
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function locateMessageButton(page: Page, profileUrl: string) {
  const candidates = [
    page.getByRole("button", { name: /^Message$/i }),
    page.getByRole("button", { name: /^Mensagem$/i }),
    page.getByRole("button", { name: /^Mensaje$/i }),
    page.locator('button:has-text("Message")'),
    page.locator('button:has-text("Mensagem")'),
    page.locator('button:has-text("Mensaje")'),
    page.locator('a:has-text("Message")'),
    page.locator('a:has-text("Mensagem")'),
  ];

  let combined = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    combined = combined!.or(candidates[i]!);
  }

  const button = combined!.first();
  try {
    await button.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInProfileNotFoundError(
      profileUrl,
      "botao de mensagem nao localizado",
    );
  }
  return button;
}

async function runInContext(
  ctx: BrowserContext,
  profileUrl: string,
  body: string,
): Promise<{ externalThreadId: string; latencyMs: number }> {
  const started = Date.now();
  const page = await ctx.newPage();

  await page.goto(profileUrl, {
    waitUntil: "domcontentloaded",
    timeout: LOCATOR_TIMEOUT,
  });

  if (await detectNeedsLogin(page)) {
    throw new LinkedInNeedsReloginError();
  }

  if (await detectProfileNotFound(page)) {
    throw new LinkedInProfileNotFoundError(profileUrl, "pagina indisponivel");
  }

  if (await detectRateLimit(page)) {
    throw new LinkedInBlockedError(
      "LinkedIn aplicou rate limit (pagina de perfil)",
    );
  }

  await humanDelay(3500, 8000);

  const button = await locateMessageButton(page, profileUrl);
  await humanScroll(page);
  const box = await button.boundingBox();
  await humanMoveTo(page, box);

  try {
    await button.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInProfileNotFoundError(
      profileUrl,
      "falha ao clicar no botao de mensagem",
    );
  }

  const textbox = page
    .locator('div[role="textbox"][contenteditable="true"]')
    .or(page.locator('div[contenteditable="true"][role="textbox"]'))
    .or(page.locator('.msg-form__contenteditable[contenteditable="true"]'))
    .first();

  try {
    await textbox.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    if (await detectRateLimit(page)) {
      throw new LinkedInBlockedError(
        "LinkedIn aplicou rate limit ao abrir DM",
      );
    }
    throw new LinkedInBlockedError("campo de mensagem nao apareceu");
  }

  await humanDelay(1500, 3500);

  try {
    await textbox.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInBlockedError("falha ao focar no campo de mensagem");
  }

  await typeHumanLike(page, body);
  await humanDelay(200, 600);

  const sendButton = page
    .getByRole("button", { name: /^Send$/i })
    .or(page.getByRole("button", { name: /^Enviar$/i }))
    .or(page.locator('button.msg-form__send-button'))
    .or(page.locator('button:has-text("Send")'))
    .or(page.locator('button:has-text("Enviar")'));

  try {
    await sendButton.first().click({ timeout: 3000 });
  } catch {
    await page.keyboard.press("Enter");
  }

  const sentNeedle = body.slice(0, Math.min(20, body.length));
  try {
    await page
      .locator(`xpath=//div[contains(text(), ${JSON.stringify(sentNeedle)})]`)
      .first()
      .waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    if (await detectRateLimit(page)) {
      throw new LinkedInBlockedError(
        "LinkedIn aplicou rate limit ao enviar DM",
      );
    }
    throw new LinkedInBlockedError("mensagem nao aparece na conversa");
  }

  if (await detectRateLimit(page)) {
    throw new LinkedInBlockedError("LinkedIn aplicou rate limit apos envio");
  }

  let externalThreadId = "";
  const url = page.url();
  const match = url.match(/messaging\/thread\/([^/?#]+)/);
  if (match && match[1]) {
    externalThreadId = match[1];
  }

  // pequena pausa de encerramento
  await humanDelay(400, 1000);
  // usa randomInt so pra manter import estavel se nao usar acima
  void randomInt;

  return {
    externalThreadId,
    latencyMs: Date.now() - started,
  };
}

export async function sendLinkedInDM(params: {
  organizationId: string;
  profileUrl: string;
  body: string;
}): Promise<{ externalThreadId: string; latencyMs: number }> {
  const { organizationId, profileUrl, body } = params;

  const session = await loadBrowserSession(organizationId, "linkedin_session");
  if (!session) {
    throw new LinkedInNeedsReloginError();
  }

  const payload: BrowserSessionPayload = {
    storageState: session.storageState,
    profileUsername: session.profileUsername,
    savedAt: session.savedAt,
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  };

  const { result, newStorageState } = await withBrowser(payload, (ctx) =>
    runInContext(ctx, profileUrl, body),
  );

  // sessionCreatedAt e preservado dentro de saveBrowserSession,
  // repassamos o valor atual apenas para satisfazer o tipo
  await saveBrowserSession(organizationId, "linkedin_session", {
    storageState: newStorageState,
    profileUsername: session.profileUsername,
    savedAt: Date.now(),
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  });

  return result;
}
