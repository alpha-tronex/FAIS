import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ReportStructuredPage } from './report-structured/report-structured.page';
import { ReportNaturalPage } from './report-natural/report-natural.page';
import { REPORTS_ROUTES } from './reports.routes';

@NgModule({
  declarations: [ReportStructuredPage, ReportNaturalPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(REPORTS_ROUTES),
  ],
})
export class ReportsModule {}
