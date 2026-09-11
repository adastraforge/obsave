import type { App, Editor } from "obsidian";
import { Modal, Setting } from "obsidian";

/** Marcadores de línea que se sustituyen al aplicar uno nuevo. */
const LINE_MARKER_RE = /^(#{1,6} |> |- \[[ xX]\] |[-*+] |\d+\. )/;

/** Envuelve la selección o inserta un marcador de posición ya seleccionado. */
export function applyWrap(
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
export function applyLinePrefix(
	editor: Editor,
	prefix: string,
	numbered = false,
): void {
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
export function insertBlock(
	editor: Editor,
	block: string,
	linesUp?: number,
): void {
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

export function insertCallout(
	editor: Editor,
	type: string,
	title: string,
): void {
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

export function buildTable(rows: number, columns: number): string {
	const header = `| ${Array.from({ length: columns }, (_, i) => `Columna ${i + 1}`).join(" | ")} |`;
	const divider = `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
	const body = Array.from(
		{ length: rows },
		() => `| ${Array.from({ length: columns }, () => "   ").join(" | ")} |`,
	).join("\n");

	return `${header}\n${divider}\n${body}`;
}

/** Diálogo auxiliar para dimensionar la tabla antes de insertarla. */
export class TableBuilderModal extends Modal {
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
