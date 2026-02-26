import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AffidavitPage } from './affidavit.page';
import { AFFIDAVIT_ROUTES } from './affidavit.routes';

@NgModule({
  declarations: [AffidavitPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(AFFIDAVIT_ROUTES)
  ]
})
export class AffidavitModule {}
