/**
 * Shared API response contracts
 */

export interface DemoResponse {
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: ApiError;
}
