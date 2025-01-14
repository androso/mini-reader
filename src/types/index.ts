export interface ProcessQueryRequest {
  fileKey: string;
  collectionName: string;
  query: string;
}

export interface QueryResponse {
  answer?: string;
  source_documents?: string[];
  error?: string;
}

export interface DeleteCollectionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface Metadata {
  title?: string;
  creator?: string;
  identifier?: string;
  //size: number;
}