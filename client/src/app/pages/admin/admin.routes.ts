import { Routes } from '@angular/router';
import { AdminPage } from './admin.page';
import { UsersPage } from '../users/users.page';
import { CasesPage } from '../cases/cases.page';
import { AdminAffidavitPage } from '../admin-affidavit/admin-affidavit.page';
import { AdminQueryPage } from '../admin-query/admin-query.page';
import { ProfilePage } from '../profile/profile.page';
import { adminChildGuard } from '../../core/admin.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminPage,
    canActivateChild: [adminChildGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      { path: 'users', component: UsersPage },
      { path: 'users/:id/profile', component: ProfilePage },
      { path: 'cases', component: CasesPage },
      { path: 'affidavit', component: AdminAffidavitPage },
      { path: 'query', component: AdminQueryPage }
    ]
  }
];
