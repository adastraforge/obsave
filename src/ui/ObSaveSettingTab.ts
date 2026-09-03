import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { extractGitHubOwner } from "../adapters/githubApi";
import { GitHubProvider } from "../providers/GitHubProvider";
import { getVaultFolderName } from "../adapters/vaultPaths";
import type { CloudProviderId } from "../settings";
import { isProviderConfigured, hasProviderCredentials } from "../types";
import {
	formatLocalDateTime,
	formatRelativeSyncTime,
} from "../utils/dateFormat";
import type ObSavePlugin from "../main";

interface ProviderOption {
	id: CloudProviderId;
	name: string;
	description: string;
	logoUrl?: string;
	comingSoon?: boolean;
}

type SettingsView = "home" | "assistant" | "dashboard";
type GitHubRepoMode = "new" | "existing";

const PROVIDER_LABELS: Record<CloudProviderId, string> = {
	github: "GitHub",
	gdrive: "Google Drive",
	onedrive: "OneDrive",
	icloud: "iCloud",
};

const PROVIDER_LOGOS: Partial<Record<CloudProviderId, string>> = {
	gdrive:
		"https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png",
	github: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
};

const PROVIDER_OPTIONS: ProviderOption[] = [
	{
		id: "github",
		name: "GitHub",
		description: "Respalda tu bóveda en un repositorio Git privado.",
		logoUrl: PROVIDER_LOGOS.github,
	},
	{
		id: "gdrive",
		name: "Google Drive",
		description: "Guarda una copia segura en tu nube de Google.",
		logoUrl: PROVIDER_LOGOS.gdrive,
	},
	{
		id: "onedrive",
		name: "OneDrive",
		description: "Microsoft OneDrive — próximamente.",
		comingSoon: true,
	},
	{
		id: "icloud",
		name: "iCloud",
		description: "Apple iCloud — próximamente.",
		comingSoon: true,
	},
];

export class ObSaveSettingTab extends PluginSettingTab {
	plugin: ObSavePlugin;
	private githubProvider: GitHubProvider;
	private currentView: SettingsView = "home";
	private selectedProvider: CloudProviderId | null = null;
	private githubRepoMode: GitHubRepoMode = "new";

	constructor(app: App, plugin: ObSavePlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.githubProvider = plugin.getGitHubProvider();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("obsave-settings");

		this.renderHeader(containerEl);

		switch (this.currentView) {
			case "home":
				this.renderHomeView(containerEl);
				break;
			case "assistant":
				this.renderAssistantView(containerEl);
				break;
			case "dashboard":
				this.renderDashboardView(containerEl);
				break;
		}

		if (this.currentView !== "home") {
			this.renderBackButton(containerEl);
		}

		this.renderFooter(containerEl);
	}

	private renderHeader(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "ObSave" });
		containerEl.createEl("p", {
			text: "Asistente de sincronización en la nube",
			cls: "setting-item-description",
		});
	}

	private renderFooter(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			text: `ObSave v${this.plugin.manifest.version} by Ad Astra Forge`,
			cls: "obsave-footer",
		});
	}

	private renderBackButton(containerEl: HTMLElement): void {
		const nav = containerEl.createDiv({ cls: "obsave-nav-back" });
		const btn = nav.createEl("button", { text: "Atrás", cls: "mod-muted" });
		btn.addEventListener("click", () => {
			this.currentView = "home";
			this.selectedProvider = null;
			this.display();
		});
	}

	private renderSectionHeading(containerEl: HTMLElement, title: string): void {
		containerEl.createEl("h3", {
			text: title,
			cls: "obsave-section-heading",
		});
	}

	/* ── VISTA 1: HOME ── */

	private renderHomeView(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			text: "Elige dónde quieres respaldar tu bóveda.",
			cls: "setting-item-description",
		});
		this.renderProviderGrid(containerEl);
	}

	private renderProviderGrid(containerEl: HTMLElement): void {
		const grid = containerEl.createDiv({ cls: "obsave-provider-grid" });
		const settings = this.plugin.settings;

		for (const option of PROVIDER_OPTIONS) {
			const comingSoon = option.comingSoon === true;
			const connected = hasProviderCredentials(settings, option.id);

			const card = grid.createDiv({
				cls: `obsave-provider-card${comingSoon ? " is-disabled" : ""}`,
			});

			const brandRow = card.createDiv({ cls: "obsave-provider-brand" });
			if (option.logoUrl) {
				const img = brandRow.createEl("img", {
					cls: "obsave-provider-logo",
				});
				img.src = option.logoUrl;
				img.alt = option.name;
				img.width = 32;
				img.height = 32;
			}
			brandRow.createEl("strong", { text: option.name });

			const header = card.createDiv({ cls: "obsave-provider-card-header" });
			if (connected) {
				header.createSpan({
					cls: "obsave-provider-badge is-connected",
					text: "Conectado",
				});
			} else if (comingSoon) {
				header.createSpan({
					cls: "obsave-provider-badge is-soon",
					text: "Próximamente",
				});
			} else {
				header.createSpan({
					cls: "obsave-provider-badge is-unconfigured",
					text: "Sin configurar",
				});
			}

			card.createEl("p", {
				text: option.description,
				cls: "obsave-provider-card-desc setting-item-description",
			});

			if (!comingSoon) {
				card.addEventListener("click", () => {
					this.onProviderCardClick(option.id, connected);
				});
			}
		}
	}

	private onProviderCardClick(
		providerId: CloudProviderId,
		connected: boolean,
	): void {
		this.selectedProvider = providerId;

		if (connected) {
			this.currentView = "dashboard";
			if (this.plugin.settings.activeProvider !== providerId) {
				this.plugin.settings.activeProvider = providerId;
				void this.plugin.saveSettings();
			}
		} else {
			this.currentView = "assistant";
			this.githubRepoMode = "new";
		}

		this.display();
	}

	/* ── VISTA 2: ASISTENTE DE CONEXIÓN ── */

	private renderAssistantView(containerEl: HTMLElement): void {
		const providerId = this.selectedProvider;
		if (!providerId) {
			this.currentView = "home";
			this.display();
			return;
		}

		containerEl.createEl("p", {
			text: `Configura ${PROVIDER_LABELS[providerId]}`,
			cls: "setting-item-description",
		});

		if (providerId === "github") {
			this.renderGitHubAssistant(containerEl);
		} else if (providerId === "gdrive") {
			this.renderGoogleDriveAssistant(containerEl);
		}
	}

	private renderGoogleDriveAssistant(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			text: "Haz clic abajo para vincular tu cuenta de Google Drive en el navegador.",
			cls: "setting-item-description",
		});

		const alertEl = containerEl.createDiv({ cls: "obsave-alert hidden" });

		new Setting(containerEl)
			.setName("Vincular Google Drive")
			.setDesc("Se abrirá el navegador para autorizar el acceso.")
			.addButton((btn) =>
				btn
					.setButtonText("Conectar con Google Drive")
					.setCta()
					.onClick(async () => {
						const blockMsg = this.getOtherProviderBlockMessage("gdrive");
						if (blockMsg) {
							this.showInlineAlert(alertEl, blockMsg);
							return;
						}
						this.hideInlineAlert(alertEl);

						btn.setDisabled(true);
						btn.setButtonText("Conectando…");

						let connected = false;
						try {
							await this.plugin.getGoogleDriveLazy().authenticateWithPkce({
								onAuthSuccess: async (config) => {
									this.plugin.settings.activeProvider = "gdrive";
									this.plugin.settings.providerConfig.gdrive = {
										enabled: true,
										accessToken: config.accessToken,
										refreshToken: config.refreshToken,
										expiresAt: config.expiresAt,
										email: config.email,
										displayName: config.displayName,
										accountEmail: config.accountEmail,
										folderId: config.folderId,
									};
									await this.plugin.saveSettings();
									new Notice(
										"¡Conectado exitosamente con Google Drive!",
									);
									this.currentView = "dashboard";
									this.display();
								},
							});
							connected = true;
						} catch (e) {
							console.error("[ObSave UI Error]", e);
						} finally {
							if (!connected) {
								btn.setDisabled(false);
								btn.setButtonText("Conectar con Google Drive");
							}
						}
					}),
			);
	}

	private renderGitHubAssistant(containerEl: HTMLElement): void {
		const defaultRepoName = this.getDefaultRepoName();
		let username = "";
		let token = "";
		let repoName = defaultRepoName;
		let remoteUrl = "";
		let usernameText: TextComponent | undefined;
		let repoNameText: TextComponent | undefined;
		let remoteUrlText: TextComponent | undefined;

		const alertEl = containerEl.createDiv({ cls: "obsave-alert hidden" });

		new Setting(containerEl)
			.setName("Usuario de GitHub")
			.setDesc("Opcional si tu token ya identifica la cuenta.")
			.addText((text) => {
				usernameText = text;
				text.setPlaceholder("usuario").onChange((v) => {
					username = v;
				});
			});

		new Setting(containerEl)
			.setName("Token de acceso")
			.setDesc("Personal Access Token con permiso de repositorio.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("ghp_…").onChange((v) => {
					token = v;
				});
			});

		const modeSetting = new Setting(containerEl)
			.setName("Tipo de repositorio")
			.setDesc("Elige cómo respaldar tu bóveda en GitHub.");

		modeSetting.addDropdown((dropdown) => {
			dropdown
				.addOption("new", "Crear nuevo repositorio")
				.addOption("existing", "Usar repositorio existente")
				.setValue(this.githubRepoMode)
				.onChange((value) => {
					this.githubRepoMode = value as GitHubRepoMode;
					this.display();
				});
		});

		const repoFields = containerEl.createDiv({ cls: "obsave-github-repo-fields" });

		if (this.githubRepoMode === "new") {
			new Setting(repoFields)
				.setName("Nombre del repositorio")
				.setDesc(`Nombre sugerido: "${defaultRepoName}"`)
				.addText((text) => {
					repoNameText = text;
					text
						.setValue(defaultRepoName)
						.onChange((v) => {
							repoName = v;
						});
				});
		} else {
			new Setting(repoFields)
				.setName("URL / Nombre del repositorio existente")
				.setDesc("Ejemplo: usuario/mi-repo o https://github.com/usuario/mi-repo")
				.addText((text) => {
					remoteUrlText = text;
					text
						.setPlaceholder("usuario/mi-repo")
						.onChange((v) => {
							remoteUrl = v;
							const owner = extractGitHubOwner(v);
							if (owner && usernameText) {
								username = owner;
								usernameText.setValue(owner);
							}
						});
				});
		}

		const primaryLabel =
			this.githubRepoMode === "new"
				? "Crear y sincronizar"
				: "Conectar y sincronizar";

		new Setting(containerEl)
			.addButton((btn) =>
				btn
					.setButtonText(primaryLabel)
					.setCta()
					.onClick(async () => {
						const blockMsg = this.getOtherProviderBlockMessage("github");
						if (blockMsg) {
							this.showInlineAlert(alertEl, blockMsg);
							return;
						}
						this.hideInlineAlert(alertEl);

						if (!token.trim()) {
							new Notice("ObSave: el token es obligatorio.");
							return;
						}

						if (this.githubRepoMode === "existing" && !remoteUrl.trim()) {
							new Notice("ObSave: indica la URL o nombre del repositorio.");
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText(
							this.githubRepoMode === "new"
								? "Sincronizando…"
								: "Conectando…",
						);

						try {
							const result =
								this.githubRepoMode === "new"
									? await this.githubProvider.setupNewRepository({
											username,
											token,
											repoName:
												repoNameText?.getValue().trim() ||
												repoName.trim() ||
												defaultRepoName,
										})
									: await this.githubProvider.setupExistingRepository({
											remoteUrl:
												remoteUrlText?.getValue().trim() ||
												remoteUrl.trim(),
											username,
											token,
										});

							await this.handleSetupResult(result);
						} catch (error) {
							const msg =
								error instanceof Error
									? error.message
									: "Error desconocido";
							new Notice(`ObSave: ${msg}`);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText(primaryLabel);
						}
					}),
			);
	}

	private getDefaultRepoName(): string {
		const vaultName = this.app.vault.getName?.()?.trim();
		if (vaultName) {
			return vaultName;
		}
		return getVaultFolderName(this.app);
	}

	private getOtherProviderBlockMessage(
		targetProvider: CloudProviderId,
	): string | null {
		if (!isProviderConfigured(this.plugin.settings)) {
			return null;
		}

		const active = this.plugin.settings.activeProvider;
		if (!active || active === targetProvider) {
			return null;
		}

		return `Ya tienes ${PROVIDER_LABELS[active]} conectado. Debes desconectarlo primero desde el panel de control.`;
	}

	private showInlineAlert(el: HTMLElement, message: string): void {
		el.empty();
		el.removeClass("hidden");
		el.createSpan({ text: message });
	}

	private hideInlineAlert(el: HTMLElement): void {
		el.empty();
		el.addClass("hidden");
	}

	/* ── VISTA 3: PANEL DE SINCRONIZACIÓN ── */

	private renderDashboardView(containerEl: HTMLElement): void {
		const providerId =
			this.selectedProvider ?? this.plugin.settings.activeProvider;

		if (!providerId || !hasProviderCredentials(this.plugin.settings, providerId)) {
			this.currentView = "home";
			this.display();
			return;
		}

		if (this.plugin.settings.activeProvider !== providerId) {
			this.plugin.settings.activeProvider = providerId;
			void this.plugin.saveSettings();
		}

		this.renderGeneralSection(containerEl, providerId);
		this.renderSyncSection(containerEl);
	}

	private renderGeneralSection(
		containerEl: HTMLElement,
		providerId: CloudProviderId,
	): void {
		this.renderSectionHeading(containerEl, "General");

		const accountLabel = this.getAccountLabel(providerId);
		const card = containerEl.createDiv({ cls: "obsave-status-card" });

		const row = card.createDiv({ cls: "obsave-status-row" });
		row.createSpan({ cls: "obsave-status-label", text: "Proveedor activo" });
		row.createSpan({
			cls: "obsave-status-value",
			text: PROVIDER_LABELS[providerId],
		});

		const accountRow = card.createDiv({ cls: "obsave-status-row" });
		accountRow.createSpan({ cls: "obsave-status-label", text: "Cuenta" });
		accountRow.createSpan({ cls: "obsave-status-value", text: accountLabel });

		const actions = card.createDiv({ cls: "obsave-status-actions" });

		const disconnectBtn = actions.createEl("button", {
			text: "Desconectar",
			cls: "mod-warning obsave-btn-disconnect",
		});
		disconnectBtn.addEventListener("click", async () => {
			disconnectBtn.disabled = true;
			try {
				await this.plugin.disconnectProvider();
				this.currentView = "home";
				this.selectedProvider = null;
				new Notice("ObSave: cuenta desvinculada.");
				this.display();
			} catch (error) {
				const msg =
					error instanceof Error ? error.message : "Error desconocido";
				new Notice(`ObSave: ${msg}`);
			} finally {
				disconnectBtn.disabled = false;
			}
		});
	}

	private getAccountLabel(providerId: CloudProviderId): string {
		const { providerConfig } = this.plugin.settings;

		if (providerId === "gdrive") {
			const g = providerConfig.gdrive;
			return (
				g?.accountEmail ??
				g?.email ??
				g?.displayName ??
				"Cuenta vinculada"
			);
		}

		if (providerId === "github") {
			const gh = providerConfig.github;
			return gh?.username ?? gh?.label ?? gh?.remoteUrl ?? "Cuenta vinculada";
		}

		return "Cuenta vinculada";
	}

	private renderSyncSection(containerEl: HTMLElement): void {
		this.renderSectionHeading(containerEl, "Sincronización");

		const lastSync = this.plugin.settings.lastSyncAt;
		const relative = formatRelativeSyncTime(lastSync);
		const exact = formatLocalDateTime(lastSync);

		new Setting(containerEl)
			.setName("Última sincronización")
			.setDesc(exact === "Nunca" ? "Nunca" : `${relative} (${exact})`)
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Sincronizar ahora")
			.setDesc("Envía los cambios de tu bóveda al proveedor conectado.")
			.addButton((btn) =>
				btn
					.setButtonText("Sincronizar ahora")
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Sincronizando…");
						try {
							await this.plugin.runSync();
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Sincronizar ahora");
							this.display();
						}
					}),
			);

		const intervalSetting = new Setting(containerEl)
			.setName("Sincronización automática")
			.setDesc(
				`Cada ${this.plugin.settings.syncIntervalMinutes} minuto${this.plugin.settings.syncIntervalMinutes === 1 ? "" : "s"}`,
			);

		intervalSetting.addSlider((slider) =>
			slider
				.setLimits(1, 15, 1)
				.setValue(this.plugin.settings.syncIntervalMinutes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.syncIntervalMinutes = value;
					intervalSetting.setDesc(
						`Cada ${value} minuto${value === 1 ? "" : "s"}`,
					);
					await this.plugin.saveSettings();
				}),
		);
	}

	private async handleSetupResult(result: {
		success: boolean;
		message: string;
		githubConfig?: import("../settings").GitHubProviderConfig;
	}): Promise<void> {
		if (!result.success) {
			new Notice(`ObSave: ${result.message}`);
			return;
		}

		if (result.githubConfig) {
			this.plugin.settings.activeProvider = "github";
			this.plugin.settings.providerConfig.github = result.githubConfig;
			await this.plugin.saveSettings();
		}

		new Notice(result.message);
		this.selectedProvider = "github";
		this.currentView = "dashboard";
		this.display();
	}
}
