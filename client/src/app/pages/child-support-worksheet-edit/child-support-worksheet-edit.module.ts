import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ChildSupportWorksheetEditPage } from './child-support-worksheet-edit.page';
import { CHILD_SUPPORT_WORKSHEET_EDIT_ROUTES } from './child-support-worksheet-edit.routes';

@NgModule({
  declarations: [ChildSupportWorksheetEditPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(CHILD_SUPPORT_WORKSHEET_EDIT_ROUTES)
  ]
})
export class ChildSupportWorksheetEditModule {}
