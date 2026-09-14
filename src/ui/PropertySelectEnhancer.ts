import { MarkdownView, TFile } from "obsidian";
import type ObSavePlugin from "../main";

const SELECT_CLASS = "obsave-prop-select";

/**
 * Sustituye el input de texto de las propiedades nativas `estado` y `tipo` por
 * un `<select>` con las opciones configuradas, y escribe el cambio vía
 * `processFrontMatter` para que el YAML y el caché se mantengan alineados.
 */
export class PropertySelectEnhancer {
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
			this.plugin.app.metadataCache.on("changed", () => this.scan()),
		);
		window.setTimeout(() => this.scan(), 120);
	}

	refresh(): void {
		this.scan();
	}

	private scan(): void {
		document
			.querySelectorAll(".metadata-property")
			.forEach((node) => {
				if (node instanceof HTMLElement) {
					this.enhance(node);
				}
			});
	}

	private enhance(prop: HTMLElement): void {
		const key = prop.dataset.propertyKey ?? prop.getAttribute("data-property-key");
		if (key !== "estado" && key !== "tipo") {
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
				void this.commit(key, select!.value);
			});
		}

		this.fill(select, options, this.currentValue(valueEl, key));
		this.hideNativeInput(valueEl);
	}

	private optionsFor(key: "estado" | "tipo"): string[] {
		if (key === "estado") {
			return this.plugin.settings.statuses.map((status) => status.name);
		}
		return this.plugin.settings.types.map((type) => type.name);
	}

	private currentValue(valueEl: HTMLElement, key: "estado" | "tipo"): string {
		const file = this.activeFile();
		if (file) {
			const raw =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
			if (typeof raw === "string" && raw.trim()) {
				return raw.trim();
			}
		}
		const input = valueEl.querySelector("input");
		if (input instanceof HTMLInputElement && input.value.trim()) {
			return input.value.trim();
		}
		return this.optionsFor(key)[0] ?? "";
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
		if (current && !Array.from(select.options).some((option) => option.value === current)) {
			select.createEl("option", { text: current, attr: { value: current } });
		}
		if (current) {
			select.value = current;
		}
	}

	private hideNativeInput(valueEl: HTMLElement): void {
		for (const input of Array.from(valueEl.querySelectorAll("input, textarea"))) {
			if (input instanceof HTMLElement) {
				input.addClass("obsave-prop-native-hidden");
			}
		}
	}

	private activeFile(): TFile | null {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file ?? null;
	}

	private async commit(key: string, value: string): Promise<void> {
		const file = this.activeFile();
		if (!file) {
			return;
		}
		await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter[key] = value;
		});
	}
}
