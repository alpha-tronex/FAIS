import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AdminQueryModule } from '../admin-query/admin-query.module';
import { QUERY_ROUTES } from './query.routes';

@NgModule({
  imports: [AdminQueryModule, RouterModule.forChild(QUERY_ROUTES)]
})
export class QueryModule {}
