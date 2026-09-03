import { App, Modal, Notice, Setting } from "obsidian";
import type { GoogleDriveLazyProvider } from "../providers/GoogleDriveLazyProvider";

export interface GoogleFolderSelection {
	folderId: string;
	folderName: string;
	folderPath: string;
}

/** Modal visual para elegir una carpeta de Google Drive. */
export class GoogleFolderPickerModal extends Modal {
	private folders: { id: string; name: string }[] = [];
	private loading = true;
	private loadError: string | null = null;
	private listContainer: HTMLElement | null = null;

	constructor(
		app: App,
		private gdriveProvider: GoogleDriveLazyProvider,
		private onSelect: (selection: GoogleFolderSelection) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		titleEl.setText("Seleccionar carpeta de Google Drive");

		contentEl.createEl("p", {
			text: "Elige la carpeta donde ObSave guardará tu bóveda.",
			cls: "setting-item-description",
		});

		this.listContainer = contentEl.createDiv({ cls: "obsave-folder-picker-list" });
		void this.loadFolders();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async loadFolders(): Promise<void> {
		if (!this.listContainer) return;

		this.renderLoading();

		try {
			this.folders = await this.gdriveProvider.listFolders();
			this.loading = false;
			this.loadError = null;
			this.renderFolderList();
		} catch (error) {
			this.loading = false;
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
				this.loading = true;
				void this.loadFolders();
			}),
		);
	}

	private renderFolderList(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();

		if (this.folders.length === 0) {
			this.listContainer.createEl("p", {
				text: "No se encontraron carpetas accesibles. Crea una carpeta en Drive o usa el modo «Crear carpeta nueva».",
				cls: "setting-item-description",
			});
			return;
		}

		for (const folder of this.folders) {
			const row = this.listContainer.createDiv({ cls: "obsave-folder-picker-item" });
			row.createSpan({ cls: "obsave-folder-picker-name", text: folder.name });

			const selectBtn = row.createEl("button", { text: "Seleccionar" });
			selectBtn.addEventListener("click", () => {
				this.onSelect({
					folderId: folder.id,
					folderName: folder.name,
					folderPath: `/${folder.name}`,
				});
				new Notice(`Carpeta «${folder.name}» seleccionada.`);
				this.close();
			});
		}
	}
}
