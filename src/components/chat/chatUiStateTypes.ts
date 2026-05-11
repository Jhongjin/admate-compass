export type ChatUiState = "initial-empty" | "source-found" | "noData" | "generation-limited" | "error";

export interface ChatSource {
  id: string;
  title: string;
  url?: string;
  updatedAt?: string;
  excerpt: string;
  sourceType?: "file" | "url" | "document" | string;
}
