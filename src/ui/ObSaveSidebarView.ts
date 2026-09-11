import type { App, Editor, WorkspaceLeaf } from "obsidian";
import { ItemView, MarkdownView, Notice, setIcon, setTooltip } from "obsidian";
import type ObSavePlugin from "../main";
import { createQuickDailyNote } from "../productivity/noteCapture";
import { CaptureNoteModal } from "./CaptureNoteModal";
import { VaultReportDashboard } from "./VaultReportDashboard";
import {
	applyLinePrefix,
	applyWrap,
	buildTable,
	insertBlock,
	insertCallout,
	TableBuilderModal,
} from "./markdownEditorTools";

export const OBSAVE_HUB_VIEW_TYPE = "obsave-hub";

export type HubTab = "editor" | "report";

interface ToolDefinition {
	icon: string;
	/** Respaldo visible si el icono Lucide no existe en esta versión de Obsidian. */
	fallback: string;
	tooltip: string;
	apply: (editor: Editor) => void;
}

interface ToolGroup {
	title: string;
	tools: ToolDefinition[];
}

const TOOL_GROUPS: ToolGroup[] = [
	{
		title: "Formato",
		tools: [
			{
				icon: "bold",
				fallback: "N",
				tooltip: "Negrita — **texto**",
				apply: (e) => applyWrap(e, "**", "**", "texto"),
			},
			{
				icon: "italic",
				fallback: "C",
				tooltip: "Cursiva — *texto*",
				apply: (e) => applyWrap(e, "*", "*", "texto"),
			},
			{
				icon: "underline",
				fallback: "S",
				tooltip: "Subrayado — <u>texto</u>",
				apply: (e) => applyWrap(e, "<u>", "</u>", "texto"),
			},
			{
				icon: "strikethrough",
				fallback: "T",
				tooltip: "Tachado — ~~texto~~",
				apply: (e) => applyWrap(e, "~~", "~~", "texto"),
			},
			{
				icon: "highlighter",
				fallback: "==",
				tooltip: "Resaltado — ==texto==",
				apply: (e) => applyWrap(e, "==", "==", "texto"),
			},
			{
				icon: "code",
				fallback: "`",
				tooltip: "Código en línea — `código`",
				apply: (e) => applyWrap(e, "`", "`", "código"),
			},
			{
				icon: "superscript",
				fallback: "x²",
				tooltip: "Superíndice — <sup>2</sup>",
				apply: (e) => applyWrap(e, "<sup>", "</sup>", "2"),
			},
			{
				icon: "subscript",
				fallback: "x₂",
				tooltip: "Subíndice — <sub>2</sub>",
				apply: (e) => applyWrap(e, "<sub>", "</sub>", "2"),
			},
		],
	},
	{
		title: "Estructura",
		tools: [
			{
				icon: "heading-1",
				fallback: "H1",
				tooltip: "Encabezado 1 — # título",
				apply: (e) => applyLinePrefix(e, "# "),
			},
			{
				icon: "heading-2",
				fallback: "H2",
				tooltip: "Encabezado 2 — ## título",
				apply: (e) => applyLinePrefix(e, "## "),
			},
			{
				icon: "heading-3",
				fallback: "H3",
				tooltip: "Encabezado 3 — ### título",
				apply: (e) => applyLinePrefix(e, "### "),
			},
			{
				icon: "heading-4",
				fallback: "H4",
				tooltip: "Encabezado 4 — #### título",
				apply: (e) => applyLinePrefix(e, "#### "),
			},
			{
				icon: "minus",
				fallback: "—",
				tooltip: "Separador horizontal — ---",
				apply: (e) => insertBlock(e, "---\n"),
			},
		],
	},
	{
		title: "Listas",
		tools: [
			{
				icon: "list-todo",
				fallback: "☐",
				tooltip: "Casilla de verificación — - [ ] tarea",
				apply: (e) => applyLinePrefix(e, "- [ ] "),
			},
			{
				icon: "list",
				fallback: "•",
				tooltip: "Lista de viñetas — - elemento",
				apply: (e) => applyLinePrefix(e, "- "),
			},
			{
				icon: "list-ordered",
				fallback: "1.",
				tooltip: "Lista numerada — 1. elemento",
				apply: (e) => applyLinePrefix(e, "1. ", true),
			},
		],
	},
	{
		title: "Elementos",
		tools: [
			{
				icon: "link",
				fallback: "[[ ]]",
				tooltip: "Enlace interno — [[Nota]]",
				apply: (e) => applyWrap(e, "[[", "]]", "Nota"),
			},
			{
				icon: "external-link",
				fallback: "URL",
				tooltip: "Enlace externo — [texto](url)",
				apply: (e) => applyWrap(e, "[", "](https://)", "texto"),
			},
			{
				icon: "image",
				fallback: "IMG",
				tooltip: "Imagen — ![alt](url)",
				apply: (e) => applyWrap(e, "![", "](https://)", "alt"),
			},
			{
				icon: "quote",
				fallback: "❝",
				tooltip: "Cita — > texto",
				apply: (e) => applyLinePrefix(e, "> "),
			},
			{
				icon: "file-code",
				fallback: "```",
				tooltip: "Bloque de código — ``` … ```",
				apply: (e) => insertBlock(e, "```\n\n```", 1),
			},
		],
	},
	{
		title: "Callouts",
		tools: [
			{
				icon: "info",
				fallback: "Info",
				tooltip: "Callout informativo — > [!info]",
				apply: (e) => insertCallout(e, "info", "Información"),
			},
			{
				icon: "alert-triangle",
				fallback: "Aviso",
				tooltip: "Callout de advertencia — > [!warning]",
				apply: (e) => insertCallout(e, "warning", "Atención"),
			},
			{
				icon: "lightbulb",
				fallback: "Tip",
				tooltip: "Callout de consejo — > [!tip]",
				apply: (e) => insertCallout(e, "tip", "Consejo"),
			},
			{
				icon: "flame",
				fallback: "Peligro",
				tooltip: "Callout de peligro — > [!danger]",
				apply: (e) => insertCallout(e, "danger", "Peligro"),
			},
			{
				icon: "check-circle-2",
				fallback: "Éxito",
				tooltip: "Callout de éxito — > [!success]",
				apply: (e) => insertCallout(e, "success", "Completado"),
			},
		],
	},
	{
		title: "Avanzado",
		tools: [
			{
				icon: "sigma",
				fallback: "LaTeX",
				tooltip: "Fórmula matemática — $$ … $$",
				apply: (e) => insertBlock(e, "$$\n\n$$", 1),
			},
			{
				icon: "message-square",
				fallback: "%%",
				tooltip: "Comentario oculto — %% texto %%",
				apply: (e) => applyWrap(e, "%% ", " %%", "comentario"),
			},
		],
	},
];

/**
 * Pinta el icono Lucide y, si esta versión de Obsidian no lo incluye, deja una
 * etiqueta legible en su lugar para que el botón nunca quede vacío.
 */
function applyIconWithFallback(
	el: HTMLElement,
	icon: string,
	fallback: string,
): void {
	setIcon(el, icon);
	if (el.childElementCount === 0) {
		el.setText(fallback);
		el.addClass("is-text-fallback");
	}
}

/** Hub lateral de ObSave: captura, herramientas de edición e informe. */
export class ObSaveSidebarView extends ItemView {
	private activeTab: HubTab = "editor";
	private bodyEl: HTMLElement | null = null;
	private tabButtons = new Map<HubTab, HTMLElement>();
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
		this.renderShell();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	showTab(tab: HubTab): void {
		this.activeTab = tab;
		this.syncTabStyles();
		this.renderBody();
	}

	private renderShell(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.tabButtons.clear();
		this.dashboard = null;

		this.renderHeader(contentEl);
		this.renderTabBar(contentEl);
		this.bodyEl = contentEl.createDiv({ cls: "obsave-hub-body" });
		this.renderBody();
	}

	private renderHeader(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: "obsave-hub-header" });
		header.createSpan({ cls: "obsave-hub-title", text: "ObSave Hub" });

		const actions = header.createDiv({ cls: "obsave-hub-header-actions" });

		this.addHeaderButton(
			actions,
			"pencil-line",
			"Nota rápida — crea y abre una nota diaria",
			() => void createQuickDailyNote(this.app),
		);
		this.addHeaderButton(
			actions,
			"file-plus-2",
			"Captura enriquecida — carpeta, fecha y etiquetas",
			() => new CaptureNoteModal(this.app).open(),
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

	private renderTabBar(containerEl: HTMLElement): void {
		const bar = containerEl.createDiv({ cls: "obsave-hub-tabs" });

		const tabs: { id: HubTab; label: string; icon: string }[] = [
			{ id: "editor", label: "Editor", icon: "pencil-ruler" },
			{ id: "report", label: "Informe", icon: "bar-chart-3" },
		];

		for (const tab of tabs) {
			const btn = bar.createEl("button", { cls: "obsave-hub-tab" });
			const iconEl = btn.createSpan({ cls: "obsave-hub-tab-icon" });
			setIcon(iconEl, tab.icon);
			btn.createSpan({ text: tab.label });
			btn.addEventListener("click", () => this.showTab(tab.id));
			this.tabButtons.set(tab.id, btn);
		}

		this.syncTabStyles();
	}

	private syncTabStyles(): void {
		for (const [id, el] of this.tabButtons) {
			el.toggleClass("is-active", id === this.activeTab);
		}
	}

	private renderBody(): void {
		const body = this.bodyEl;
		if (!body) return;

		body.empty();
		if (this.activeTab === "editor") {
			this.renderEditorTab(body);
			return;
		}

		this.dashboard = new VaultReportDashboard(this.app, body);
		this.dashboard.render();
	}

	private renderEditorTab(containerEl: HTMLElement): void {
		for (const group of TOOL_GROUPS) {
			containerEl.createDiv({
				cls: "obsave-hub-group-title",
				text: group.title,
			});
			const grid = containerEl.createDiv({ cls: "obsave-hub-grid" });

			for (const tool of group.tools) {
				const btn = grid.createEl("button", { cls: "obsave-hub-tool" });
				applyIconWithFallback(btn, tool.icon, tool.fallback);
				setTooltip(btn, tool.tooltip);
				btn.setAttribute("aria-label", tool.tooltip);
				btn.addEventListener("click", () => this.runTool(tool.apply));
			}
		}

		containerEl.createDiv({ cls: "obsave-hub-group-title", text: "Tabla" });
		const tableRow = containerEl.createDiv({ cls: "obsave-hub-grid" });
		const tableBtn = tableRow.createEl("button", { cls: "obsave-hub-tool" });
		applyIconWithFallback(tableBtn, "table", "Tabla");
		setTooltip(tableBtn, "Generador de tablas — | col | col |");
		tableBtn.setAttribute("aria-label", "Generador de tablas");
		tableBtn.addEventListener("click", () => {
			new TableBuilderModal(this.app, (rows, columns) => {
				this.runTool((editor) =>
					insertBlock(editor, `${buildTable(rows, columns)}\n`),
				);
			}).open();
		});
	}

	/** Aplica la herramienta sobre la nota activa y le devuelve el foco. */
	private runTool(action: (editor: Editor) => void): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("ObSave: abre una nota en modo edición para usar esta herramienta.");
			return;
		}

		action(view.editor);
		view.editor.focus();
	}
}

/** Abre o revela el hub lateral en la pestaña indicada. */
export async function openObSaveHub(
	app: App,
	tab: HubTab = "editor",
): Promise<void> {
	const existing = app.workspace.getLeavesOfType(OBSAVE_HUB_VIEW_TYPE);
	if (existing.length > 0) {
		const view = existing[0].view;
		if (view instanceof ObSaveSidebarView) {
			view.showTab(tab);
		}
		await app.workspace.revealLeaf(existing[0]);
		return;
	}

	const leaf = app.workspace.getRightLeaf(false);
	if (!leaf) {
		new Notice("ObSave: no se pudo abrir el panel lateral.");
		return;
	}

	await leaf.setViewState({ type: OBSAVE_HUB_VIEW_TYPE, active: true });
	if (leaf.view instanceof ObSaveSidebarView) {
		leaf.view.showTab(tab);
	}
	await app.workspace.revealLeaf(leaf);
}
