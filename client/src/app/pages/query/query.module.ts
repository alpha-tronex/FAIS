import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AdminModule } from '../admin/admin.module';
import { QUERY_ROUTES } from './query.routes';

@NgModule({
  imports: [AdminModule, RouterModule.forChild(QUERY_ROUTES)]
})
export class QueryModule {}
