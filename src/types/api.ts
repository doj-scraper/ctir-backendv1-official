export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export type SuccessResponse<T> = {
  success: true;
  data: T;
  meta?: PaginationMeta;
};

export type ErrorResponse = {
  success: false;
  error: string;
  details?: any;
};

export type ApiHandler<T = any> = (
  req: any,
  res: any
) => Promise<ApiResponse<T> | void>;
