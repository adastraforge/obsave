import { Notice, Plugin, setIcon } from "obsidian";
import { SyncEngine } from "./engine/SyncEngine";
import {
	createProviderRegistry,
	GitHubProvider,
	type IStorageProvider,
} from "./providers";
import type { CloudProviderId } from "./settings";
import { ObSaveFileDecorators } from "./ui/fileDecorators";
import { ObSaveSettingTab } from "./ui/ObSaveSettingTab";
import { mergeStoredSettings } from "./settingsMerge";
import {
	DEFAULT_SETTINGS,
	getGitHubConfig,
	isProviderConfigured,
	type ObSaveSettings,
	type SyncStatus,
} from "./types";

const MIN_SYNC_INTERVAL = 1;
const MAX_SYNC_INTERVAL = 15;

export default class ObSavePlugin extends Plugin {
	settings: ObSaveSettings = DEFAULT_SETTINGS;
	syncEngine!: SyncEngine;
	private githubProvider!: GitHubProvider;
	private providers!: Map<CloudProviderId, IStorageProvider>;
	private fileDecorators!: ObSaveFileDecorators;
	private ribbonEl: HTMLElement | null = null;
	private syncIntervalId: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.githubProvider = new GitHubProvider(this.app);
		this.providers = createProviderRegistry(this.app, this.githubProvider);
		this.syncEngine = new SyncEngine(this.settings, this.providers);
		this.applyProviderConfigToRuntime();

		this.fileDecorators = new ObSaveFileDecorators(this, this.githubProvider);
		this.fileDecorators.install();

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.refreshDecorators()),
		);
		this.registerEvent(
			this.app.vault.on("modify", () => this.refreshDecorators()),
		);

		this.syncEngine.on((event) => {
			if (event.type === "status-changed" && event.status) {
				this.settings.syncStatus = event.status;
				this.updateRibbonIcon(event.status);
			}
			if (event.type === "sync-complete") {
				this.settings.lastSyncAt = new Date().toISOString();
				this.settings.syncStatus = "idle";
				void this.saveSettings();

				const message =
					event.message ?? "ObSave: Bóveda al día (sin cambios)";
				console.log(`[ObSave] ${message}`);

				void this.refreshDecoratorsImmediate();

				if (event.trigger === "manual") {
					new Notice(message);
				}
			}
			if (event.type === "sync-error") {
				this.settings.syncStatus = "error";
				void this.saveSettings();
				new Notice(`ObSave: ${event.message ?? "Error de sincronización"}`);
				void this.refreshDecoratorsImmediate();
			}
		});

		this.addSettingTab(new ObSaveSettingTab(this.app, this));

		this.ribbonEl = this.addRibbonIcon(
			"cloud-download",
			"ObSave — Sincronizar",
			async () => {
				await this.triggerSync(true);
			},
		);
		this.updateRibbonIcon(this.settings.syncStatus);

		this.startSyncInterval();
		if (isProviderConfigured(this.settings)) {
			void this.triggerSync(false);
		}

		console.log("ObSave plugin loaded — Ad Astra Forge");
	}

	onunload(): void {
		this.stopSyncInterval();
		this.fileDecorators?.uninstall();
		console.log("ObSave plugin unloaded");
	}

	async loadSettings(): Promise<void> {
		const stored = await this.loadData<Partial<ObSaveSettings>>();
		this.settings = mergeStoredSettings(stored);
		this.settings.syncIntervalMinutes = this.clampSyncInterval(
			this.settings.syncIntervalMinutes,
		);
		this.applyProviderConfigToRuntime();
	}

	async saveSettings(): Promise<void> {
		this.settings.syncIntervalMinutes = this.clampSyncInterval(
			this.settings.syncIntervalMinutes,
		);
		this.syncEngine?.updateSettings(this.settings);
		this.applyProviderConfigToRuntime();
		await this.saveData(this.settings);
		this.startSyncInterval();
		void this.refreshDecoratorsImmediate();
	}

	private applyProviderConfigToRuntime(): void {
		const githubConfig = getGitHubConfig(this.settings);
		if (githubConfig) {
			void this.githubProvider.connect(githubConfig);
		}
	}

	getGitHubProvider(): GitHubProvider {
		return this.githubProvider;
	}

	/** Refresco diferido de puntos de estado en el Explorador. */
	refreshDecorators(): void {
		this.fileDecorators?.requestRefresh();
	}

	/** Refresco inmediato tras sync o cambios de configuración. */
	refreshDecoratorsImmediate(): Promise<void> {
		return this.fileDecorators?.refresh() ?? Promise.resolve();
	}

	/** Dispara sincronización manual (`true`) o automática (`false`) */
	async triggerSync(manual = false): Promise<void> {
		await this.syncEngine.sync(manual ? "manual" : "automatic");
	}

	async runSync(): Promise<void> {
		await this.triggerSync(true);
	}

	/** Desconecta el proveedor activo y limpia credenciales de sesión */
	async disconnectProvider(): Promise<void> {
		const active = this.settings.activeProvider;
		if (active) {
			await this.providers.get(active)?.disconnect();
			this.settings.providerConfig[active] = null;
		}

		this.settings.activeProvider = null;
		this.settings.lastSyncAt = null;
		this.settings.syncStatus = "idle";
		await this.saveSettings();
		this.updateRibbonIcon("idle");
		void this.refreshDecoratorsImmediate();
	}

	clampSyncInterval(minutes: number): number {
		return Math.min(MAX_SYNC_INTERVAL, Math.max(MIN_SYNC_INTERVAL, minutes));
	}

	startSyncInterval(): void {
		this.stopSyncInterval();
		const minutes = this.settings.syncIntervalMinutes;
		this.syncIntervalId = window.setInterval(
			() => {
				void this.triggerSync(false);
			},
			minutes * 60 * 1000,
		);
	}

	stopSyncInterval(): void {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	private updateRibbonIcon(status: SyncStatus): void {
		if (!this.ribbonEl) return;

		const iconMap: Record<SyncStatus, string> = {
			idle: "cloud",
			syncing: "loader-2",
			error: "cloud-off",
		};

		this.ribbonEl.empty();
		setIcon(this.ribbonEl, iconMap[status]);
		this.ribbonEl.setAttribute(
			"aria-label",
			`ObSave — ${status === "syncing" ? "Sincronizando…" : status === "error" ? "Error de sync" : "Listo"}`,
		);
	}
}
