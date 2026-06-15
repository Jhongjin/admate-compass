export type ChatUiState = "initial-empty" | "answer-pending" | "source-found" | "noData" | "generation-limited" | "error";

export interface ChatSource {
  id: string;
  title: string;
  url?: string;
  updatedAt?: string;
  excerpt: string;
  sourceType?: "file" | "url" | "document" | string;
}

export type CompassReviewPipelineStep = {
  label: string;
  description: string;
  status?: "completed" | "limited" | "attention";
};

export type CompassReviewPipeline = {
  label: string;
  summary: string;
  status: "completed" | "limited" | "blocked" | "error";
  steps: CompassReviewPipelineStep[];
  disclosure?: string;
};
