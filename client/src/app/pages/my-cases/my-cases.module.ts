import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MyCasesPage } from './my-cases.page';
import { MY_CASES_ROUTES } from './my-cases.routes';

@NgModule({
  declarations: [MyCasesPage],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(MY_CASES_ROUTES)
  ]
})
export class MyCasesModule {}
