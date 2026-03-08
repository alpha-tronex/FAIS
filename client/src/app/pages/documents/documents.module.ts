import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DocumentsPage } from './documents.page';
import { DOCUMENTS_ROUTES } from './documents.routes';

@NgModule({
  declarations: [DocumentsPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(DOCUMENTS_ROUTES)
  ]
})
export class DocumentsModule {}
