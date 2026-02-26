import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminPage } from './admin.page';
import { UsersPage } from '../users/users.page';
import { CasesPage } from '../cases/cases.page';
import { AdminAffidavitPage } from '../admin-affidavit/admin-affidavit.page';
import { ProfileModule } from '../profile/profile.module';
import { AffidavitEditModule } from '../affidavit-edit/affidavit-edit.module';
import { SharedModule } from '../../shared/shared.module';
import { ADMIN_ROUTES } from './admin.routes';

@NgModule({
  declarations: [AdminPage, UsersPage, CasesPage, AdminAffidavitPage],
  imports: [
    CommonModule,
    FormsModule,
    ProfileModule,
    AffidavitEditModule,
    SharedModule,
    RouterModule.forChild(ADMIN_ROUTES)
  ]
})
export class AdminModule {}
