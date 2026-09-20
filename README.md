# omp-connect

Unified OAuth and API-key login for [Oh My Pi](https://github.com/can1357/oh-my-pi) / OMP.

`omp-connect` keeps the core `pi-connect` workflow while using the current OMP APIs:

- `/connect` with provider selection
- API-key paste for Google Gemini, OpenRouter, and other registered providers
- OMP-native OAuth for providers that expose an OAuth login
- `/disconnect` with per-credential removal

## Install for development

From this repository:

```bash
omp plugin link .
omp plugin list --json
omp plugin doctor --json
```

The manifest is the `omp` field in `package.json`; this is an OMP plugin, not a legacy `pi` package.

## Usage

```text
/connect
/connect google
/connect openrouter
/disconnect
```

`/connect google` asks for a Gemini / AI Studio API key. The provider picker shows separate OAuth and API-key rows for providers that support both, including OpenRouter, so an existing OpenRouter key can be pasted without being forced through OAuth.

For a direct command such as `/connect openrouter`, the extension preserves the pi-connect method chooser. OAuth is delegated to OMP's `AuthStorage.login`; this extension does not implement an OAuth protocol or token exchange.

## Credential storage

Pasted keys are saved with OMP's public `AuthStorage.upsertCredential` API. They are not written to `.env`, `models.yml`, `keys.json`, or a plugin-owned credential file. Existing provider/model IDs are preserved, including `google/...` and `openrouter/...`.

OMP v18.2.6 supports multiple credentials per provider. `upsertCredential` appends a different key and updates an identical key, while `/disconnect` removes only the selected credential. The extension deliberately does not use `AuthStorage.set`, whose replace-all behavior could silently discard older keys.

The extension never prints API keys, OAuth tokens, credential objects, or provider error objects to logs or test output.

## Development notes

The package targets the OMP v18.2.6 public package names:

- `@oh-my-pi/pi-coding-agent`
- `@oh-my-pi/pi-ai`
- `@oh-my-pi/pi-tui`

It reads the OAuth provider registry through `getOAuthProviders()` and persists credentials through the current OMP `AuthStorage` surface.

## License

MIT
