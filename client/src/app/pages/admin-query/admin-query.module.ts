import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminQueryPage } from './admin-query.page';

/**
 * Standalone module for the AI query page so it can be used under both /admin/query
 * (admin) and /query (staff/attorney) without pulling in AdminModule's routes.
 */
@NgModule({
  declarations: [AdminQueryPage],
  imports: [CommonModule, FormsModule],
  exports: [AdminQueryPage]
})
export class AdminQueryModule {}
