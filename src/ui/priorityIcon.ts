import { setIcon } from "obsidian";
import type { NotePriority } from "../settings";

export const PRIORITY_ICON_CLASS = "obsave-priority-icon";

/** Triple chevron-up (Lucide no lo incluye). Trazo currentColor. */
const TRIPLE_CHEVRONS_UP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 7-5-5-5 5"/><path d="m17 13-5-5-5 5"/><path d="m17 19-5-5-5 5"/></svg>`;

export function paintPriorityIcon(node: HTMLElement, priority: NotePriority): void {
	node.className = `${PRIORITY_ICON_CLASS} obsave-priority-${priority.id}`;
	node.style.setProperty("color", priority.color, "important");
	node.empty();
	if (!priority.icon) {
		return;
	}
	if (priority.id === "urgente") {
		node.innerHTML = TRIPLE_CHEVRONS_UP;
	} else {
		setIcon(node, priority.icon);
	}
	const svg = node.querySelector("svg");
	if (svg instanceof SVGElement) {
		svg.style.setProperty("stroke", "currentColor", "important");
		svg.style.setProperty("color", "inherit", "important");
	}
}

export function appendPriorityIcon(
	parent: HTMLElement,
	priority: NotePriority,
): HTMLElement | null {
	if (!priority.icon) {
		return null;
	}
	const node = parent.createSpan({ cls: PRIORITY_ICON_CLASS });
	paintPriorityIcon(node, priority);
	node.setAttribute("aria-label", `Prioridad: ${priority.name}`);
	node.setAttribute("title", `Prioridad: ${priority.name}`);
	return node;
}
