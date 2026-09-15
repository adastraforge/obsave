import { Plugin, TFile, TFolder } from "obsidian";
import { ObSaveSettingTab } from "./ui/ObSaveSettingTab";
import { CaptureNoteModal } from "./ui/CaptureNoteModal";
import {
	OBSAVE_HUB_VIEW_TYPE,
	ObSaveSidebarView,
	openObSaveHub,
} from "./ui/ObSaveSidebarView";
import {
	createCaptureNote,
	createQuickDailyNote,
	registerNotePropertyTypes,
} from "./productivity/noteCapture";
import { ObSaveFileStatusDecorator } from "./ui/FileStatusDecorator";
import { PropertySelectEnhancer } from "./ui/PropertySelectEnhancer";
import {
	DEFAULT_SETTINGS,
	hasLegacySyncPayload,
	mergeStoredSettings,
	type ObSaveSettings,
} from "./settings";

export default class ObSavePlugin extends Plugin {
	settings: ObSaveSettings = {
		statuses: DEFAULT_SETTINGS.statuses.map((status) => ({ ...status })),
		types: DEFAULT_SETTINGS.types.map((type) => ({ ...type })),
	};
	private settingsTab!: ObSaveSettingTab;
	private fileDecorator!: ObSaveFileStatusDecorator;
	private propertySelects!: PropertySelectEnhancer;
	private hubRefreshTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.removeLegacyLedgerFiles();
		await registerNotePropertyTypes(this.app);

		this.fileDecorator = new ObSaveFileStatusDecorator(this);
		this.fileDecorator.install();

		this.propertySelects = new PropertySelectEnhancer(this);
		this.propertySelects.install();

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.notePropertiesChanged(file);
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) {
					return;
				}
				menu.addItem((item) => {
					item
						.setTitle("Nueva nota de ObSave aquí")
						.setIcon("file-plus")
						.onClick(() => {
							void createCaptureNote(this.app, this.settings, {
								folder: file.path,
							});
						});
				});
			}),
		);

		this.registerView(
			OBSAVE_HUB_VIEW_TYPE,
			(leaf) => new ObSaveSidebarView(leaf, this),
		);

		this.registerCommands();

		this.settingsTab = new ObSaveSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		this.addRibbonIcon("layout-dashboard", "ObSave Hub", () =>
			void openObSaveHub(this.app),
		);

		console.log("ObSave plugin loaded — Ad Astra Forge");
	}

	onunload(): void {
		if (this.hubRefreshTimer !== null) {
			window.clearTimeout(this.hubRefreshTimer);
			this.hubRefreshTimer = null;
		}
		this.fileDecorator?.uninstall();
		console.log("ObSave plugin unloaded");
	}

	async loadSettings(): Promise<void> {
		const stored = await this.loadData();
		this.settings = mergeStoredSettings(stored);
		const record = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null;
		if (hasLegacySyncPayload(stored) || !Array.isArray(record?.statuses) || !Array.isArray(record?.types)) {
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		void registerNotePropertyTypes(this.app);
		this.refreshHub();
		this.fileDecorator?.refresh();
		this.propertySelects?.refresh();
	}

	notePropertiesChanged(file?: TFile): void {
		if (file) {
			this.fileDecorator?.refreshPath(file.path);
		}
		this.scheduleHubRefresh();
	}

	private scheduleHubRefresh(): void {
		if (this.hubRefreshTimer !== null) {
			window.clearTimeout(this.hubRefreshTimer);
		}
		this.hubRefreshTimer = window.setTimeout(() => {
			this.hubRefreshTimer = null;
			this.refreshHub();
		}, 80);
	}

	refreshHub(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(OBSAVE_HUB_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof ObSaveSidebarView) {
				view.refresh();
			}
		}
	}

	private async removeLegacyLedgerFiles(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const pluginDir = this.manifest.dir;
		if (!pluginDir) {
			return;
		}

		for (const relative of ["ledger.json", "ledger.json.bak", "ledger.json.tmp"]) {
			const path = `${pluginDir}/${relative}`;
			try {
				if (await adapter.exists(path)) {
					await adapter.remove(path);
				}
			} catch (error) {
				console.warn(`[ObSave] No se pudo eliminar ${relative}:`, error);
			}
		}
	}

	openObSavePanel(): void {
		this.app.setting.open();
		const setting = this.app.setting as typeof this.app.setting & {
			openTabById?: (id: string) => void;
			pluginTabs?: Array<{ id?: string; display: () => void }>;
		};
		if (typeof setting.openTabById === "function") {
			setting.openTabById(this.manifest.id);
		} else {
			setting.pluginTabs
				?.find((tab) => tab.id === this.manifest.id)
				?.display();
		}
		this.settingsTab.openMainPanel();
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open-obsave-panel",
			name: "Abrir panel principal de ObSave",
			callback: () => this.openObSavePanel(),
		});

		this.addCommand({
			id: "obsave-hub",
			name: "Abrir ObSave Hub lateral",
			callback: () => void openObSaveHub(this.app),
		});

		this.addCommand({
			id: "obsave-quick-note",
			name: "Crear nota rápida ObSave",
			callback: () => void createQuickDailyNote(this.app, this.settings),
		});

		this.addCommand({
			id: "obsave-capture-note",
			name: "Crear nueva nota ObSave",
			callback: () => new CaptureNoteModal(this.app, this).open(),
		});
	}
}
