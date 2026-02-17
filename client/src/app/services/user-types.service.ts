import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type RoleTypeItem = {
  id: number;
  name: string;
};

@Injectable({ providedIn: 'root' })
export class RoleTypesService {
  private readonly apiBase = 'http://localhost:3001';

  constructor(private readonly http: HttpClient) {}

  async list(): Promise<RoleTypeItem[]> {
    return await firstValueFrom(this.http.get<RoleTypeItem[]>(`${this.apiBase}/role-types`));
  }
}
