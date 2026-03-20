export interface EmbeddingResult {
  fileName: string;
  embedding: number[];
  dimensions: number;
}

export interface EmbeddingExtractResponse {
  results: EmbeddingResult[];
  errors: string[];
}

export interface RecognizeFrame {
  name: string;
  data: string;
}

export interface RecognizeBurstRequest {
  frames: RecognizeFrame[];
  minVotes?: number;
  minConfidence?: number;
  registerAttendance: boolean;
}

export interface RecognizeBurstResponse {
  recognized: boolean;
  employee_id: string;
  name: string;
  confidence: number;
  bestFrameConfidence?: number;
  votes: number;
  minVotes: number;
  framesProcessed: number;
  recognizedFrames: number;
  attendanceLogged?: boolean;
  attendanceMessage?: string;
  errors?: string[];
}
