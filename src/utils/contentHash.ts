/** Hash djb2 de contenido textual para el Sync Ledger. */
export function hashContent(content: string): string {
	let hash = 5381;
	for (let i = 0; i < content.length; i++) {
		hash = (hash * 33) ^ content.charCodeAt(i);
	}
	return (hash >>> 0).toString(16);
}
