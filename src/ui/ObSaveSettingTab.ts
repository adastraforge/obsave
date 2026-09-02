import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { extractGitHubOwner } from "../adapters/githubApi";
import { GitHubProvider } from "../providers/GitHubProvider";
import { getVaultFolderName } from "../adapters/vaultPaths";
import type { CloudProviderId } from "../settings";
import { isProviderConfigured, hasProviderCredentials } from "../types";
import { formatLocalDateTime } from "../utils/dateFormat";
import type ObSavePlugin from "../main";
import type { WizardMode } from "../types";

interface ProviderOption {
	id: CloudProviderId;
	name: string;
	description: string;
	comingSoon?: boolean;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
	{
		id: "github",
		name: "GitHub",
		description: "Sincronización Git con Personal Access Token.",
	},
	{
		id: "gdrive",
		name: "Google Drive",
		description: "Respaldo en Drive vía OAuth2 PKCE.",
	},
	{
		id: "onedrive",
		name: "OneDrive",
		description: "OAuth2 PKCE — Fase 2.",
		comingSoon: true,
	},
	{
		id: "icloud",
		name: "iCloud",
		description: "Conector nativo — Fase 2.",
		comingSoon: true,
	},
];

export class ObSaveSettingTab extends PluginSettingTab {
	plugin: ObSavePlugin;
	private githubProvider: GitHubProvider;
	private wizardMode: WizardMode = "select-provider";

	constructor(app: App, plugin: ObSavePlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.githubProvider = plugin.getGitHubProvider();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "ObSave — Sincronización en la nube" });
		containerEl.createEl("p", {
			text: "Ad Astra Forge",
			cls: "setting-item-description",
		});

		if (!isProviderConfigured(this.plugin.settings)) {
			this.renderSetupWizard(containerEl);
		} else {
			this.renderConfiguredView(containerEl);
		}

		this.renderVersionFooter(containerEl);
	}

	private renderVersionFooter(containerEl: HTMLElement): void {
		containerEl.createEl("hr");
		containerEl.createEl("p", {
			text: `ObSave v${this.plugin.manifest.version}`,
			cls: "setting-item-description obsave-version-footer",
		});
	}

	private renderConfiguredView(containerEl: HTMLElement): void {
		const providerId = this.plugin.settings.activeProvider!;
		const github = this.plugin.settings.providerConfig.github;
		const gdrive = this.plugin.settings.providerConfig.gdrive;

		let providerDesc = String(providerId);
		if (providerId === "github" && github) {
			providerDesc = `GitHub — ${github.label} (${github.remoteUrl ?? "sin URL"})`;
		} else if (providerId === "gdrive" && gdrive) {
			providerDesc = `Google Drive — ${gdrive.displayName ?? gdrive.email ?? "Cuenta conectada"}`;
		}

		new Setting(containerEl)
			.setName("Proveedor activo")
			.setDesc(providerDesc)
			.setDisabled(true);

		if (providerId === "gdrive" && gdrive?.email) {
			new Setting(containerEl)
				.setName("Cuenta Google")
				.setDesc(gdrive.email)
				.setDisabled(true);
		}

		new Setting(containerEl)
			.setName("Última sincronización")
			.setDesc(formatLocalDateTime(this.plugin.settings.lastSyncAt))
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Sincronizar ahora")
			.setDesc("Ejecuta un ciclo de sync con el proveedor configurado.")
			.addButton((btn) =>
				btn.setButtonText("Sincronizar").onClick(async () => {
					await this.plugin.runSync();
				}),
			);

		containerEl.createEl("hr");
		this.renderCommonSettings(containerEl);
		this.renderConnectionManagement(containerEl);
	}

	private renderSetupWizard(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "Asistente de primera sincronización" });

		switch (this.wizardMode) {
			case "select-provider":
				containerEl.createEl("p", {
					text: "Elige dónde quieres respaldar tu bóveda. Solo un proveedor puede estar activo a la vez.",
					cls: "setting-item-description",
				});
				this.renderProviderSelection(containerEl);
				break;
			case "choose":
				containerEl.createEl("p", {
					text: "Configura GitHub. Solo necesitas usuario y token — ObSave gestiona Git por ti.",
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
					text: "Conecta tu cuenta de Google para respaldar la bóveda en Drive.",
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
				const badge = header.createSpan({
					cls: "obsave-provider-badge is-connected",
				});
				badge.setText("🟢 Conectado");
			} else if (comingSoon) {
				const badge = header.createSpan({ cls: "obsave-provider-badge is-soon" });
				badge.setText("Próximamente");
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
		if (providerId === "github") {
			this.wizardMode = "choose";
		} else if (providerId === "gdrive") {
			this.wizardMode = "gdrive-setup";
		}
		this.display();
	}

	private renderGoogleDriveSetup(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			text: "PASO 2 — Google Drive",
			cls: "setting-item-heading",
		});

		const existing = this.plugin.settings.providerConfig.gdrive;
		if (existing?.refreshToken) {
			containerEl.createEl("p", {
				text: `Cuenta conectada: ${existing.displayName ?? existing.email ?? "Google"}`,
				cls: "setting-item-description",
			});

			new Setting(containerEl)
				.setName("Activar Google Drive")
				.setDesc("Usa esta cuenta como proveedor activo de ObSave.")
				.addButton((btn) =>
					btn
						.setButtonText("Activar")
						.setCta()
						.onClick(async () => {
							this.plugin.settings.activeProvider = "gdrive";
							await this.plugin.saveSettings();
							new Notice("ObSave: Google Drive activado.");
							this.display();
						}),
				);
			return;
		}

		containerEl.createEl("p", {
			text: "Se abrirá el navegador para autorizar el acceso. ObSave escuchará el callback en http://127.0.0.1:42000/callback.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Autenticación OAuth2")
			.setDesc("PKCE — scope drive.file (solo archivos creados por ObSave).")
			.addButton((btn) =>
				btn
					.setButtonText("Conectar con Google Drive")
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Esperando autorización…");

						try {
							const config =
								await this.plugin
									.getGoogleDriveLazy()
									.authenticateWithPkce();

							this.plugin.settings.activeProvider = "gdrive";
							this.plugin.settings.providerConfig.gdrive = config;
							await this.plugin.saveSettings();

							new Notice(
								`ObSave: conectado como ${config.displayName ?? config.email ?? "Google"}.`,
							);
							this.display();
						} catch (error) {
							const msg =
								error instanceof Error
									? error.message
									: "Error desconocido de OAuth";
							new Notice(`ObSave: ${msg}`);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText("Conectar con Google Drive");
						}
					}),
			);
	}

	private renderBackToProviderSelection(containerEl: HTMLElement): void {
		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("← Volver a selección de proveedor")
				.onClick(() => {
					this.wizardMode = "select-provider";
					this.display();
				}),
		);
	}

	private renderChooseMode(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			text: "PASO 2 — Tipo de bóveda en GitHub",
			cls: "setting-item-heading",
		});

		new Setting(containerEl)
			.setName("Bóveda nueva")
			.setDesc(
				"Crea un repo en GitHub. El nombre puede diferir de la carpeta local de la bóveda.",
			)
			.addButton((btn) =>
				btn.setButtonText("Crear nueva").onClick(() => {
					this.wizardMode = "new-repo";
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Bóveda existente")
			.setDesc(
				"Conecta una URL de GitHub existente. ObSave fusionará remoto y local automáticamente.",
			)
			.addButton((btn) =>
				btn.setButtonText("Conectar existente").onClick(() => {
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

		containerEl.createEl("p", {
			text: "PASO 3-A — Bóveda nueva en GitHub",
			cls: "setting-item-heading",
		});

		new Setting(containerEl)
			.setName("Usuario de GitHub")
			.setDesc("Tu nombre de usuario (opcional si el token lo identifica).")
			.addText((text) =>
				text.setPlaceholder("usuario").onChange((v) => {
					username = v;
				}),
			);

		new Setting(containerEl)
			.setName("Token de acceso")
			.setDesc("Personal Access Token con permisos repo.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("ghp_…").onChange((v) => {
					token = v;
				});
			});

		new Setting(containerEl)
			.setName("Nombre del repositorio")
			.setDesc(
				`Sugerido: "${suggestedName}". Solo afecta el repo en GitHub; la carpeta local no se renombra.`,
			)
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

		containerEl.createEl("p", {
			text: "PASO 3-B — Bóveda existente en GitHub",
			cls: "setting-item-heading",
		});

		let usernameText: TextComponent | undefined;

		new Setting(containerEl)
			.setName("URL del repositorio")
			.setDesc("https://github.com/usuario/repo o git@github.com:usuario/repo")
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
			.setDesc("Opcional si el token identifica la cuenta. Se autocompleta desde la URL.")
			.addText((text) => {
				usernameText = text;
				text.setPlaceholder("usuario").onChange((v) => {
					username = v;
				});
			});

		new Setting(containerEl)
			.setName("Token de acceso")
			.setDesc("Personal Access Token con permisos repo.")
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
					.setButtonText("Conectar y fusionar")
					.setCta()
					.onClick(async () => {
						if (!remoteUrl.trim() || !token.trim()) {
							new Notice("ObSave: URL y token son obligatorios.");
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText("Fusionando…");

						try {
							const result = await this.githubProvider.setupExistingRepository({
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
							btn.setButtonText("Conectar y fusionar");
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
		this.wizardMode = "select-provider";
		this.display();
	}

	private renderCommonSettings(containerEl: HTMLElement): void {
		const intervalSetting = new Setting(containerEl)
			.setName("Intervalo de sincronización")
			.setDesc(
				`Cada ${this.plugin.settings.syncIntervalMinutes} minuto${this.plugin.settings.syncIntervalMinutes === 1 ? "" : "s"}`,
			);

		intervalSetting.addSlider((slider) =>
			slider
				.setLimits(1, 15, 1)
				.setValue(this.plugin.settings.syncIntervalMinutes)
				.setDisplayFormat((value) =>
					value === 1 ? "1 minuto" : `${value} minutos`,
				)
				.onChange(async (value) => {
					this.plugin.settings.syncIntervalMinutes = value;
					intervalSetting.setDesc(
						`Cada ${value} minuto${value === 1 ? "" : "s"}`,
					);
					await this.plugin.saveSettings();
				}),
		);
	}

	private renderConnectionManagement(containerEl: HTMLElement): void {
		containerEl.createEl("hr");
		containerEl.createEl("h3", { text: "Gestión de Conexión" });

		new Setting(containerEl)
			.setName("Desconectar proveedor")
			.setDesc(
				"Elimina la configuración del proveedor activo, credenciales guardadas y vuelve al asistente de primera sincronización. No borra la carpeta .git local (GitHub).",
			)
			.addButton((btn) => {
				btn.setButtonText("Desconectar proveedor");
				btn.buttonEl.addClass("mod-warning");
				btn.onClick(async () => {
					btn.setDisabled(true);
					try {
						await this.plugin.disconnectProvider();
						this.wizardMode = "select-provider";
						new Notice("ObSave: proveedor desconectado.");
						this.display();
					} catch (error) {
						const msg =
							error instanceof Error ? error.message : "Error desconocido";
						new Notice(`ObSave: ${msg}`);
					} finally {
						btn.setDisabled(false);
					}
				});
			});
	}
}
