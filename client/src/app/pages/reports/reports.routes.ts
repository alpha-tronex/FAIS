import { Routes } from '@angular/router';
import { ReportStructuredPage } from './report-structured/report-structured.page';
import { ReportNaturalPage } from './report-natural/report-natural.page';

export const REPORTS_ROUTES: Routes = [
  { path: 'structured', component: ReportStructuredPage },
  { path: 'natural', component: ReportNaturalPage },
  { path: '', pathMatch: 'full', redirectTo: 'structured' },
];
