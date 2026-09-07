import { App, Modal, Notice, Setting } from "obsidian";
import type { GitHubRepoSummary } from "../oauth/GitHubProvider";
import { listUserRepositories } from "../oauth/GitHubProvider";

export interface GitHubRepoSelection {
	owner: string;
	repo: string;
	fullName: string;
	cloneUrl: string;
	label: string;
}

export class GitHubRepoPickerModal extends Modal {
	private repos: GitHubRepoSummary[] = [];
	private selected: GitHubRepoSelection | null = null;
	private listContainer: HTMLElement | null = null;
	private selectButton: HTMLButtonElement | null = null;

	constructor(
		app: App,
		private token: string,
		private onSelect: (selection: GitHubRepoSelection) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass("obsave-folder-picker-modal");
		titleEl.setText("Seleccionar repositorio de GitHub");

		contentEl.createEl("p", {
			text: "Elige un repositorio existente con permiso de escritura (scope repo).",
			cls: "setting-item-description",
		});

		this.listContainer = contentEl.createDiv({ cls: "obsave-folder-picker-list" });

		const footer = contentEl.createDiv({ cls: "obsave-folder-picker-footer" });
		this.selectButton = footer.createEl("button", {
			text: "Usar este repositorio",
			cls: "mod-cta",
		});
		this.selectButton.disabled = true;
		this.selectButton.addEventListener("click", () => this.confirmSelection());

		void this.loadRepos();
	}

	onClose(): void {
		this.modalEl.removeClass("obsave-folder-picker-modal");
		this.contentEl.empty();
	}

	private confirmSelection(): void {
		if (!this.selected) return;
		this.onSelect(this.selected);
		new Notice(`Repositorio «${this.selected.fullName}» seleccionado.`);
		this.close();
	}

	private async loadRepos(): Promise<void> {
		if (!this.listContainer) return;
		this.renderLoading();

		try {
			this.repos = await listUserRepositories(this.token);
			this.renderList();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Error al cargar repositorios.";
			this.renderError(message);
		}
	}

	private renderLoading(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();
		this.listContainer.createEl("p", {
			text: "Cargando repositorios…",
			cls: "setting-item-description",
		});
	}

	private renderError(message: string): void {
		if (!this.listContainer) return;
		this.listContainer.empty();
		this.listContainer.createEl("p", { text: message, cls: "obsave-alert" });
		new Setting(this.listContainer).addButton((btn) =>
			btn.setButtonText("Reintentar").onClick(() => void this.loadRepos()),
		);
	}

	private renderList(): void {
		if (!this.listContainer) return;
		this.listContainer.empty();

		if (this.repos.length === 0) {
			this.listContainer.createEl("p", {
				text: "No se encontraron repositorios accesibles.",
				cls: "setting-item-description",
			});
			return;
		}

		for (const repo of this.repos) {
			const row = this.listContainer.createDiv({
				cls: "obsave-folder-picker-item",
			});
			row.setAttribute("data-repo-id", String(repo.id));

			row.createSpan({
				cls: "obsave-folder-picker-icon",
				text: repo.private ? "🔒" : "📂",
			});
			row.createSpan({
				cls: "obsave-folder-picker-name",
				text: repo.fullName,
			});

			row.addEventListener("click", () => {
				this.selected = {
					owner: repo.owner,
					repo: repo.name,
					fullName: repo.fullName,
					cloneUrl: repo.cloneUrl,
					label: repo.name,
				};
				if (this.selectButton) this.selectButton.disabled = false;
				this.listContainer
					?.querySelectorAll(".obsave-folder-picker-item")
					.forEach((el) => {
						el.toggleClass(
							"is-selected",
							el.getAttribute("data-repo-id") === String(repo.id),
						);
					});
			});
		}
	}
}
