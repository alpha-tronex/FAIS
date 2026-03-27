import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type DocumentListItem = {
  id: string;
  caseId: string;
  originalName: string;
  size: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentQueryResponse = {
  answer: string;
  sources: { documentName: string; page?: number }[];
};

export type DocumentIntakeExtraction = {
  id: string;
  documentId: string;
  caseId: string;
  subjectUserId: string;
  documentType: string;
  status: string;
  extractionVersion: number;
  rawPayload: Record<string, unknown>;
  fieldConfidences: Record<string, number>;
  textQuality: { charCount: number; weak: boolean } | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  listByCase(caseId: string): Promise<DocumentListItem[]> {
    return firstValueFrom(
      this.http.get<DocumentListItem[]>(`${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents`)
    );
  }

  upload(caseId: string, file: File): Promise<{ id: string; caseId: string; originalName: string; size: number; status: string; createdAt: string }> {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(
      this.http.post<{ id: string; caseId: string; originalName: string; size: number; status: string; createdAt: string }>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents`,
        form
      )
    );
  }

  getDownloadUrl(caseId: string, documentId: string): Promise<{ url: string }> {
    return firstValueFrom(
      this.http.get<{ url: string }>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/download`
      )
    );
  }

  retry(caseId: string, documentId: string): Promise<{ id: string; status: string }> {
    return firstValueFrom(
      this.http.post<{ id: string; status: string }>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/retry`,
        {}
      )
    );
  }

  delete(caseId: string, documentId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}`
      )
    );
  }

  query(question: string): Promise<DocumentQueryResponse> {
    return firstValueFrom(
      this.http.post<DocumentQueryResponse>(`${this.apiBase}/documents/query`, { question })
    );
  }

  /** Returns 503 when `DOCUMENT_INTAKE_ENABLED` is not set on the server. */
  listIntakeForCase(caseId: string): Promise<{ extractions: DocumentIntakeExtraction[] }> {
    return firstValueFrom(
      this.http.get<{ extractions: DocumentIntakeExtraction[] }>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/document-intake`
      )
    );
  }

  getIntakeForDocument(caseId: string, documentId: string): Promise<DocumentIntakeExtraction> {
    return firstValueFrom(
      this.http.get<DocumentIntakeExtraction>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/intake`
      )
    );
  }

  /** 202 Accepted — poll `getIntakeForDocument` until status is not `processing`. */
  analyzeIntake(caseId: string, documentId: string): Promise<{ accepted: boolean; documentId: string; message: string }> {
    return firstValueFrom(
      this.http.post<{ accepted: boolean; documentId: string; message: string }>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/intake/analyze`,
        {}
      )
    );
  }

  rejectIntake(caseId: string, documentId: string): Promise<{ ok: boolean; id: string; status: string }> {
    return firstValueFrom(
      this.http.post<{ ok: boolean; id: string; status: string }>(
        `${this.apiBase}/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/intake/reject`,
        {}
      )
    );
  }
}
