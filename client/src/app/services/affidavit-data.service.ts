import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

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

export type ContingentAssetRow = {
  id: string;
  description: string;
  possibleValue: number;
  nonMaritalTypeId: number | null;
  judgeAward: boolean;
};

export type ContingentLiabilityRow = {
  id: string;
  description: string;
  possibleAmountOwed: number;
  nonMaritalTypeId: number | null;
  userOwes: boolean;
};

@Injectable({ providedIn: 'root' })
export class AffidavitDataService {
  private readonly apiBase = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  private qp(userId?: string, caseId?: string): string {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (caseId) params.set('caseId', caseId);
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  async listEmployment(userId?: string, caseId?: string): Promise<EmploymentRow[]> {
    return await firstValueFrom(this.http.get<EmploymentRow[]>(`${this.apiBase}/affidavit/employment${this.qp(userId, caseId)}`));
  }

  async createEmployment(
    req: { name: string; occupation?: string; payRate: number; payFrequencyTypeId: number; payFrequencyIfOther?: string; retired?: boolean },
    userId?: string,
    caseId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/employment${this.qp(userId, caseId)}`, req));
  }

  async deleteEmployment(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/employment/${id}${this.qp(userId, caseId)}`));
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
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/employment/${id}${this.qp(userId, caseId)}`, req));
  }

  async listMonthlyIncome(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-income${this.qp(userId, caseId)}`));
  }

  async createMonthlyIncome(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-income${this.qp(userId, caseId)}`, req));
  }

  async deleteMonthlyIncome(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-income/${id}${this.qp(userId, caseId)}`));
  }

  async patchMonthlyIncome(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-income/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyDeductions(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-deductions${this.qp(userId, caseId)}`));
  }

  async createMonthlyDeductions(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-deductions${this.qp(userId, caseId)}`, req));
  }

  async deleteMonthlyDeductions(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-deductions/${id}${this.qp(userId, caseId)}`));
  }

  async patchMonthlyDeductions(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-deductions/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyHouseholdExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-household-expenses${this.qp(userId, caseId)}`));
  }

  async createMonthlyHouseholdExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-household-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyHouseholdExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-household-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyHouseholdExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-household-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyAutomobileExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-automobile-expenses${this.qp(userId, caseId)}`));
  }

  async createMonthlyAutomobileExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-automobile-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyAutomobileExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-automobile-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyAutomobileExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-automobile-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyChildrenExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-children-expenses${this.qp(userId, caseId)}`));
  }

  async createMonthlyChildrenExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-children-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyChildrenExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-children-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyChildrenExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-children-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyChildrenOtherExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(
      this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-children-other-expenses${this.qp(userId, caseId)}`)
    );
  }

  async createMonthlyChildrenOtherExpenses(
    req: { typeId: number; amount: number; ifOther?: string },
    userId?: string,
    caseId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-children-other-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyChildrenOtherExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-children-other-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyChildrenOtherExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-children-other-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyCreditorsExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-creditors-expenses${this.qp(userId, caseId)}`));
  }

  async createMonthlyCreditorsExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-creditors-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyCreditorsExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-creditors-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyCreditorsExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-creditors-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyInsuranceExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(
      this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-insurance-expenses${this.qp(userId, caseId)}`)
    );
  }

  async createMonthlyInsuranceExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-insurance-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyInsuranceExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-insurance-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyInsuranceExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-insurance-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listMonthlyOtherExpenses(userId?: string, caseId?: string): Promise<MonthlyLineRow[]> {
    return await firstValueFrom(
      this.http.get<MonthlyLineRow[]>(`${this.apiBase}/affidavit/monthly-other-expenses${this.qp(userId, caseId)}`)
    );
  }

  async createMonthlyOtherExpenses(req: { typeId: number; amount: number; ifOther?: string }, userId?: string, caseId?: string): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/monthly-other-expenses${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteMonthlyOtherExpenses(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/monthly-other-expenses/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchMonthlyOtherExpenses(
    id: string,
    req: { typeId?: number; amount?: number; ifOther?: string | null },
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/monthly-other-expenses/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }

  async listAssets(userId?: string, caseId?: string): Promise<AssetRow[]> {
    return await firstValueFrom(this.http.get<AssetRow[]>(`${this.apiBase}/affidavit/assets${this.qp(userId, caseId)}`));
  }

  async createAsset(
    req: { assetsTypeId: number; description: string; marketValue: number; nonMaritalTypeId?: number; judgeAward?: boolean },
    userId?: string,
    caseId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/assets${this.qp(userId, caseId)}`, req));
  }

  async deleteAsset(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/assets/${id}${this.qp(userId, caseId)}`));
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
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/assets/${id}${this.qp(userId, caseId)}`, req));
  }

  async listLiabilities(userId?: string, caseId?: string): Promise<LiabilityRow[]> {
    return await firstValueFrom(this.http.get<LiabilityRow[]>(`${this.apiBase}/affidavit/liabilities${this.qp(userId, caseId)}`));
  }

  async createLiability(
    req: { liabilitiesTypeId: number; description: string; amountOwed: number; nonMaritalTypeId?: number; userOwes?: boolean },
    userId?: string,
    caseId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(this.http.post<{ id: string }>(`${this.apiBase}/affidavit/liabilities${this.qp(userId, caseId)}`, req));
  }

  async deleteLiability(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/liabilities/${id}${this.qp(userId, caseId)}`));
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
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/liabilities/${id}${this.qp(userId, caseId)}`, req));
  }

  async listContingentAssets(userId?: string, caseId?: string): Promise<ContingentAssetRow[]> {
    return await firstValueFrom(
      this.http.get<ContingentAssetRow[]>(`${this.apiBase}/affidavit/contingent-assets${this.qp(userId, caseId)}`)
    );
  }

  async createContingentAsset(
    req: {
      description: string;
      possibleValue: number;
      nonMaritalTypeId?: number | null;
      judgeAward?: boolean;
    },
    userId?: string,
    caseId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/contingent-assets${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteContingentAsset(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/contingent-assets/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchContingentAsset(
    id: string,
    req: Partial<{
      description: string;
      possibleValue: number;
      nonMaritalTypeId?: number | null;
      judgeAward?: boolean;
    }>,
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(`${this.apiBase}/affidavit/contingent-assets/${id}${this.qp(userId, caseId)}`, req)
    );
  }

  async listContingentLiabilities(userId?: string, caseId?: string): Promise<ContingentLiabilityRow[]> {
    return await firstValueFrom(
      this.http.get<ContingentLiabilityRow[]>(`${this.apiBase}/affidavit/contingent-liabilities${this.qp(userId, caseId)}`)
    );
  }

  async createContingentLiability(
    req: {
      description: string;
      possibleAmountOwed: number;
      nonMaritalTypeId?: number | null;
      userOwes?: boolean;
    },
    userId?: string,
    caseId?: string
  ): Promise<{ id: string }> {
    return await firstValueFrom(
      this.http.post<{ id: string }>(`${this.apiBase}/affidavit/contingent-liabilities${this.qp(userId, caseId)}`, req)
    );
  }

  async deleteContingentLiability(id: string, userId?: string, caseId?: string): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.delete<{ ok: boolean }>(`${this.apiBase}/affidavit/contingent-liabilities/${id}${this.qp(userId, caseId)}`)
    );
  }

  async patchContingentLiability(
    id: string,
    req: Partial<{
      description: string;
      possibleAmountOwed: number;
      nonMaritalTypeId?: number | null;
      userOwes?: boolean;
    }>,
    userId?: string,
    caseId?: string
  ): Promise<{ ok: boolean }> {
    return await firstValueFrom(
      this.http.patch<{ ok: boolean }>(
        `${this.apiBase}/affidavit/contingent-liabilities/${id}${this.qp(userId, caseId)}`,
        req
      )
    );
  }
}
