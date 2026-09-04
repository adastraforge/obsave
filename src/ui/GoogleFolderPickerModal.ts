import { App, Modal, Notice, Setting } from "obsidian";
import type { GoogleDriveFolderEntry } from "../providers/GoogleDriveProvider";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";

export interface GoogleFolderSelection {
	folderId: string;
	folderName: string;
	folderPath: string;
}

interface BreadcrumbSegment {
	id: string;
	name: string;
}

/** Modal con navegación jerárquica tipo explorador para elegir carpeta en Drive. */
export class GoogleFolderPickerModal extends Modal {
	private folders: GoogleDriveFolderEntry[] = [];
	private loadError: string | null = null;
	private breadcrumbEl: HTMLElement | null = null;
	private listContainer: HTMLElement | null = null;
	private selectButton: HTMLButtonElement | null = null;

	private breadcrumbs: BreadcrumbSegment[] = [{ id: "root", name: "Mi unidad" }];
	private currentFolderId = "root";
	private selectedFolder: GoogleFolderSelection | null = null;

	constructor(
		app: App,
		private gdriveProvider: GoogleDriveLazyProvider,
		private onSelect: (selection: GoogleFolderSelection) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("obsave-folder-picker-modal");
		titleEl.setText("Seleccionar carpeta de Google Drive");

		contentEl.createEl("p", {
			text: "Navega por tus carpetas y elige dónde guardar tu bóveda.",
			cls: "setting-item-description",
		});

		this.breadcrumbEl = contentEl.createDiv({
			cls: "obsave-folder-picker-breadcrumbs",
		});
		this.listContainer = contentEl.createDiv({ cls: "obsave-folder-picker-list" });

		const footer = contentEl.createDiv({ cls: "obsave-folder-picker-footer" });
		this.selectButton = footer.createEl("button", {
			text: "Seleccionar esta carpeta",
			cls: "mod-cta",
		});
		this.selectButton.disabled = true;
		this.selectButton.addEventListener("click", () => this.confirmSelection());

		this.renderBreadcrumbs();
		void this.loadCurrentDirectory();
	}

	onClose(): void {
		this.modalEl.removeClass("obsave-folder-picker-modal");
		this.contentEl.empty();
	}

	private confirmSelection(): void {
		if (!this.selectedFolder) return;

		this.onSelect(this.selectedFolder);
		new Notice(`Carpeta «${this.selectedFolder.folderName}» seleccionada.`);
		this.close();
	}

	private updateSelectButton(): void {
		if (!this.selectButton) return;
		this.selectButton.disabled = !this.selectedFolder;
	}

	private buildPathFromBreadcrumbs(extraFolderName?: string): string {
		const parts = this.breadcrumbs
			.filter((segment) => segment.id !== "root")
			.map((segment) => segment.name);
		if (extraFolderName) {
			parts.push(extraFolderName);
		}
		return parts.length > 0 ? `/${parts.join("/")}` : "/";
	}

	private selectCurrentDirectory(): void {
		const current = this.breadcrumbs[this.breadcrumbs.length - 1];
		if (current.id === "root") return;

		this.selectedFolder = {
			folderId: current.id,
			folderName: current.name,
			folderPath: this.buildPathFromBreadcrumbs(),
		};
		this.updateSelectButton();
		this.highlightSelectedRow(current.id);
	}

	private setSelectedFolder(folderId: string, folderName: string): void {
		const parts = this.breadcrumbs
			.filter((segment) => segment.id !== "root")
			.map((segment) => segment.name);
		parts.push(folderName);
		this.selectedFolder = {
			folderId,
			folderName,
			folderPath: parts.length > 0 ? `/${parts.join("/")}` : `/${folderName}`,
		};
		this.updateSelectButton();
		this.highlightSelectedRow(folderId);
	}

	private highlightSelectedRow(folderId: string): void {
		if (!this.listContainer) return;
		this.listContainer
			.querySelectorAll(".obsave-folder-picker-item")
			.forEach((row) => {
				row.toggleClass(
					"is-selected",
					row.getAttribute("data-folder-id") === folderId,
				);
			});
	}

	private renderBreadcrumbs(): void {
		if (!this.breadcrumbEl) return;
		this.breadcrumbEl.empty();

		this.breadcrumbs.forEach((segment, index) => {
			if (index > 0) {
				this.breadcrumbEl!.createSpan({
					cls: "obsave-folder-picker-crumb-sep",
					text: " › ",
				});
			}

			const crumb = this.breadcrumbEl!.createSpan({
				cls: "obsave-folder-picker-crumb",
				text: segment.name,
			});

			if (index < this.breadcrumbs.length - 1) {
				crumb.addClass("is-clickable");
				crumb.addEventListener("click", () => {
					this.navigateToBreadcrumb(index);
				});
			} else {
				crumb.addClass("is-current");
				if (segment.id !== "root") {
					crumb.addClass("is-clickable");
					crumb.setAttribute("title", "Seleccionar esta carpeta");
					crumb.addEventListener("click", () => {
						this.selectCurrentDirectory();
					});
				}
			}
		});
	}

	private navigateToBreadcrumb(index: number): void {
		this.breadcrumbs = this.breadcrumbs.slice(0, index + 1);
		this.currentFolderId = this.breadcrumbs[index].id;
		this.selectedFolder = null;
		this.updateSelectButton();
		this.renderBreadcrumbs();
		void this.loadCurrentDirectory();
	}

	private navigateInto(folder: GoogleDriveFolderEntry): void {
		this.breadcrumbs.push({ id: folder.id, name: folder.name });
		this.currentFolderId = folder.id;
		this.selectedFolder = null;
		this.updateSelectButton();
		this.renderBreadcrumbs();
		void this.loadCurrentDirectory();
	}

	private goUp(): void {
		if (this.breadcrumbs.length <= 1) return;
		this.breadcrumbs.pop();
		this.currentFolderId = this.breadcrumbs[this.breadcrumbs.length - 1].id;
		this.selectedFolder = null;
		this.updateSelectButton();
		this.renderBreadcrumbs();
		void this.loadCurrentDirectory();
	}

	private async loadCurrentDirectory(): Promise<void> {
		if (!this.listContainer) return;

		this.renderLoading();

		try {
			this.folders = await this.gdriveProvider.listFoldersInParent(
				this.currentFolderId,
			);
			this.loadError = null;
			this.renderFolderList();
		} catch (error) {
			this.loadError =
				error instanceof Error ? error.message : "Error al listar carpetas.";
			this.renderError();
		}
	}

	private renderLoading(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();
		this.listContainer.createEl("p", {
			text: "Cargando carpetas…",
			cls: "setting-item-description",
		});
	}

	private renderError(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();
		this.listContainer.createEl("p", {
			text: this.loadError ?? "Error desconocido.",
			cls: "obsave-alert",
		});

		new Setting(this.listContainer).addButton((btn) =>
			btn.setButtonText("Reintentar").onClick(() => {
				void this.loadCurrentDirectory();
			}),
		);
	}

	private renderFolderList(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();

		if (this.currentFolderId !== "root") {
			const upRow = this.listContainer.createDiv({
				cls: "obsave-folder-picker-item obsave-folder-picker-up",
			});
			upRow.createSpan({
				cls: "obsave-folder-picker-icon",
				text: "📁",
			});
			upRow.createSpan({
				cls: "obsave-folder-picker-name",
				text: ".. (Subir nivel)",
			});
			upRow.addEventListener("click", () => this.goUp());
		}

		if (this.folders.length === 0) {
			this.listContainer.createEl("p", {
				text: "No hay subcarpetas en este directorio.",
				cls: "setting-item-description obsave-folder-picker-empty",
			});
			return;
		}

		for (const folder of this.folders) {
			const row = this.listContainer.createDiv({
				cls: "obsave-folder-picker-item",
			});
			row.setAttribute("data-folder-id", folder.id);

			const icon = row.createSpan({
				cls: "obsave-folder-picker-icon is-navigable",
				text: "📁",
			});
			icon.addEventListener("click", (event) => {
				event.stopPropagation();
				this.navigateInto(folder);
			});

			row.createSpan({
				cls: "obsave-folder-picker-name",
				text: folder.name,
			});

			row.addEventListener("click", () => {
				this.setSelectedFolder(folder.id, folder.name);
			});

			row.addEventListener("dblclick", (event) => {
				event.preventDefault();
				this.navigateInto(folder);
			});

			if (this.selectedFolder?.folderId === folder.id) {
				row.addClass("is-selected");
			}
		}
	}
}
