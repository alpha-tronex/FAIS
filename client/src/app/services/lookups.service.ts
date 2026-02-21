import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type LookupItem = {
  id: number;
  name: string;
  circuitId?: number;
  abbrev?: string;
};

@Injectable({ providedIn: 'root' })
export class LookupsService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  async list(name:
    | 'circuits'
    | 'counties'
    | 'divisions'
    | 'states'
    | 'pay-frequency-types'
    | 'monthly-income-types'
    | 'monthly-deduction-types'
    | 'monthly-household-expense-types'
    | 'assets-types'
    | 'liabilities-types'
    | 'non-marital-types'
  ): Promise<LookupItem[]> {
    return await firstValueFrom(this.http.get<LookupItem[]>(`${this.apiBase}/lookups/${name}`));
  }
}
