/** Resultado unificado de un ciclo de sincronización */
export interface SyncResult {
	message: string;
	downloadedCount: number;
	uploadedCount: number;
	noChanges: boolean;
}

/** Contrato común para conectores de nube (Fase 1 GitHub, Fase 2 OAuth) */
export interface IStorageProvider {
	readonly id: string;
	readonly name: string;

	connect(config: unknown): Promise<boolean>;
	sync(): Promise<SyncResult>;
	disconnect(): Promise<void>;
}
