import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type RoleTypeItem = {
  id: number;
  name: string;
};

@Injectable({ providedIn: 'root' })
export class RoleTypesService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  async list(): Promise<RoleTypeItem[]> {
    return await firstValueFrom(this.http.get<RoleTypeItem[]>(`${this.apiBase}/role-types`));
  }
}
