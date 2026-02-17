import type * as mssqlTypes from 'mssql';

export type MssqlModule = typeof mssqlTypes;

export async function loadMssql(): Promise<MssqlModule> {
  const mod: any = await import('mssql');
  return (mod?.default ?? mod) as MssqlModule;
}
