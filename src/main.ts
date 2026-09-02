import { Notice, Plugin, setIcon } from "obsidian";
import { SyncEngine } from "./engine/SyncEngine";
import { ObSaveSettingTab } from "./ui/ObSaveSettingTab";
import {
	DEFAULT_SETTINGS,
	type ObSaveSettings,
	type SyncStatus,
} from "./types";

const MIN_SYNC_INTERVAL = 1;
const MAX_SYNC_INTERVAL = 15;

export default class ObSavePlugin extends Plugin {
	settings: ObSaveSettings = DEFAULT_SETTINGS;
	syncEngine!: SyncEngine;
	private ribbonEl: HTMLElement | null = null;
	private syncIntervalId: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.syncEngine = new SyncEngine(this.settings);
		this.syncEngine.on((event) => {
			if (event.type === "status-changed" && event.status) {
				this.settings.syncStatus = event.status;
				this.updateRibbonIcon(event.status);
			}
			if (event.type === "sync-complete") {
				this.settings.lastSyncAt = event.timestamp;
				this.settings.syncStatus = "idle";
				void this.saveSettings();
				new Notice("ObSave: sincronización completada.");
			}
			if (event.type === "sync-error") {
				this.settings.syncStatus = "error";
				void this.saveSettings();
				new Notice(`ObSave: ${event.message ?? "Error de sincronización"}`);
			}
		});

		this.addSettingTab(new ObSaveSettingTab(this.app, this));

		this.ribbonEl = this.addRibbonIcon(
			"cloud-download",
			"ObSave — Sincronizar",
			async () => {
				await this.triggerSync();
			},
		);
		this.updateRibbonIcon(this.settings.syncStatus);

		this.startSyncInterval();
		void this.triggerSync();

		console.log("ObSave plugin loaded — Ad Astra Forge");
	}

	onunload(): void {
		this.stopSyncInterval();
		console.log("ObSave plugin unloaded");
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
		this.settings.syncIntervalMinutes = this.clampSyncInterval(
			this.settings.syncIntervalMinutes,
		);
	}

	async saveSettings(): Promise<void> {
		this.settings.syncIntervalMinutes = this.clampSyncInterval(
			this.settings.syncIntervalMinutes,
		);
		this.syncEngine?.updateSettings(this.settings);
		await this.saveData(this.settings);
		this.startSyncInterval();
	}

	/** Dispara sincronización manual o automática */
	async triggerSync(): Promise<void> {
		await this.syncEngine.sync();
	}

	async runSync(): Promise<void> {
		await this.triggerSync();
	}

	clampSyncInterval(minutes: number): number {
		return Math.min(MAX_SYNC_INTERVAL, Math.max(MIN_SYNC_INTERVAL, minutes));
	}

	startSyncInterval(): void {
		this.stopSyncInterval();
		const minutes = this.settings.syncIntervalMinutes;
		this.syncIntervalId = window.setInterval(
			() => {
				void this.triggerSync();
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
