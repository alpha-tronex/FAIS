import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type EmploymentRow = {
  id: string;
  name: string;
  occupation: string | null;
  payRate: number;
  payFrequencyTypeId: number | null;
  payFrequencyIfOther: string | null;
  retired: boolean;
};

export type MonthlyLineRow = {
  id: string;
  typeId: number | null;
  amount: number;
  ifOther: string | null;
};

export type AssetRow = {
  id: string;
  assetsTypeId: number | null;
  description: string;
  marketValue: number;
  nonMaritalTypeId: number | null;
  judgeAward: boolean;
};

export type LiabilityRow = {
  id: string;
  liabilitiesTypeId: number | null;
  description: string;
  amountOwed: number;
  nonMaritalTypeId: number | null;
  userOwes: boolean;
};

@Injectable({ providedIn: 'root' })
export class AffidavitDataService {
  private readonly apiBase = 'http://localhost:3001';

  constructor(private readonly http: HttpClient) {}

  private qp(userId?: string): string {
    return userId ? `?userId=${encodeURIComponent(userId)}` : '';
  }

  async listEmployment(userId?: string): Promise<EmploymentRow[]> {
    return await firstValueFrom(this.http.get<EmploymentRow[]>(`${this.apiBase}/affidavit/employment${this.qp(userId)}`));
  }

  async createEmployment(
    req: { name: string; occupation?: string; payRate: number; payFrequencyTypeId: number; payFrequencyIfOther?: string; retired?: boolean },
    userId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/employment${this.qp(userId)}`, req));
  }

  async deleteEmployment(id: string, userId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/employment/${id}${this.qp(userId)}`));
  }

  async patchEmployment(
    id: string,
    req: Partial<{
      name: string;
      occupation: string | null;
      payRate: number;
      payFrequencyTypeId: number;
      payFrequencyIfOther: string | null;
      retired: boolean;
    }>,
    userId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/employment/${id}${this.qp(userId)}`, req));
  }

  async listMonthlyIncome(userId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-income${this.qp(userId)}`));
  }

  async createMonthlyIncome(req: { typeId: number; amount: number; ifOther?: string }, userId?: string): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-income${this.qp(userId)}`, req));
  }

  async deleteMonthlyIncome(id: string, userId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-income/${id}${this.qp(userId)}`));
  }

  async patchMonthlyIncome(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-income/${id}${this.qp(userId)}`,
        req
      )
    );
  }

  async listMonthlyDeductions(userId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-deductions${this.qp(userId)}`));
  }

  async createMonthlyDeductions(req: { typeId: number; amount: number; ifOther?: string }, userId?: string): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-deductions${this.qp(userId)}`, req));
  }

  async deleteMonthlyDeductions(id: string, userId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-deductions/${id}${this.qp(userId)}`));
  }

  async patchMonthlyDeductions(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-deductions/${id}${this.qp(userId)}`,
        req
      )
    );
  }

  async listMonthlyHouseholdExpenses(userId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-household-expenses${this.qp(userId)}`));
  }

  async createMonthlyHouseholdExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-household-expenses${this.qp(userId)}`, req)
    );
  }

  async deleteMonthlyHouseholdExpenses(id: string, userId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-household-expenses/${id}${this.qp(userId)}`)
    );
  }

  async patchMonthlyHouseholdExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-household-expenses/${id}${this.qp(userId)}`,
        req
      )
    );
  }

  async listAssets(userId?: string): Promise<AssetRow[]> {
    return await firstValueFrom(this.http.get<AssetRow[]>(`${this.apiBase}/affidavit/assets${this.qp(userId)}`));
  }

  async createAsset(
    req: { assetsTypeId: number; description: string; marketValue: number; nonMaritalTypeId?: number; judgeAward?: boolean },
    userId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/assets${this.qp(userId)}`, req));
  }

  async deleteAsset(id: string, userId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/assets/${id}${this.qp(userId)}`));
  }

  async patchAsset(
    id: string,
    req: Partial<{
      assetsTypeId: number;
      description: string;
      marketValue: number;
      nonMaritalTypeId: number | null;
      judgeAward: boolean;
    }>,
    userId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/assets/${id}${this.qp(userId)}`, req));
  }

  async listLiabilities(userId?: string): Promise<LiabilityRow[]> {
    return await firstValueFrom(this.http.get<LiabilityRow[]>(`${this.apiBase}/affidavit/liabilities${this.qp(userId)}`));
  }

  async createLiability(
    req: { liabilitiesTypeId: number; description: string; amountOwed: number; nonMaritalTypeId?: number; userOwes?: boolean },
    userId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/liabilities${this.qp(userId)}`, req));
  }

  async deleteLiability(id: string, userId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/liabilities/${id}${this.qp(userId)}`));
  }

  async patchLiability(
    id: string,
    req: Partial<{
      liabilitiesTypeId: number;
      description: string;
      amountOwed: number;
      nonMaritalTypeId: number | null;
      userOwes: boolean;
    }>,
    userId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/liabilities/${id}${this.qp(userId)}`, req));
  }
}
