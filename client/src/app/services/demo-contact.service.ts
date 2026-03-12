import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type DemoRequestPayload = {
  fullName: string;
  firmName: string;
  workEmail: string;
  phone?: string;
  firmSize: string;
  monthlyAffidavits: string;
  currentSoftware?: string;
  biggestPain: string;
  details?: string;
};

@Injectable({ providedIn: 'root' })
export class DemoContactService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  async submit(payload: DemoRequestPayload): Promise<void> {
    await firstValueFrom(this.http.post(`${this.apiBase}/demo-request`, payload));
  }
}
