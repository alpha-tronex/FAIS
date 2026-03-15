import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ChildSupportWorksheetPage } from './child-support-worksheet.page';
import { CHILD_SUPPORT_WORKSHEET_ROUTES } from './child-support-worksheet.routes';

@NgModule({
  declarations: [ChildSupportWorksheetPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(CHILD_SUPPORT_WORKSHEET_ROUTES)
  ]
})
export class ChildSupportWorksheetModule {}
