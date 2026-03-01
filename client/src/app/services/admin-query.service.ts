import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type AdminQueryResponse = {
  results: unknown[];
  count: number;
};

@Injectable({ providedIn: 'root' })
export class AdminQueryService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  query(question: string): Promise<AdminQueryResponse> {
    return firstValueFrom(
      this.http.post<AdminQueryResponse>(`${this.apiBase}/admin/query`, {
        question: question.trim(),
      })
    );
  }
}
