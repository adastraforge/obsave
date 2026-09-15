import type { App, WorkspaceLeaf } from "obsidian";
import { ItemView, Notice, setIcon, setTooltip } from "obsidian";
import type ObSavePlugin from "../main";
import { createQuickDailyNote } from "../productivity/noteCapture";
import { CaptureNoteModal } from "./CaptureNoteModal";
import { VaultReportDashboard } from "./VaultReportDashboard";

export const OBSAVE_HUB_VIEW_TYPE = "obsave-hub";

/** Hub lateral de ObSave: accesos de captura sobre el informe operativo. */
export class ObSaveSidebarView extends ItemView {
	private dashboard: VaultReportDashboard | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ObSavePlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return OBSAVE_HUB_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "ObSave Hub";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("obsave-hub");
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	refresh(): void {
		if (this.dashboard) {
			this.dashboard.render();
			return;
		}
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		this.renderHeader(contentEl);

		const body = contentEl.createDiv({ cls: "obsave-hub-body" });
		this.dashboard = new VaultReportDashboard(
			this.app,
			body,
			this.plugin.settings,
		);
		this.dashboard.render();
	}

	private renderHeader(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: "obsave-hub-header" });
		header.createSpan({ cls: "obsave-hub-title", text: "ObSave Hub" });

		const actions = header.createDiv({ cls: "obsave-hub-header-actions" });

		this.addHeaderButton(
			actions,
			"zap",
			"Nota rápida — crea la nota en la raíz de la bóveda",
			() => void createQuickDailyNote(this.app, this.plugin.settings),
		);
		this.addHeaderButton(
			actions,
			"file-plus",
			"Nueva nota — elige carpeta, fecha y etiquetas",
			() => new CaptureNoteModal(this.app, this.plugin).open(),
		);
		this.addHeaderButton(actions, "settings", "Ajustes de ObSave", () =>
			this.plugin.openObSavePanel(),
		);
	}

	private addHeaderButton(
		containerEl: HTMLElement,
		icon: string,
		tooltip: string,
		onClick: () => void,
	): void {
		const btn = containerEl.createEl("button", { cls: "obsave-icon-button" });
		setIcon(btn, icon);
		setTooltip(btn, tooltip);
		btn.setAttribute("aria-label", tooltip);
		btn.addEventListener("click", onClick);
	}
}

/** Abre o revela el hub lateral en la hoja derecha. */
export async function openObSaveHub(app: App): Promise<void> {
	const existing = app.workspace.getLeavesOfType(OBSAVE_HUB_VIEW_TYPE);
	if (existing.length > 0) {
		await app.workspace.revealLeaf(existing[0]);
		return;
	}

	const leaf = app.workspace.getRightLeaf(false);
	if (!leaf) {
		new Notice("ObSave: no se pudo abrir el panel lateral.");
		return;
	}

	await leaf.setViewState({ type: OBSAVE_HUB_VIEW_TYPE, active: true });
	await app.workspace.revealLeaf(leaf);
}
