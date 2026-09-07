import { App, Modal, Setting } from "obsidian";
import { createCaptureNote, listDestinationFolders } from "../productivity/noteCapture";
import { formatTodayDate } from "../utils/frontmatter";

export class CaptureNoteModal extends Modal {
	private title = "";
	private folder = "00_Diarias";
	private fechaAtencion = formatTodayDate();
	private tags = "";

	constructor(
		app: App,
		private onCreated?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		contentEl.empty();
		titleEl.setText("Captura de nota enriquecida");

		new Setting(contentEl)
			.setName("Título")
			.setDesc("Opcional. Si queda vacío se generará un nombre automático.")
			.addText((text) =>
				text.setPlaceholder("Mi nota").onChange((v) => {
					this.title = v;
				}),
			);

		const folders = listDestinationFolders(this.app);
		new Setting(contentEl)
			.setName("Carpeta destino")
			.addDropdown((dropdown) => {
				for (const folder of folders) {
					dropdown.addOption(folder, folder);
				}
				dropdown.setValue(this.folder).onChange((v) => {
					this.folder = v;
				});
			});

		new Setting(contentEl)
			.setName("Fecha de atención")
			.addText((text) =>
				text
					.setValue(this.fechaAtencion)
					.setPlaceholder("YYYY-MM-DD")
					.onChange((v) => {
						this.fechaAtencion = v;
					}),
			);

		new Setting(contentEl)
			.setName("Tags adicionales")
			.setDesc("Separados por coma (ej. #urgente, #cliente)")
			.addText((text) =>
				text.setPlaceholder("#urgente").onChange((v) => {
					this.tags = v;
				}),
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Crear nota")
				.setCta()
				.onClick(async () => {
					btn.setDisabled(true);
					try {
						const extraTags = this.tags
							.split(",")
							.map((tag) => tag.trim())
							.filter(Boolean);
						await createCaptureNote(this.app, {
							title: this.title,
							folder: this.folder,
							fechaAtencion: this.fechaAtencion,
							extraTags,
						});
						this.onCreated?.();
						this.close();
					} finally {
						btn.setDisabled(false);
					}
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
