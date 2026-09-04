import { Notice, Plugin, setIcon } from "obsidian";
import { SyncEngine } from "./engine/SyncEngine";
import {
	createProviderRegistry,
	GitHubProvider,
	GoogleDriveLazyProvider,
	type IStorageProvider,
} from "./providers";
import type { CloudProviderId } from "./settings";
import { ObSaveFileStatusDecorator } from "./ui/FileStatusDecorator";
import { ObSaveSettingTab } from "./ui/ObSaveSettingTab";
import { mergeStoredSettings } from "./settingsMerge";
import {
	DEFAULT_SETTINGS,
	clampSyncIntervalSeconds,
	getGitHubConfig,
	getGoogleDriveConfig,
	isProviderConfigured,
	type ObSaveSettings,
	type SyncStatus,
} from "./types";

export default class ObSavePlugin extends Plugin {
	settings: ObSaveSettings = DEFAULT_SETTINGS;
	syncEngine!: SyncEngine;
	private githubProvider!: GitHubProvider;
	private googleDriveLazy!: GoogleDriveLazyProvider;
	private providers!: Map<CloudProviderId, IStorageProvider>;
	private fileDecorators!: ObSaveFileStatusDecorator;
	private ribbonEl: HTMLElement | null = null;
	private settingsTab!: ObSaveSettingTab;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.githubProvider = new GitHubProvider(this.app);
		this.googleDriveLazy = new GoogleDriveLazyProvider();
		this.googleDriveLazy.setConfigChangeListener((config) => {
			this.settings.providerConfig.gdrive = config;
			this.googleDriveLazy.setPendingConfig(config);
			void this.saveSettings();
		});
		this.applyPendingGoogleDriveConfig();

		this.providers = createProviderRegistry(
			this.app,
			this.githubProvider,
			this.googleDriveLazy,
		);
		this.syncEngine = new SyncEngine(this.app, this.settings, this.providers);

		try {
			const githubConfig = getGitHubConfig(this.settings);
			if (githubConfig) {
				void this.githubProvider.connect(githubConfig);
			}
		} catch (error) {
			console.warn("[ObSave] GitHub connect omitido:", error);
		}

		this.fileDecorators = new ObSaveFileStatusDecorator(this);
		this.fileDecorators.install();

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.refreshDecorators()),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (
					file.path.endsWith(".md") &&
					this.syncEngine.getStatus() !== "syncing"
				) {
					void this.refreshDecoratorsImmediate();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (
					file.path.endsWith(".md") &&
					this.syncEngine.getStatus() !== "syncing"
				) {
					void this.refreshDecoratorsImmediate();
				}
			}),
		);

		this.syncEngine.on((event) => {
			if (event.type === "status-changed" && event.status) {
				this.settings.syncStatus = event.status;
				this.updateRibbonIcon(event.status);
			}
			if (event.type === "sync-complete") {
				this.settings.lastSyncAt =
					event.timestamp ?? new Date().toISOString();
				this.settings.syncStatus = "idle";
				void this.saveSettings();

				const message =
					event.message ?? "ObSave: Bóveda al día (sin cambios)";
				console.log(`[ObSave] ${message}`);

				void this.refreshDecoratorsImmediate();
				this.refreshSettingsTab();
				this.updateRibbonIcon("idle");

				if (event.trigger === "manual") {
					const noticeMessage =
						event.message === "¡Sincronización completada exitosamente!"
							? event.message
							: (event.message ?? "ObSave: Bóveda al día (sin cambios)");
					new Notice(noticeMessage);
				}
			}
			if (event.type === "sync-error") {
				this.settings.syncStatus = "error";
				void this.saveSettings();
				console.warn(`[ObSave] ${event.message ?? "Error de sincronización"}`);
				this.updateRibbonIcon("error");
				if (event.trigger === "manual") {
					new Notice(`ObSave: ${event.message ?? "Error de sincronización"}`);
				}
				void this.refreshDecoratorsImmediate();
				this.refreshSettingsTab();
			}
			if (event.type === "sync-skipped" && event.trigger === "manual") {
				new Notice(event.message ?? "ObSave: Sincronización omitida.");
			}
		});

		this.settingsTab = new ObSaveSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		this.ribbonEl = this.addRibbonIcon(
			"cloud",
			"ObSave — Sincronizar ahora",
			async () => {
				if (this.syncEngine.getStatus() !== "syncing") {
					new Notice("ObSave: Iniciando sincronización...");
				}
				await this.syncEngine.executeUnifiedSync("manual");
			},
		);
		this.updateRibbonIcon(this.settings.syncStatus);

		this.startAutoSync();

		console.log("ObSave plugin loaded — Ad Astra Forge");
	}

	onunload(): void {
		this.stopAutoSync();
		this.fileDecorators?.uninstall();
		console.log("ObSave plugin unloaded");
	}

	async loadSettings(): Promise<void> {
		const stored = await this.loadData<Partial<ObSaveSettings>>();
		this.settings = mergeStoredSettings(stored);
		if (this.settings.syncStatus === "syncing") {
			this.settings.syncStatus = "idle";
		}
		this.settings.syncIntervalSeconds = clampSyncIntervalSeconds(
			this.settings.syncIntervalSeconds,
		);
		this.applyPendingGoogleDriveConfig();
	}

	async saveSettings(): Promise<void> {
		this.settings.syncIntervalSeconds = clampSyncIntervalSeconds(
			this.settings.syncIntervalSeconds,
		);
		this.syncEngine?.updateSettings(this.settings);
		this.applyPendingGoogleDriveConfig();

		const githubConfig = getGitHubConfig(this.settings);
		if (githubConfig) {
			void this.githubProvider.connect(githubConfig);
		}

		await this.saveData(this.settings);
		this.restartAutoSync();
		this.updateRibbonIcon(this.settings.syncStatus);
		void this.refreshDecoratorsImmediate();
	}

	/** Guarda config GDrive sin cargar módulos OAuth/Node hasta sync o botón conectar. */
	private applyPendingGoogleDriveConfig(): void {
		try {
			const gdriveConfig = getGoogleDriveConfig(this.settings);
			this.googleDriveLazy?.setPendingConfig(
				gdriveConfig?.refreshToken ? gdriveConfig : null,
			);
		} catch (error) {
			console.warn("[ObSave] Config Google Drive diferida omitida:", error);
		}
	}

	getGitHubProvider(): GitHubProvider {
		return this.githubProvider;
	}

	getGoogleDriveLazy(): GoogleDriveLazyProvider {
		return this.googleDriveLazy;
	}

	isGoogleDriveAvailable(): boolean {
		return !!this.googleDriveLazy;
	}

	/** Refresco diferido de puntos de estado en el Explorador. */
	refreshDecorators(): void {
		this.fileDecorators?.requestRefresh();
	}

	/** Refresco inmediato tras sync o cambios de configuración. */
	refreshDecoratorsImmediate(): Promise<void> {
		return this.fileDecorators?.refresh() ?? Promise.resolve();
	}

	async runSync(): Promise<void> {
		await this.syncEngine.executeUnifiedSync("manual");
	}

	/** Desconecta el proveedor activo y limpia credenciales de sesión */
	async disconnectProvider(): Promise<void> {
		this.syncEngine.cancelActiveSync();
		this.stopAutoSync();

		const active = this.settings.activeProvider;
		if (active) {
			await this.providers.get(active)?.disconnect();
			this.settings.providerConfig[active] = null;
		}

		this.settings.activeProvider = null;
		this.settings.lastSyncAt = null;
		this.settings.syncStatus = "idle";
		this.settings.autoSyncEnabled = false;
		this.settings.syncedLedger = {};
		await this.saveSettings();
		this.updateRibbonIcon(this.settings.syncStatus);
		await this.fileDecorators.refreshDisconnected();
	}

	refreshSettingsTab(): void {
		this.settingsTab?.refreshIfOpen();
	}

	startAutoSync(): void {
		this.syncEngine?.startAutoSync();
	}

	stopAutoSync(): void {
		this.syncEngine?.stopAutoSync();
	}

	restartAutoSync(): void {
		this.syncEngine?.restartAutoSync();
	}

	canAutoSync(): boolean {
		return this.syncEngine?.canAutoSync() ?? false;
	}

	private updateRibbonIcon(status: SyncStatus): void {
		if (!this.ribbonEl) return;

		if (!isProviderConfigured(this.settings)) {
			this.ribbonEl.empty();
			setIcon(this.ribbonEl, "cloud-off");
			this.ribbonEl.setAttribute(
				"aria-label",
				"ObSave — Requiere configuración",
			);
			return;
		}

		if (status === "syncing") {
			this.ribbonEl.empty();
			setIcon(this.ribbonEl, "refresh-cw");
			this.ribbonEl.setAttribute("aria-label", "ObSave — Sincronizando...");
			return;
		}

		this.ribbonEl.empty();
		setIcon(this.ribbonEl, "cloud");
		this.ribbonEl.setAttribute("aria-label", "ObSave — Sincronizar ahora");
	}
}
