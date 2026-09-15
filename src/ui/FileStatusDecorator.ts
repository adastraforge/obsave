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
 * Se ancla solo a `.nav-file-title[data-path]` con igualdad estricta a `file.path`.
 */
export class ObSaveFileStatusDecorator {
	private timer: number | null = null;
	private pendingPaths: Set<string> | null = null;

	constructor(private plugin: ObSavePlugin) {}

	install(): void {
		const { app } = this.plugin;
		const refreshAll = (): void => this.requestRefresh();

		this.plugin.registerEvent(app.workspace.on("layout-change", refreshAll));
		this.plugin.registerEvent(app.workspace.on("file-open", refreshAll));
		this.plugin.registerEvent(
			app.metadataCache.on("changed", (file) => {
				if (file instanceof TFile) {
					this.requestPathRefresh(file.path);
				}
			}),
		);
		this.plugin.registerEvent(app.metadataCache.on("resolved", refreshAll));
		this.plugin.registerEvent(app.vault.on("create", refreshAll));
		this.plugin.registerEvent(app.vault.on("rename", refreshAll));
		this.plugin.registerEvent(app.vault.on("delete", refreshAll));

		this.requestRefresh();
	}

	uninstall(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		this.pendingPaths = null;
		document.querySelectorAll(`.${DOT_CLASS}`).forEach((dot) => dot.remove());
	}

	requestRefresh(): void {
		this.pendingPaths = null;
		this.scheduleFlush();
	}

	private requestPathRefresh(path: string): void {
		if (this.pendingPaths === null && this.timer !== null) {
			this.scheduleFlush();
			return;
		}
		if (this.pendingPaths === null) {
			this.pendingPaths = new Set();
		}
		this.pendingPaths.add(path);
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
		}
		this.timer = window.setTimeout(() => {
			this.timer = null;
			const paths = this.pendingPaths;
			this.pendingPaths = null;
			if (paths && paths.size > 0) {
				for (const path of paths) {
					this.refreshPath(path);
				}
				return;
			}
			this.refresh();
		}, REFRESH_DELAY_MS);
	}

	refresh(): void {
		const { app } = this.plugin;
		for (const leaf of app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW)) {
			const view = leaf.view as unknown as ExplorerView;
			const root = view.containerEl ?? leaf.view.containerEl;
			const seen = new Set<string>();

			if (view.fileItems) {
				for (const [key, item] of Object.entries(view.fileItems)) {
					const path = key;
					if (!path || seen.has(path)) {
						continue;
					}
					seen.add(path);
					const selfTitle = this.titleFromItem(item, path);
					if (selfTitle) {
						this.applyDot(selfTitle, path);
						continue;
					}
					this.applyPathInRoot(root, path);
				}
			}

			for (const title of this.fileTitles(root)) {
				const path = title.getAttribute("data-path");
				if (!path || seen.has(path)) {
					continue;
				}
				seen.add(path);
				this.applyDot(title, path);
			}
		}
	}

	refreshPath(path: string): void {
		const { app } = this.plugin;
		for (const leaf of app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW)) {
			const view = leaf.view as unknown as ExplorerView;
			const root = view.containerEl ?? leaf.view.containerEl;
			this.applyPathInRoot(root, path);
		}
	}

	private titleFromItem(item: ExplorerItem, path: string): HTMLElement | null {
		const candidates = [item.selfEl, item.innerEl];
		for (const node of candidates) {
			if (!(node instanceof HTMLElement)) {
				continue;
			}
			if (node.matches(TITLE_SELECTOR) && node.getAttribute("data-path") === path) {
				return node;
			}
			const title = node.closest(TITLE_SELECTOR);
			if (
				title instanceof HTMLElement &&
				title.getAttribute("data-path") === path
			) {
				return title;
			}
		}
		return null;
	}

	private applyPathInRoot(root: HTMLElement, path: string): void {
		const titles = this.titlesForPath(root, path);
		if (titles.length === 0) {
			return;
		}
		for (const title of titles) {
			this.applyDot(title, path);
		}
	}

	private fileTitles(root: HTMLElement): HTMLElement[] {
		return Array.from(root.querySelectorAll(TITLE_SELECTOR)).filter(
			(node): node is HTMLElement => node instanceof HTMLElement,
		);
	}

	private titlesForPath(root: HTMLElement, path: string): HTMLElement[] {
		return this.fileTitles(root).filter(
			(title) => title.getAttribute("data-path") === path,
		);
	}

	private applyDot(host: HTMLElement, path: string): void {
		if (host.getAttribute("data-path") !== path || !host.matches(TITLE_SELECTOR)) {
			return;
		}

		const { app, settings } = this.plugin;
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== "md" || file.path !== path) {
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
			(host.querySelector(
				":scope > .tree-item-inner, :scope > .nav-file-title-content",
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
