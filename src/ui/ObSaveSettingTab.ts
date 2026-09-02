import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { GitAdapter } from "../adapters/GitAdapter";
import { getVaultFolderName } from "../adapters/vaultPaths";
import type ObSavePlugin from "../main";
import type { WizardMode } from "../types";

export class ObSaveSettingTab extends PluginSettingTab {
	plugin: ObSavePlugin;
	private gitAdapter: GitAdapter;
	private wizardMode: WizardMode = "choose";
	private pendingExistingUrl = "";
	private pendingUsername = "";
	private pendingToken = "";

	constructor(app: App, plugin: ObSavePlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.gitAdapter = new GitAdapter(app);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const version = this.plugin.manifest.version;
		containerEl.createEl("h2", {
			text: `ObSave v${version} — Sincronización multi-repositorio`,
		});
		containerEl.createEl("p", {
			text: "Ad Astra Forge",
			cls: "setting-item-description",
		});

		if (!this.plugin.settings.masterRepo) {
			this.renderSetupWizard(containerEl);
		} else {
			this.renderConfiguredView(containerEl);
		}
	}

	private renderConfiguredView(containerEl: HTMLElement): void {
		const master = this.plugin.settings.masterRepo!;

		new Setting(containerEl)
			.setName("Repositorio Master")
			.setDesc(`${master.label} — ${master.remoteUrl ?? master.provider}`)
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Última sincronización")
			.setDesc(this.plugin.settings.lastSyncAt ?? "Nunca")
			.setDisabled(true);

		new Setting(containerEl)
			.setName("Sincronizar ahora")
			.setDesc("Ejecuta un ciclo de sync con el repositorio Master.")
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
		containerEl.createEl("p", {
			text: "Conecta tu bóveda con GitHub. Solo necesitas usuario y token — ObSave gestiona Git por ti.",
			cls: "setting-item-description",
		});

		switch (this.wizardMode) {
			case "choose":
				this.renderChooseMode(containerEl);
				break;
			case "new-repo":
				this.renderNewRepoForm(containerEl);
				break;
			case "existing-repo":
				this.renderExistingRepoForm(containerEl);
				break;
			case "rename-prompt":
				this.renderRenamePrompt(containerEl);
				break;
		}
	}

	private renderChooseMode(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Repositorio nuevo")
			.setDesc(
				"Crea un repo en GitHub con el nombre de tu bóveda (o uno personalizado).",
			)
			.addButton((btn) =>
				btn.setButtonText("Crear nuevo").onClick(() => {
					this.wizardMode = "new-repo";
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Repositorio existente")
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
			text: "PASO 1-A — Repositorio nuevo",
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
			.setName("Nombre del repositorio / carpeta")
			.setDesc(
				`Sugerido: "${suggestedName}". Si lo cambias, la carpeta local se renombrará para coincidir.`,
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
							const result = await this.gitAdapter.setupNewRepository({
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
			text: "PASO 1-B — Repositorio existente",
			cls: "setting-item-heading",
		});

		new Setting(containerEl)
			.setName("URL del repositorio")
			.setDesc("https://github.com/usuario/repo o git@github.com:usuario/repo")
			.addText((text) =>
				text
					.setPlaceholder("https://github.com/usuario/mi-vault")
					.onChange((v) => {
						remoteUrl = v;
					}),
			);

		new Setting(containerEl)
			.setName("Usuario de GitHub")
			.setDesc("Opcional si el token identifica la cuenta.")
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

						const mismatch =
							this.gitAdapter.checkExistingRepoNameMismatch(remoteUrl);

						if (mismatch.needsRenameDecision) {
							this.pendingExistingUrl = remoteUrl;
							this.pendingUsername = username;
							this.pendingToken = token;
							this.wizardMode = "rename-prompt";
							this.display();
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText("Fusionando…");

						try {
							const result = await this.gitAdapter.setupExistingRepository({
								remoteUrl,
								username,
								token,
								renameLocalToMatchRemote: false,
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

	private renderRenamePrompt(containerEl: HTMLElement): void {
		const mismatch = this.gitAdapter.checkExistingRepoNameMismatch(
			this.pendingExistingUrl,
		);

		containerEl.createEl("p", {
			text: "Los nombres no coinciden",
			cls: "setting-item-heading",
		});

		containerEl.createEl("p", {
			text: `Carpeta local: "${mismatch.localFolderName}" — Repositorio remoto: "${mismatch.remoteRepoName}". ¿Desea renombrar la carpeta local para igualar al repositorio?`,
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Renombrar carpeta local")
			.setDesc(
				`Renombrará la bóveda a "${mismatch.remoteRepoName}". Deberá reabrir la bóveda en Obsidian.`,
			)
			.addButton((btn) =>
				btn.setButtonText("Renombrar y continuar").onClick(async () => {
					btn.setDisabled(true);
					try {
						const result = await this.gitAdapter.setupExistingRepository({
							remoteUrl: this.pendingExistingUrl,
							username: this.pendingUsername,
							token: this.pendingToken,
							renameLocalToMatchRemote: true,
						});
						await this.handleSetupResult(result);
					} catch (error) {
						const msg =
							error instanceof Error ? error.message : "Error desconocido";
						new Notice(`ObSave: ${msg}`);
					} finally {
						btn.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl)
			.setName("Mantener nombre local")
			.setDesc("Conserva el nombre actual de la carpeta y continúa la fusión.")
			.addButton((btn) =>
				btn.setButtonText("Mantener y continuar").onClick(async () => {
					btn.setDisabled(true);
					try {
						const result = await this.gitAdapter.setupExistingRepository({
							remoteUrl: this.pendingExistingUrl,
							username: this.pendingUsername,
							token: this.pendingToken,
							renameLocalToMatchRemote: false,
						});
						await this.handleSetupResult(result);
					} catch (error) {
						const msg =
							error instanceof Error ? error.message : "Error desconocido";
						new Notice(`ObSave: ${msg}`);
					} finally {
						btn.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText("Volver").onClick(() => {
				this.wizardMode = "existing-repo";
				this.display();
			}),
		);
	}

	private async handleSetupResult(result: {
		success: boolean;
		message: string;
		needsVaultReopen?: boolean;
		repoConfig?: import("../types").RepoConfig;
	}): Promise<void> {
		if (!result.success) {
			new Notice(`ObSave: ${result.message}`);
			return;
		}

		if (result.repoConfig) {
			this.plugin.settings.masterRepo = result.repoConfig;
			await this.plugin.saveSettings();
		}

		new Notice(result.message);

		if (result.needsVaultReopen) {
			new Notice(
				"ObSave: la bóveda fue renombrada. Reabra la bóveda desde Obsidian (Archivo → Abrir bóveda).",
				10000,
			);
		}

		this.wizardMode = "choose";
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

		containerEl.createEl("p", {
			text: "Fase 1: Git Core Simplificado con Isomorphic-Git",
			cls: "setting-item-description",
		});
	}

	private renderConnectionManagement(containerEl: HTMLElement): void {
		containerEl.createEl("hr");
		containerEl.createEl("h3", { text: "Gestión de Conexión" });

		new Setting(containerEl)
			.setName("Desconectar repositorio")
			.setDesc(
				"Elimina la configuración del Master, credenciales guardadas y vuelve al asistente de primera sincronización. No borra la carpeta .git local.",
			)
			.addButton((btn) => {
				btn.setButtonText("Desconectar repositorio");
				btn.buttonEl.addClass("mod-warning");
				btn.onClick(async () => {
					btn.setDisabled(true);
					try {
						await this.plugin.disconnectRepository();
						this.pendingExistingUrl = "";
						this.pendingUsername = "";
						this.pendingToken = "";
						this.wizardMode = "choose";
						new Notice("ObSave: repositorio desconectado.");
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
