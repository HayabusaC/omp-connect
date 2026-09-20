import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import type { OAuthPrompt } from "@oh-my-pi/pi-ai/oauth";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Container, Input, Text } from "@oh-my-pi/pi-tui";
import { exec as execCb } from "node:child_process";

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  groq: "Groq",
  mistral: "Mistral",
  cerebras: "Cerebras",
  xai: "xAI",
  zai: "ZAI",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax China",
  "azure-openai-responses": "Azure OpenAI",
  "vercel-ai-gateway": "Vercel AI Gateway",
  "openai-codex": "ChatGPT",
  "github-copilot": "GitHub Copilot",
  "google-gemini-cli": "Gemini CLI",
  "google-antigravity": "Antigravity",
  "google-vertex": "Google Vertex",
  "amazon-bedrock": "Amazon Bedrock",
};

const ENV_VAR_OVERRIDES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  xai: "XAI_API_KEY",
  zai: "ZAI_API_KEY",
  huggingface: "HF_TOKEN",
  "kimi-coding": "KIMI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
};

// These providers intentionally remain OAuth-only. OMP's native provider
// definitions are the authority for which OAuth providers exist.
const OAUTH_ONLY_PROVIDERS = new Set([
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
  "google-antigravity",
]);

const PRIORITY: Record<string, number> = {
  anthropic: 0,
  openai: 1,
  "openai-codex": 2,
  "github-copilot": 3,
  google: 4,
  "google-gemini-cli": 5,
  openrouter: 6,
  opencode: 7,
  "opencode-go": 8,
  groq: 9,
  mistral: 10,
};

type ProviderChoice = {
  id: string;
  supportsApiKey: boolean;
  oauth?: { name: string; storageId: string };
};

type ConnectionEntry = {
  id: string;
  kind: "oauth" | "api";
  storageId: string;
};

function prettyProviderName(providerId: string): string {
  return DISPLAY_NAME_OVERRIDES[providerId]
    ?? providerId
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

function sortProviderIds(providerIds: Iterable<string>): string[] {
  return [...new Set(providerIds)].sort((a, b) => {
    return (PRIORITY[a] ?? 99) - (PRIORITY[b] ?? 99)
      || prettyProviderName(a).localeCompare(prettyProviderName(b));
  });
}

function openUrl(url: string): void {
  const command = process.platform === "darwin"
    ? `open ${JSON.stringify(url)}`
    : process.platform === "win32"
      ? `start "" ${JSON.stringify(url)}`
      : `xdg-open ${JSON.stringify(url)}`;

  // OAuth was explicitly selected by the user before this is called. The
  // callback never writes the URL or any credential material to output.
  execCb(command, { windowsHide: true }, () => {});
}

function getOAuthProviderMap(): Map<string, { name: string; storageId: string }> {
  return new Map(
    getOAuthProviders()
      .filter((provider) => provider.available !== false)
      .map((provider) => [provider.id, {
        name: provider.name,
        storageId: provider.storeCredentialsAs ?? provider.id,
      }]),
  );
}

function getProviderIds(ctx: any, oauthProviders: Map<string, { name: string; storageId: string }>): string[] {
  const modelProviders = ctx.modelRegistry.getAll().map((model: { provider: string }) => model.provider);
  const savedProviders = ctx.modelRegistry.authStorage.list();

  return sortProviderIds([
    ...modelProviders,
    ...savedProviders,
    ...oauthProviders.keys(),
  ]);
}

function getStoredCredentialCount(authStorage: any, providerId: string): number {
  if (typeof authStorage.listStoredCredentials === "function") {
    return authStorage.listStoredCredentials(providerId).length;
  }
  return authStorage.has(providerId) ? 1 : 0;
}

function hasConfiguredAuth(authStorage: any, providerId: string): boolean {
  if (typeof authStorage.hasAuth === "function") return authStorage.hasAuth(providerId);
  return authStorage.has(providerId);
}

function statusIcon(authStorage: any, providerId: string): string {
  if (getStoredCredentialCount(authStorage, providerId) > 0) return "●";
  if (hasConfiguredAuth(authStorage, providerId)) return "◌";
  return "○";
}

async function promptInput(
  ctx: any,
  title: string,
  placeholder: string,
  secret: boolean,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (ctx.hasUI === false) {
    return ctx.ui.input(title, placeholder, signal ? { signal } : undefined);
  }

  return ctx.ui.custom<string | undefined>((tui: any, _theme: any, _keybindings: any, done: (value: string | undefined) => void) => {
    const container = new Container();
    container.addChild(new Text(title, 0, 0));
    if (placeholder) container.addChild(new Text(placeholder, 0, 0));

    const input = new Input();
    input.prompt = "› ";
    input.mask = secret;
    input.focused = true;
    container.addChild(input);

    let settled = false;
    let abortHandler: (() => void) | undefined;

    const cleanup = () => {
      if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
      input.onSubmit = undefined;
      input.onEscape = undefined;
    };

    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      done(value);
    };

    abortHandler = () => finish(undefined);
    input.onSubmit = (value: string) => finish(value);
    input.onEscape = () => finish(undefined);

    if (signal?.aborted) {
      queueMicrotask(() => finish(undefined));
    } else {
      signal?.addEventListener("abort", abortHandler, { once: true });
    }

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        input.handleInput(data);
        tui.requestRender();
      },
      dispose: cleanup,
    };
  }, signal ? { signal } : undefined);
}

async function promptApiKey(providerId: string, ctx: any): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage;
  const envName = ENV_VAR_OVERRIDES[providerId];
  const prompt = envName
    ? `${prettyProviderName(providerId)} API key (stored in OMP credentials; ${envName} is not required)`
    : `${prettyProviderName(providerId)} API key (stored in OMP credentials)`;
  const value = await promptInput(ctx, prompt, "Paste API key", true);
  const key = value?.trim();

  if (!key) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }

  // upsertCredential appends a distinct API key and updates an identical key.
  // AuthStorage.set() has replace-all semantics and is intentionally avoided.
  await authStorage.upsertCredential(providerId, {
    type: "api_key",
    key,
    source: "login",
  });
  ctx.ui.notify(`Saved ${prettyProviderName(providerId)} in OMP credentials`, "info");
}

async function loginWithOAuth(providerId: string, ctx: any): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage;

  try {
    const identity = await authStorage.login(providerId, {
      onAuth: ({ url, launchUrl }: { url: string; launchUrl?: string }) => {
        openUrl(launchUrl ?? url);
        ctx.ui.notify("OAuth login opened in your browser", "info");
      },
      onPrompt: (prompt: OAuthPrompt) => promptInput(
        ctx,
        prompt.message,
        prompt.placeholder ?? "",
        prompt.secret === true,
      ).then((value) => value ?? ""),
      onManualCodeInput: (signal?: AbortSignal) => promptInput(
        ctx,
        "Paste the authorization code or redirect URL",
        "code or redirect URL",
        false,
        signal,
      ).then((value) => value ?? ""),
      onProgress: () => {
        ctx.ui.notify("OAuth login in progress…", "info");
      },
    });

    ctx.ui.notify(
      identity ? `Connected ${prettyProviderName(providerId)}` : "OAuth login cancelled",
      "info",
    );
  } catch {
    // Do not surface error objects: providers may include URLs or credential
    // material in their messages. OMP diagnostics remain available separately.
    ctx.ui.notify("OAuth login failed; see OMP diagnostics for details", "error");
  }
}

async function chooseConnectionMethod(provider: ProviderChoice, ctx: any): Promise<void> {
  if (provider.oauth && provider.supportsApiKey) {
    const method = await ctx.ui.select(`Connect ${prettyProviderName(provider.id)}`, [
      { label: "OAuth", description: "Use OMP's native OAuth flow" },
      { label: "API key", description: "Paste an existing key into OMP credentials" },
    ]);

    if (method === "OAuth") {
      await loginWithOAuth(provider.id, ctx);
    } else if (method === "API key") {
      await promptApiKey(provider.id, ctx);
    }
    return;
  }

  if (provider.oauth) {
    await loginWithOAuth(provider.id, ctx);
    return;
  }

  await promptApiKey(provider.id, ctx);
}

async function chooseProvider(ctx: any): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage;
  const oauthProviders = getOAuthProviderMap();
  const providerIds = getProviderIds(ctx, oauthProviders);
  const oauthStorageAliases = new Set(
    [...oauthProviders.entries()]
      .filter(([providerId, provider]) => provider.storageId !== providerId)
      .map(([, provider]) => provider.storageId),
  );

  // Match pi-connect's original picker semantics: OAuth and API-key entries
  // are separate rows, even when both methods belong to one provider.
  const oauthEntries: ConnectionEntry[] = [...oauthProviders.entries()]
    .filter(([providerId]) => providerIds.includes(providerId))
    .map(([providerId, provider]) => ({
      id: providerId,
      kind: "oauth",
      storageId: provider.storageId,
    }));
  const apiEntries: ConnectionEntry[] = sortProviderIds(providerIds)
    .filter((providerId) => !OAUTH_ONLY_PROVIDERS.has(providerId) && !oauthStorageAliases.has(providerId))
    .map((providerId) => ({
      id: providerId,
      kind: "api",
      storageId: providerId,
    }));
  const choices = [...oauthEntries, ...apiEntries];

  if (choices.length === 0) {
    ctx.ui.notify("OMP did not expose any providers", "warning");
    return;
  }

  const labels = new Map<string, ConnectionEntry>();
  const options = choices.map((provider) => {
    const oauth = oauthProviders.get(provider.id);
    const displayName = provider.kind === "oauth" && oauth
      ? oauth.name
      : prettyProviderName(provider.id);
    const mode = provider.kind === "oauth" ? "OAuth" : "API key";
    const label = `${statusIcon(authStorage, provider.storageId)} ${displayName} [${provider.id}] — ${mode}`;
    labels.set(label, provider);
    return {
      label,
      description: provider.kind === "oauth"
        ? "Use OMP's native OAuth flow"
        : "Paste and save an API key in OMP credentials",
    };
  });

  const selected = await ctx.ui.select("Connect provider", options);
  const selectedEntry = selected ? labels.get(selected) : undefined;
  if (!selectedEntry) return;
  if (selectedEntry.kind === "oauth") {
    await loginWithOAuth(selectedEntry.id, ctx);
  } else {
    await promptApiKey(selectedEntry.id, ctx);
  }
}

async function disconnectCredential(ctx: any): Promise<void> {
  const authStorage = ctx.modelRegistry.authStorage;
  const providers = sortProviderIds(authStorage.list());

  if (providers.length === 0) {
    ctx.ui.notify("No saved credentials", "info");
    return;
  }

  const providerLabels = new Map<string, string>();
  const providerOptions = providers.map((providerId) => {
    const label = `${statusIcon(authStorage, providerId)} ${prettyProviderName(providerId)} [${providerId}]`;
    providerLabels.set(label, providerId);
    return { label, description: `${getStoredCredentialCount(authStorage, providerId)} saved credential(s)` };
  });
  const selectedProviderLabel = await ctx.ui.select("Disconnect provider", providerOptions);
  const providerId = selectedProviderLabel ? providerLabels.get(selectedProviderLabel) : undefined;
  if (!providerId) return;

  if (typeof authStorage.listStoredCredentials !== "function" || typeof authStorage.removeCredential !== "function") {
    ctx.ui.notify("This OMP version does not expose per-credential removal; nothing was changed", "warning");
    return;
  }

  const credentials = authStorage.listStoredCredentials(providerId);
  if (credentials.length === 0) {
    ctx.ui.notify("No stored credential was found for that provider", "info");
    return;
  }

  const credentialLabels = new Map<string, string>();
  const credentialOptions = credentials.map((entry: any, index: number) => {
    const credential = entry.credential;
    const label = credential?.type === "oauth"
      ? `OAuth account ${index + 1}${credential.email ? ` (${credential.email})` : ""}`
      : `API key ${index + 1}`;
    credentialLabels.set(label, entry.id);
    return { label, description: "Remove only this OMP credential" };
  });
  const selectedCredentialLabel = await ctx.ui.select("Choose credential to remove", credentialOptions);
  const credentialId = selectedCredentialLabel ? credentialLabels.get(selectedCredentialLabel) : undefined;
  if (!credentialId) return;

  const removed = await authStorage.removeCredential(providerId, credentialId);
  ctx.ui.notify(removed ? "Credential removed from OMP credentials" : "Credential was not found", removed ? "info" : "warning");
}

export default function ompConnectExtension(omp: ExtensionAPI) {
  omp.registerCommand("connect", {
    description: "Connect an OMP OAuth or API key provider",
    handler: async (args, ctx) => {
      const providerId = args.trim().toLowerCase();
      if (!providerId) {
        await chooseProvider(ctx);
        return;
      }

      const oauthProviders = getOAuthProviderMap();
      const apiProviderIds = new Set(getProviderIds(ctx, oauthProviders).filter((id) => !OAUTH_ONLY_PROVIDERS.has(id)));
      const oauthStorageAliases = new Set(
        [...oauthProviders.entries()]
          .filter(([oauthId, provider]) => provider.storageId !== oauthId)
          .map(([, provider]) => provider.storageId),
      );
      await chooseConnectionMethod({
        id: providerId,
        supportsApiKey: !oauthStorageAliases.has(providerId)
          && (apiProviderIds.has(providerId) || providerId === "google" || providerId === "openrouter"),
        oauth: oauthProviders.get(providerId),
      }, ctx);
    },
  });

  omp.registerCommand("disconnect", {
    description: "Remove one saved OMP credential",
    handler: async (_args, ctx) => {
      await disconnectCredential(ctx);
    },
  });
}
