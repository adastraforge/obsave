import { Plugin } from "obsidian";
import { ObSaveSettingTab } from "./ui/ObSaveSettingTab";
import { CaptureNoteModal } from "./ui/CaptureNoteModal";
import {
	OBSAVE_HUB_VIEW_TYPE,
	ObSaveSidebarView,
	openObSaveHub,
} from "./ui/ObSaveSidebarView";
import { createQuickDailyNote } from "./productivity/noteCapture";
import { installNoteTypeRenameListener } from "./productivity/noteTypeRename";

export default class ObSavePlugin extends Plugin {
	private settingsTab!: ObSaveSettingTab;

	async onload(): Promise<void> {
		await this.wipeLegacyRemoteState();

		installNoteTypeRenameListener(this.app, (event) => this.registerEvent(event));

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
		console.log("ObSave plugin unloaded");
	}

	/**
	 * v2.0.0 elimina la capa remota: borra tokens, ledger y ajustes de sync
	 * que pudieran quedar en data.json o junto al plugin.
	 */
	private async wipeLegacyRemoteState(): Promise<void> {
		const stored = await this.loadData();
		if (stored && typeof stored === "object") {
			await this.saveData({});
		}

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
			callback: () => void createQuickDailyNote(this.app),
		});

		this.addCommand({
			id: "obsave-capture-note",
			name: "Crear nueva nota ObSave",
			callback: () => new CaptureNoteModal(this.app).open(),
		});
	}
}
