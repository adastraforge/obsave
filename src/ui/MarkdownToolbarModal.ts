import type { App, Editor } from "obsidian";
import { MarkdownView, Modal, Notice, Setting } from "obsidian";

interface ToolDefinition {
	label: string;
	tooltip: string;
	apply: (editor: Editor) => void;
}

interface ToolGroup {
	title: string;
	tools: ToolDefinition[];
}

/** Marcadores de línea que se sustituyen al aplicar uno nuevo. */
const LINE_MARKER_RE = /^(#{1,6} |> |- \[[ xX]\] |[-*+] |\d+\. )/;

function applyWrap(
	editor: Editor,
	prefix: string,
	suffix: string,
	placeholder: string,
): void {
	const selection = editor.getSelection();
	if (selection) {
		editor.replaceSelection(`${prefix}${selection}${suffix}`);
		return;
	}

	const cursor = editor.getCursor();
	editor.replaceRange(`${prefix}${placeholder}${suffix}`, cursor);
	editor.setSelection(
		{ line: cursor.line, ch: cursor.ch + prefix.length },
		{ line: cursor.line, ch: cursor.ch + prefix.length + placeholder.length },
	);
}

/** Aplica el marcador a las líneas seleccionadas; repetirlo lo retira. */
function applyLinePrefix(editor: Editor, prefix: string, numbered = false): void {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");

	for (let line = from.line; line <= to.line; line++) {
		const text = editor.getLine(line);
		const marker = numbered ? `${line - from.line + 1}. ` : prefix;
		const stripped = text.replace(LINE_MARKER_RE, "");

		editor.setLine(line, text.startsWith(marker) ? stripped : `${marker}${stripped}`);
	}
}

/**
 * Inserta un bloque en líneas propias. Sin `linesUp` el cursor queda al final
 * del bloque; con él sube esa cantidad de líneas (útil en vallas de código).
 */
function insertBlock(editor: Editor, block: string, linesUp?: number): void {
	const cursor = editor.getCursor();
	const currentLine = editor.getLine(cursor.line);
	const lead = currentLine.trim().length > 0 ? "\n" : "";

	editor.replaceSelection(`${lead}${block}`);

	if (linesUp === undefined) {
		return;
	}
	const end = editor.getCursor();
	editor.setCursor({ line: Math.max(end.line - linesUp, 0), ch: 0 });
}

function insertCallout(editor: Editor, type: string, title: string): void {
	const selection = editor.getSelection();
	if (selection) {
		const quoted = selection
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		editor.replaceSelection(`> [!${type}] ${title}\n${quoted}`);
		return;
	}
	insertBlock(editor, `> [!${type}] ${title}\n> `);
}

function buildTable(rows: number, columns: number): string {
	const header = `| ${Array.from({ length: columns }, (_, i) => `Columna ${i + 1}`).join(" | ")} |`;
	const divider = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
	const body = Array.from(
		{ length: rows },
		() => `| ${Array.from({ length: columns }, () => "   ").join(" | ")} |`,
	).join("\n");

	return `${header}\n${divider}\n${body}`;
}

const TOOL_GROUPS: ToolGroup[] = [
	{
		title: "Formato",
		tools: [
			{
				label: "N",
				tooltip: "Negrita — **texto**",
				apply: (e) => applyWrap(e, "**", "**", "texto"),
			},
			{
				label: "C",
				tooltip: "Cursiva — *texto*",
				apply: (e) => applyWrap(e, "*", "*", "texto"),
			},
			{
				label: "S",
				tooltip: "Subrayado — <u>texto</u>",
				apply: (e) => applyWrap(e, "<u>", "</u>", "texto"),
			},
			{
				label: "T",
				tooltip: "Tachado — ~~texto~~",
				apply: (e) => applyWrap(e, "~~", "~~", "texto"),
			},
			{
				label: "==",
				tooltip: "Resaltado — ==texto==",
				apply: (e) => applyWrap(e, "==", "==", "texto"),
			},
			{
				label: "`</>`",
				tooltip: "Código en línea — `código`",
				apply: (e) => applyWrap(e, "`", "`", "código"),
			},
			{
				label: "x²",
				tooltip: "Superíndice — <sup>texto</sup>",
				apply: (e) => applyWrap(e, "<sup>", "</sup>", "2"),
			},
			{
				label: "x₂",
				tooltip: "Subíndice — <sub>texto</sub>",
				apply: (e) => applyWrap(e, "<sub>", "</sub>", "2"),
			},
		],
	},
	{
		title: "Estructura",
		tools: [
			{ label: "H1", tooltip: "Encabezado 1", apply: (e) => applyLinePrefix(e, "# ") },
			{ label: "H2", tooltip: "Encabezado 2", apply: (e) => applyLinePrefix(e, "## ") },
			{ label: "H3", tooltip: "Encabezado 3", apply: (e) => applyLinePrefix(e, "### ") },
			{ label: "H4", tooltip: "Encabezado 4", apply: (e) => applyLinePrefix(e, "#### ") },
			{
				label: "———",
				tooltip: "Separador horizontal",
				apply: (e) => insertBlock(e, "---\n"),
			},
		],
	},
	{
		title: "Listas",
		tools: [
			{
				label: "☐",
				tooltip: "Casilla de verificación — - [ ]",
				apply: (e) => applyLinePrefix(e, "- [ ] "),
			},
			{
				label: "•",
				tooltip: "Lista de viñetas",
				apply: (e) => applyLinePrefix(e, "- "),
			},
			{
				label: "1.",
				tooltip: "Lista numerada",
				apply: (e) => applyLinePrefix(e, "1. ", true),
			},
		],
	},
	{
		title: "Elementos",
		tools: [
			{
				label: "[[ ]]",
				tooltip: "Enlace interno — [[Nota]]",
				apply: (e) => applyWrap(e, "[[", "]]", "Nota"),
			},
			{
				label: "Enlace",
				tooltip: "Enlace externo — [texto](url)",
				apply: (e) => applyWrap(e, "[", "](https://)", "texto"),
			},
			{
				label: "Imagen",
				tooltip: "Imagen — ![alt](url)",
				apply: (e) => applyWrap(e, "![", "](https://)", "alt"),
			},
			{
				label: "❝",
				tooltip: "Cita — > texto",
				apply: (e) => applyLinePrefix(e, "> "),
			},
			{
				label: "```",
				tooltip: "Bloque de código",
				apply: (e) => insertBlock(e, "```\n\n```", 1),
			},
		],
	},
	{
		title: "Callouts",
		tools: [
			{
				label: "Info",
				tooltip: "Callout informativo",
				apply: (e) => insertCallout(e, "info", "Información"),
			},
			{
				label: "Aviso",
				tooltip: "Callout de advertencia",
				apply: (e) => insertCallout(e, "warning", "Atención"),
			},
			{
				label: "Consejo",
				tooltip: "Callout de consejo",
				apply: (e) => insertCallout(e, "tip", "Consejo"),
			},
			{
				label: "Peligro",
				tooltip: "Callout de peligro",
				apply: (e) => insertCallout(e, "danger", "Peligro"),
			},
			{
				label: "Éxito",
				tooltip: "Callout de éxito",
				apply: (e) => insertCallout(e, "success", "Completado"),
			},
		],
	},
	{
		title: "Avanzado",
		tools: [
			{
				label: "LaTeX",
				tooltip: "Fórmula matemática — $$ … $$",
				apply: (e) => insertBlock(e, "$$\n\n$$", 1),
			},
			{
				label: "%% %%",
				tooltip: "Comentario oculto — %% texto %%",
				apply: (e) => applyWrap(e, "%% ", " %%", "comentario"),
			},
		],
	},
];

export class MarkdownToolbarModal extends Modal {
	private target: MarkdownView | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("obsave-toolbar-modal");
		titleEl.setText("Caja de herramientas Markdown");

		// Se captura antes de que el modal tome el foco.
		this.target = this.app.workspace.getActiveViewOfType(MarkdownView);

		this.statusEl = contentEl.createDiv({ cls: "obsave-toolbar-status" });
		this.renderStatus();

		for (const group of TOOL_GROUPS) {
			contentEl.createDiv({
				cls: "obsave-toolbar-group-title",
				text: group.title,
			});
			const grid = contentEl.createDiv({ cls: "obsave-toolbar-grid" });

			for (const tool of group.tools) {
				const btn = grid.createEl("button", {
					cls: "obsave-toolbar-button",
					text: tool.label,
				});
				btn.setAttribute("aria-label", tool.tooltip);
				btn.setAttribute("title", tool.tooltip);
				btn.addEventListener("click", () => this.run(tool.apply));
			}
		}

		contentEl.createDiv({
			cls: "obsave-toolbar-group-title",
			text: "Tabla",
		});
		new Setting(contentEl)
			.setName("Generador de tablas")
			.setTooltip("Inserta una tabla Markdown con cabecera y separador.")
			.addButton((btn) =>
				btn.setButtonText("Crear tabla…").onClick(() => {
					new TableBuilderModal(this.app, (rows, columns) => {
						this.run((editor) =>
							insertBlock(editor, `${buildTable(rows, columns)}\n`),
						);
					}).open();
				}),
			);
	}

	private renderStatus(): void {
		const status = this.statusEl;
		if (!status) return;

		status.empty();
		if (this.target) {
			status.removeClass("obsave-alert");
			status.addClass("setting-item-description");
			status.setText(
				`Editando: ${this.target.file?.basename ?? "nota sin título"}`,
			);
			return;
		}

		status.removeClass("setting-item-description");
		status.addClass("obsave-alert");
		status.setText(
			"Abre una nota en modo edición para usar las herramientas.",
		);
	}

	/** Resuelve el editor destino y devuelve el foco tras aplicar la acción. */
	private run(action: (editor: Editor) => void): void {
		const view =
			this.target ?? this.app.workspace.getActiveViewOfType(MarkdownView);

		if (!view) {
			new Notice("ObSave: no hay ninguna nota abierta en modo edición.");
			return;
		}

		this.target = view;
		action(view.editor);
		view.editor.focus();
		this.renderStatus();
	}

	onClose(): void {
		this.modalEl.removeClass("obsave-toolbar-modal");
		this.contentEl.empty();
	}
}

/** Diálogo auxiliar para dimensionar la tabla antes de insertarla. */
class TableBuilderModal extends Modal {
	private rows = 3;
	private columns = 3;

	constructor(
		app: App,
		private onBuild: (rows: number, columns: number) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		titleEl.setText("Generador de tablas");

		new Setting(contentEl).setName("Columnas").addSlider((slider) =>
			slider
				.setLimits(1, 8, 1)
				.setValue(this.columns)
				.setDynamicTooltip()
				.onChange((value) => {
					this.columns = value;
				}),
		);

		new Setting(contentEl).setName("Filas de datos").addSlider((slider) =>
			slider
				.setLimits(1, 12, 1)
				.setValue(this.rows)
				.setDynamicTooltip()
				.onChange((value) => {
					this.rows = value;
				}),
		);

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancelar").onClick(() => this.close()),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Insertar")
					.setCta()
					.onClick(() => {
						this.close();
						this.onBuild(this.rows, this.columns);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
