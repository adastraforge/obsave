import type { App, WorkspaceLeaf } from "obsidian";
import { ItemView, Notice, setIcon, setTooltip } from "obsidian";
import type ObSavePlugin from "../main";
import { createQuickDailyNote } from "../productivity/noteCapture";
import { CaptureNoteModal } from "./CaptureNoteModal";
import { PlannerView } from "./PlannerView";
import { VaultReportDashboard } from "./VaultReportDashboard";

export const OBSAVE_HUB_VIEW_TYPE = "obsave-hub";

type HubPane = "report" | "planner";

/** Hub lateral de ObSave: informe o planner de tarjetas, con captura. */
export class ObSaveSidebarView extends ItemView {
	private dashboard: VaultReportDashboard | null = null;
	private planner: PlannerView | null = null;
	private pane: HubPane = "report";
	private reportHost: HTMLElement | null = null;
	private plannerHost: HTMLElement | null = null;
	private viewToggle: HTMLElement | null = null;

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
		if (this.pane === "planner") {
			this.planner?.render();
			return;
		}
		if (this.dashboard) {
			this.dashboard.render();
			return;
		}
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.dashboard = null;
		this.planner = null;

		this.renderHeader(contentEl);

		const body = contentEl.createDiv({ cls: "obsave-hub-body" });
		this.reportHost = body.createDiv({ cls: "obsave-hub-pane" });
		this.plannerHost = body.createDiv({ cls: "obsave-hub-pane" });
		this.mountPane();
	}

	private renderHeader(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: "obsave-hub-header" });
		header.createSpan({ cls: "obsave-hub-title", text: "ObSave Hub" });

		this.viewToggle = header.createDiv({ cls: "obsave-view-toggle" });
		this.renderViewButton("report", "bar-chart-3", "Informe");
		this.renderViewButton("planner", "layout-grid", "Planner");

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

	private renderViewButton(pane: HubPane, icon: string, label: string): void {
		const host = this.viewToggle;
		if (!host) {
			return;
		}
		const btn = host.createEl("button", { cls: "obsave-view-toggle-btn" });
		setIcon(btn, icon);
		setTooltip(btn, label);
		btn.setAttribute("aria-label", label);
		btn.setAttribute("aria-pressed", String(this.pane === pane));
		btn.toggleClass("is-active", this.pane === pane);
		btn.addEventListener("click", () => this.setPane(pane));
	}

	private setPane(pane: HubPane): void {
		if (this.pane === pane) {
			return;
		}
		this.pane = pane;
		this.syncViewToggle();
		this.mountPane();
	}

	private syncViewToggle(): void {
		const host = this.viewToggle;
		if (!host) {
			return;
		}
		const buttons = host.querySelectorAll(".obsave-view-toggle-btn");
		buttons[0]?.toggleClass("is-active", this.pane === "report");
		buttons[0]?.setAttribute("aria-pressed", String(this.pane === "report"));
		buttons[1]?.toggleClass("is-active", this.pane === "planner");
		buttons[1]?.setAttribute("aria-pressed", String(this.pane === "planner"));
	}

	private mountPane(): void {
		if (!this.reportHost || !this.plannerHost) {
			return;
		}
		this.reportHost.toggleClass("is-hidden", this.pane !== "report");
		this.plannerHost.toggleClass("is-hidden", this.pane !== "planner");

		if (this.pane === "planner") {
			if (!this.planner) {
				this.planner = new PlannerView(
					this.app,
					this.plannerHost,
					this.plugin.settings,
				);
			}
			this.planner.render();
			return;
		}

		if (!this.dashboard) {
			this.dashboard = new VaultReportDashboard(
				this.app,
				this.reportHost,
				this.plugin.settings,
			);
		}
		this.dashboard.render();
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
