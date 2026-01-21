/**
 * Type declarations for optional lancedb dependency
 * This allows TypeScript to compile even when lancedb is not installed
 */

declare module "lancedb" {
    export interface Connection {
        openTable(name: string): Promise<Table>;
        createTable(name: string, data: any[]): Promise<Table>;
        close(): Promise<void>;
    }

    export interface Table {
        add(data: any[]): Promise<void>;
        delete(filter: string): Promise<void>;
        count(): Promise<number>;
        search(vector: Float32Array): Query;
        query(): Query;
        createIndex(column: string, config?: IndexConfig): Promise<void>;
    }

    export interface Query {
        limit(n: number): Query;
        where(filter: string): Query;
        toArray(): Promise<any[]>;
    }

    export interface IndexConfig {
        type?: "ivf_pq" | "hnsw" | "flat";
        metricType?: "cosine" | "l2" | "dot";
        num_partitions?: number;
        num_sub_vectors?: number;
    }

    export function connect(uri: string): Promise<Connection>;
}
