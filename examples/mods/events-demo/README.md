# events-demo

Sample mod for the roadmap E events and registrations. It:

- adds an instruction to every model call with `model.request` (`systemAppend`),
- counts model replies and the tools they ask for with `model.response`,
- counts desktop notifications with `Notification` (Claude Code's hook name, mapped to `notification`),
- registers the `events-demo-doc-checker` subagent from `agents/doc-checker.md` with `$.agent.register`,
- offers a local Ollama provider with `$.provider.register`.

Not installed by default. Copy this folder to `~/.pawn/mods/events-demo` and allow it in the review dialog. The dialog rates it **High risk** because it changes what is sent to the model and offers a provider. The provider appears under Settings → Mods → **Providers offered by mods**; it is only added, turned off, when you click **Add**.

Docs: [docs/agent/MODS.md](../../../docs/agent/MODS.md#model-events-subagents-and-providers).
