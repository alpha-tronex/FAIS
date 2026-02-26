import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AffidavitEditPage } from './affidavit-edit.page';
import { AffidavitEmploymentSectionComponent } from './sections/affidavit-employment-section.component';
import { AffidavitMonthlyLinesSectionComponent } from './sections/affidavit-monthly-lines-section.component';
import { AffidavitAssetsSectionComponent } from './sections/affidavit-assets-section.component';
import { AffidavitLiabilitiesSectionComponent } from './sections/affidavit-liabilities-section.component';
import { AffidavitContingentAssetsSectionComponent } from './sections/affidavit-contingent-assets-section.component';
import { AffidavitContingentLiabilitiesSectionComponent } from './sections/affidavit-contingent-liabilities-section.component';
import { SharedModule } from '../../shared/shared.module';
import { AFFIDAVIT_EDIT_ROUTES } from './affidavit-edit.routes';

@NgModule({
  declarations: [
    AffidavitEditPage,
    AffidavitEmploymentSectionComponent,
    AffidavitMonthlyLinesSectionComponent,
    AffidavitAssetsSectionComponent,
    AffidavitLiabilitiesSectionComponent,
    AffidavitContingentAssetsSectionComponent,
    AffidavitContingentLiabilitiesSectionComponent
  ],
  exports: [AffidavitEditPage],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild(AFFIDAVIT_EDIT_ROUTES)
  ]
})
export class AffidavitEditModule {}
