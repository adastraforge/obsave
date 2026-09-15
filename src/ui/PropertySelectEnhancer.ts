import { MarkdownView, TFile } from "obsidian";
import type ObSavePlugin from "../main";
import {
	canonicalPriorityName,
	canonicalStatusName,
	canonicalTypeName,
	coercePropertyValue,
	NOTE_PRIORITIES,
} from "../settings";
import { writeFrontmatterProperty } from "../utils/frontmatter";

const SELECT_CLASS = "obsave-prop-select";

type PropertyKey = "estado" | "tipo" | "prioridad";

function isPropertyKey(key: string | null | undefined): key is PropertyKey {
	return key === "estado" || key === "tipo" || key === "prioridad";
}

/**
 * Sustituye el input nativo de `estado`/`tipo`/`prioridad` por un `<select>` y persiste
 * de inmediato con `processFrontMatter`.
 *
 * Fuente de verdad del TFile: el leaf Markdown cuyo `containerEl` contiene
 * el widget. `data-file-path` se corrige si está stale; sin leaf contenedor
 * no se escribe YAML.
 */
export class PropertySelectEnhancer {
	private writing = false;

	constructor(private plugin: ObSavePlugin) {}

	install(): void {
		this.plugin.registerDomEvent(document, "focusin", () => this.scan());
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("layout-change", () => this.scan()),
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on("file-open", () => {
				window.setTimeout(() => this.scan(), 60);
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.metadataCache.on("changed", () => {
				if (!this.writing) {
					this.scan();
				}
			}),
		);
		window.setTimeout(() => this.scan(), 120);
	}

	refresh(): void {
		this.scan();
	}

	private scan(): void {
		document.querySelectorAll(".metadata-property").forEach((node) => {
			if (node instanceof HTMLElement) {
				this.enhance(node);
			}
		});
	}

	private enhance(prop: HTMLElement): void {
		const key = prop.dataset.propertyKey ?? prop.getAttribute("data-property-key");
		if (!isPropertyKey(key)) {
			return;
		}

		const options = this.optionsFor(key);
		if (options.length === 0) {
			return;
		}

		const valueEl = prop.querySelector(".metadata-property-value");
		if (!(valueEl instanceof HTMLElement)) {
			return;
		}

		let select = valueEl.querySelector(
			`select.${SELECT_CLASS}`,
		) as HTMLSelectElement | null;
		if (!select) {
			select = valueEl.createEl("select", { cls: SELECT_CLASS });
			select.addEventListener("change", () => {
				void this.commit(select!);
			});
		}

		select.dataset.propertyKey = key;
		const file = this.fileForElement(select);

		if (document.activeElement === select) {
			return;
		}

		this.fill(select, options, this.currentValue(valueEl, key, file));
		this.hideNativeInput(valueEl);
	}

	private optionsFor(key: PropertyKey): string[] {
		if (key === "estado") {
			return this.plugin.settings.statuses.map((status) => status.name);
		}
		if (key === "tipo") {
			return this.plugin.settings.types.map((type) => type.name);
		}
		return NOTE_PRIORITIES.map((item) => item.name);
	}

	private currentValue(
		valueEl: HTMLElement,
		key: PropertyKey,
		file: TFile | null,
	): string {
		if (file) {
			const raw =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
			const canonical = this.canonicalize(key, raw);
			if (canonical) {
				return canonical;
			}
		}
		const input = valueEl.querySelector("input");
		if (input instanceof HTMLInputElement && input.value.trim()) {
			return this.canonicalize(key, input.value) || coercePropertyValue(input.value);
		}
		return this.optionsFor(key)[0] ?? "";
	}

	private canonicalize(key: PropertyKey, raw: unknown): string {
		if (key === "estado") {
			return canonicalStatusName(raw, this.plugin.settings.statuses) ?? "";
		}
		if (key === "tipo") {
			return canonicalTypeName(raw, this.plugin.settings.types) ?? "";
		}
		return canonicalPriorityName(raw);
	}

	private fill(
		select: HTMLSelectElement,
		options: string[],
		current: string,
	): void {
		const existing = Array.from(select.options).map((option) => option.value);
		const same =
			existing.length === options.length &&
			existing.every((value, index) => value === options[index]);
		if (!same) {
			select.empty();
			for (const name of options) {
				select.createEl("option", { text: name, attr: { value: name } });
			}
		}
		const display = this.canonicalize(
			(select.dataset.propertyKey as PropertyKey) ?? "estado",
			current,
		) || current;
		if (display && !Array.from(select.options).some((option) => option.value === display)) {
			select.createEl("option", { text: display, attr: { value: display } });
		}
		if (display) {
			select.value = display;
		}
	}

	private hideNativeInput(valueEl: HTMLElement): void {
		for (const input of Array.from(
			valueEl.querySelectorAll("input, textarea, [contenteditable='true']"),
		)) {
			if (
				input instanceof HTMLElement &&
				!input.classList.contains(SELECT_CLASS)
			) {
				input.addClass("obsave-prop-native-hidden");
			}
		}
	}

	/** Leaf Markdown cuyo containerEl envuelve el widget. Sin fallback a vista activa. */
	private fileFromContainingLeaf(el: HTMLElement): TFile | null {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
			if (
				leaf.view instanceof MarkdownView &&
				leaf.view.file &&
				leaf.view.containerEl.contains(el)
			) {
				return leaf.view.file;
			}
		}
		return null;
	}

	private selectFrom(el: HTMLElement): HTMLSelectElement | null {
		if (el instanceof HTMLSelectElement) {
			return el;
		}
		return el.querySelector(`select.${SELECT_CLASS}`) as HTMLSelectElement | null;
	}

	/**
	 * Fuente de verdad: `view.file` del leaf contenedor.
	 * Si `data-file-path` no coincide, se invalida y se escribe el path del leaf.
	 * Sin leaf contenedor: null (el commit no escribe).
	 */
	private fileForElement(el: HTMLElement): TFile | null {
		const select = this.selectFrom(el);
		const file = this.fileFromContainingLeaf(el);
		if (!file) {
			if (select?.dataset.filePath) {
				delete select.dataset.filePath;
			}
			return null;
		}

		if (select) {
			if (select.dataset.filePath && select.dataset.filePath !== file.path) {
				delete select.dataset.filePath;
			}
			select.dataset.filePath = file.path;
		}

		return file;
	}

	private async commit(select: HTMLSelectElement): Promise<void> {
		const key = select.dataset.propertyKey;
		if (!isPropertyKey(key)) {
			return;
		}

		const file = this.fileForElement(select);
		if (!file) {
			console.warn(
				"[ObSave] Commit abortado: el selector no está en un leaf Markdown válido",
				key,
			);
			return;
		}

		const canonical = this.canonicalize(key, select.value) || select.value;
		if (!canonical) {
			return;
		}

		this.writing = true;
		select.value = canonical;

		try {
			const persisted = await writeFrontmatterProperty(
				this.plugin.app,
				file,
				key,
				canonical,
				this.plugin.settings,
			);
			this.syncHiddenInput(select, persisted);
			this.plugin.notePropertiesChanged(file);
		} catch (error) {
			console.warn("[ObSave] No se pudo guardar la propiedad", key, error);
		} finally {
			window.setTimeout(() => {
				this.writing = false;
			}, 80);
		}
	}

	private syncHiddenInput(select: HTMLSelectElement, value: string): void {
		const valueEl = select.parentElement;
		if (!valueEl) {
			return;
		}
		for (const input of Array.from(valueEl.querySelectorAll("input, textarea"))) {
			if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
				input.value = value;
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
		}
	}
}
