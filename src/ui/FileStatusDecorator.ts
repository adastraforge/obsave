import { TFile } from "obsidian";
import type ObSavePlugin from "../main";
import { resolveStatus } from "../settings";

const DOT_CLASS = "obsave-status-dot";
const FILE_EXPLORER_VIEW = "file-explorer";
	const REFRESH_DELAY_MS = 30;
const TITLE_SELECTOR = ".nav-file-title[data-path], .tree-item-self.nav-file-title[data-path]";

interface ExplorerItem {
	selfEl?: HTMLElement;
	innerEl?: HTMLElement;
	el?: HTMLElement;
	file?: { path: string };
}

interface ExplorerView {
	fileItems?: Record<string, ExplorerItem>;
	containerEl?: HTMLElement;
}

/**
 * Punto de color a la izquierda del nombre de cada nota en el explorador.
 * Lee `estado` desde `metadataCache` y usa el hex configurado.
 */
export class ObSaveFileStatusDecorator {
	private timer: number | null = null;

	constructor(private plugin: ObSavePlugin) {}

	install(): void {
		const { app } = this.plugin;
		const refresh = (): void => this.requestRefresh();

		this.plugin.registerEvent(app.workspace.on("layout-change", refresh));
		this.plugin.registerEvent(app.workspace.on("file-open", refresh));
		this.plugin.registerEvent(app.metadataCache.on("changed", refresh));
		this.plugin.registerEvent(app.metadataCache.on("resolved", refresh));
		this.plugin.registerEvent(app.vault.on("create", refresh));
		this.plugin.registerEvent(app.vault.on("rename", refresh));
		this.plugin.registerEvent(app.vault.on("delete", refresh));

		this.requestRefresh();
	}

	uninstall(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		document.querySelectorAll(`.${DOT_CLASS}`).forEach((dot) => dot.remove());
	}

	requestRefresh(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
		}
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.refresh();
		}, REFRESH_DELAY_MS);
	}

	refresh(): void {
		const { app } = this.plugin;
		const decorated = new Set<HTMLElement>();

		for (const leaf of app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW)) {
			const view = leaf.view as unknown as ExplorerView;
			if (view.fileItems) {
				for (const item of Object.values(view.fileItems)) {
					const path = item.file?.path;
					const host = this.hostForItem(item);
					if (!path || !host) {
						continue;
					}
					this.applyDot(host, path);
					decorated.add(host);
				}
			}

			const root = view.containerEl ?? leaf.view.containerEl;
			for (const title of Array.from(root.querySelectorAll(TITLE_SELECTOR))) {
				if (!(title instanceof HTMLElement)) {
					continue;
				}
				const path = title.getAttribute("data-path");
				if (!path) {
					continue;
				}
				this.applyDot(title, path);
				decorated.add(title);
			}
		}
	}

	private hostForItem(item: ExplorerItem): HTMLElement | null {
		return item.innerEl ?? item.selfEl ?? item.el ?? null;
	}

	private applyDot(host: HTMLElement, path: string): void {
		const { app, settings } = this.plugin;
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== "md") {
			this.removeDot(host);
			return;
		}

		const estado = app.metadataCache.getFileCache(file)?.frontmatter?.estado;
		const status = resolveStatus(estado, settings.statuses);
		if (!status) {
			this.removeDot(host);
			return;
		}

		const inner =
			host.matches(".tree-item-inner, .nav-file-title-content")
				? host
				: (host.querySelector(
						".tree-item-inner, .nav-file-title-content",
					) as HTMLElement | null) ?? host;

		const dot = this.ensureDot(inner);
		dot.style.setProperty("background-color", status.color, "important");
		dot.setAttribute("aria-label", `Estado: ${status.name}`);
		dot.setAttribute("title", status.name);
	}

	private ensureDot(el: HTMLElement): HTMLElement {
		const existing = el.querySelector(`:scope > .${DOT_CLASS}`);
		if (existing instanceof HTMLElement) {
			if (el.firstElementChild !== existing) {
				el.prepend(existing);
			}
			return existing;
		}

		const dot = el.createSpan({ cls: DOT_CLASS });
		el.prepend(dot);
		return dot;
	}

	private removeDot(el: HTMLElement): void {
		el.querySelectorAll(`.${DOT_CLASS}`).forEach((dot) => dot.remove());
	}
}
