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
import type { WizardMode } from "../types";

interface ProviderOption {
	id: CloudProviderId;
	name: string;
	description: string;
	comingSoon?: boolean;
}

const PROVIDER_LABELS: Record<CloudProviderId, string> = {
	github: "GitHub",
	gdrive: "Google Drive",
	onedrive: "OneDrive",
	icloud: "iCloud",
};

const PROVIDER_OPTIONS: ProviderOption[] = [
	{
		id: "github",
		name: "GitHub",
		description: "Respalda tu bóveda en un repositorio Git privado.",
	},
	{
		id: "gdrive",
		name: "Google Drive",
		description: "Guarda una copia segura en tu nube de Google.",
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
	private wizardMode: WizardMode = "select-provider";
	/** Muestra el selector de proveedores aunque haya uno activo. */
	private showProviderPicker = false;

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

		const hasActiveProvider = isProviderConfigured(this.plugin.settings);
		const showDashboard =
			hasActiveProvider &&
			this.wizardMode === "select-provider" &&
			!this.showProviderPicker;

		if (showDashboard) {
			this.renderDashboard(containerEl);
		} else {
			this.renderSetupFlow(containerEl);
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

	private renderSectionHeading(containerEl: HTMLElement, title: string): void {
		containerEl.createEl("h3", {
			text: title,
			cls: "obsave-section-heading",
		});
	}

	/* ── Panel principal (proveedor conectado) ── */

	private renderDashboard(containerEl: HTMLElement): void {
		this.renderGeneralSection(containerEl);
		this.renderSyncSection(containerEl);
	}

	private renderGeneralSection(containerEl: HTMLElement): void {
		this.renderSectionHeading(containerEl, "General");

		const providerId = this.plugin.settings.activeProvider!;
		const accountLabel = this.getActiveAccountLabel(providerId);
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

		const changeBtn = actions.createEl("button", {
			text: "Cambiar proveedor",
			cls: "mod-muted",
		});
		changeBtn.addEventListener("click", () => {
			this.showProviderPicker = true;
			this.wizardMode = "select-provider";
			this.display();
		});

		const disconnectBtn = actions.createEl("button", {
			text: "Desconectar",
			cls: "mod-warning obsave-btn-disconnect",
		});
		disconnectBtn.addEventListener("click", async () => {
			disconnectBtn.disabled = true;
			try {
				await this.plugin.disconnectProvider();
				this.showProviderPicker = false;
				this.wizardMode = "select-provider";
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

	private getActiveAccountLabel(providerId: CloudProviderId): string {
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

	/* ── Flujo de configuración inicial / cambio de proveedor ── */

	private renderSetupFlow(containerEl: HTMLElement): void {
		if (
			isProviderConfigured(this.plugin.settings) &&
			this.showProviderPicker &&
			this.wizardMode === "select-provider"
		) {
			new Setting(containerEl).addButton((btn) =>
				btn.setButtonText("← Volver al panel").onClick(() => {
					this.showProviderPicker = false;
					this.display();
				}),
			);
		}

		switch (this.wizardMode) {
			case "select-provider":
				containerEl.createEl("p", {
					text: "Elige dónde quieres respaldar tu bóveda.",
					cls: "setting-item-description",
				});
				this.renderProviderSelection(containerEl);
				break;
			case "choose":
				containerEl.createEl("p", {
					text: "Configura tu cuenta de GitHub para respaldar la bóveda.",
					cls: "setting-item-description",
				});
				this.renderBackToProviderSelection(containerEl);
				this.renderChooseMode(containerEl);
				break;
			case "new-repo":
				this.renderBackToProviderSelection(containerEl);
				this.renderNewRepoForm(containerEl);
				break;
			case "existing-repo":
				this.renderBackToProviderSelection(containerEl);
				this.renderExistingRepoForm(containerEl);
				break;
			case "gdrive-setup":
				containerEl.createEl("p", {
					text: "Haz clic abajo para vincular tu cuenta de Google Drive en el navegador.",
					cls: "setting-item-description",
				});
				this.renderBackToProviderSelection(containerEl);
				this.renderGoogleDriveSetup(containerEl);
				break;
		}
	}

	private renderProviderSelection(containerEl: HTMLElement): void {
		const grid = containerEl.createDiv({ cls: "obsave-provider-grid" });
		const settings = this.plugin.settings;

		for (const option of PROVIDER_OPTIONS) {
			const comingSoon = option.comingSoon === true;
			const connected = hasProviderCredentials(settings, option.id);

			const card = grid.createDiv({
				cls: `obsave-provider-card${comingSoon ? " is-disabled" : ""}`,
			});

			const header = card.createDiv({ cls: "obsave-provider-card-header" });
			header.createEl("strong", { text: option.name });

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
					this.onProviderSelected(option.id);
				});
			}
		}
	}

	private onProviderSelected(providerId: CloudProviderId): void {
		this.showProviderPicker = false;

		if (providerId === "github") {
			if (hasProviderCredentials(this.plugin.settings, "github")) {
				void this.activateStoredProvider("github");
				return;
			}
			this.wizardMode = "choose";
		} else if (providerId === "gdrive") {
			this.wizardMode = "gdrive-setup";
		}

		this.display();
	}

	private async activateStoredProvider(providerId: CloudProviderId): Promise<void> {
		this.plugin.settings.activeProvider = providerId;
		await this.plugin.saveSettings();
		new Notice(`ObSave: ${PROVIDER_LABELS[providerId]} activado.`);
		this.display();
	}

	private renderGoogleDriveSetup(containerEl: HTMLElement): void {
		const existing = this.plugin.settings.providerConfig.gdrive;

		if (existing?.refreshToken && existing.enabled !== false) {
			const accountLabel =
				existing.accountEmail ??
				existing.email ??
				existing.displayName ??
				"Google";

			containerEl.createEl("p", {
				text: `Cuenta vinculada: ${accountLabel}`,
				cls: "setting-item-description obsave-gdrive-connected",
			});

			new Setting(containerEl)
				.setName("Usar esta cuenta")
				.setDesc("Activa Google Drive como proveedor de respaldo.")
				.addButton((btn) =>
					btn
						.setButtonText("Activar")
						.setCta()
						.onClick(async () => {
							await this.activateStoredProvider("gdrive");
						}),
				);
			return;
		}

		new Setting(containerEl)
			.setName("Vincular Google Drive")
			.setDesc("Se abrirá el navegador para autorizar el acceso.")
			.addButton((btn) =>
				btn
					.setButtonText("Conectar con Google Drive")
					.setCta()
					.onClick(async () => {
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
									this.showProviderPicker = false;
									this.wizardMode = "select-provider";
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

	private renderBackToProviderSelection(containerEl: HTMLElement): void {
		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("← Volver").onClick(() => {
				this.wizardMode = "select-provider";
				this.display();
			}),
		);
	}

	private renderChooseMode(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Repositorio nuevo")
			.setDesc("Crea un repositorio en GitHub para esta bóveda.")
			.addButton((btn) =>
				btn.setButtonText("Crear nuevo").onClick(() => {
					this.wizardMode = "new-repo";
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Repositorio existente")
			.setDesc("Conecta un repositorio de GitHub que ya tengas.")
			.addButton((btn) =>
				btn.setButtonText("Usar existente").onClick(() => {
					this.wizardMode = "existing-repo";
					this.display();
				}),
			);
	}

	private renderNewRepoForm(containerEl: HTMLElement): void {
		const suggestedName = getVaultFolderName(this.app);
		let username = "";
		let token = "";
		let repoName = suggestedName;

		new Setting(containerEl)
			.setName("Usuario de GitHub")
			.setDesc("Opcional si tu token ya identifica la cuenta.")
			.addText((text) =>
				text.setPlaceholder("usuario").onChange((v) => {
					username = v;
				}),
			);

		new Setting(containerEl)
			.setName("Token de acceso")
			.setDesc("Personal Access Token con permiso de repositorio.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("ghp_…").onChange((v) => {
					token = v;
				});
			});

		new Setting(containerEl)
			.setName("Nombre del repositorio")
			.setDesc(`Sugerido: "${suggestedName}"`)
			.addText((text) =>
				text
					.setValue(suggestedName)
					.onChange((v) => {
						repoName = v;
					}),
			);

		new Setting(containerEl)
			.addButton((btn) =>
				btn.setButtonText("Volver").onClick(() => {
					this.wizardMode = "choose";
					this.display();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Crear y sincronizar")
					.setCta()
					.onClick(async () => {
						if (!token.trim()) {
							new Notice("ObSave: el token es obligatorio.");
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText("Sincronizando…");

						try {
							const result = await this.githubProvider.setupNewRepository({
								username,
								token,
								repoName,
							});
							await this.handleSetupResult(result);
						} catch (error) {
							const msg =
								error instanceof Error ? error.message : "Error desconocido";
							new Notice(`ObSave: ${msg}`);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Crear y sincronizar");
						}
					}),
			);
	}

	private renderExistingRepoForm(containerEl: HTMLElement): void {
		let remoteUrl = "";
		let username = "";
		let token = "";

		let usernameText: TextComponent | undefined;

		new Setting(containerEl)
			.setName("URL del repositorio")
			.setDesc("https://github.com/usuario/mi-vault")
			.addText((text) => {
				text
					.setPlaceholder("https://github.com/usuario/mi-vault")
					.onChange((v) => {
						remoteUrl = v;
						const owner = extractGitHubOwner(v);
						if (owner && usernameText) {
							username = owner;
							usernameText.setValue(owner);
						}
					});
			});

		new Setting(containerEl)
			.setName("Usuario de GitHub")
			.setDesc("Se autocompleta desde la URL si es posible.")
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

		new Setting(containerEl)
			.addButton((btn) =>
				btn.setButtonText("Volver").onClick(() => {
					this.wizardMode = "choose";
					this.display();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Conectar y sincronizar")
					.setCta()
					.onClick(async () => {
						if (!remoteUrl.trim() || !token.trim()) {
							new Notice("ObSave: URL y token son obligatorios.");
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText("Conectando…");

						try {
							const result =
								await this.githubProvider.setupExistingRepository({
									remoteUrl,
									username,
									token,
								});
							await this.handleSetupResult(result);
						} catch (error) {
							const msg =
								error instanceof Error ? error.message : "Error desconocido";
							new Notice(`ObSave: ${msg}`);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Conectar y sincronizar");
						}
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
		this.showProviderPicker = false;
		this.wizardMode = "select-provider";
		this.display();
	}
}
