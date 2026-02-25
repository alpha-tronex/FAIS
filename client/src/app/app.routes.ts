import { Routes } from '@angular/router';
import { LoginPage } from './pages/login/login.page';
import { RegisterPage } from './pages/register/register.page';
import { ResetPage } from './pages/reset/reset.page';
import { ForgotPasswordPage } from './pages/forgot-password/forgot-password.page';
import { ResetPasswordPage } from './pages/reset-password/reset-password.page';
import { UsersPage } from './pages/users/users.page';
import { CasesPage } from './pages/cases/cases.page';
import { MyCasesPage } from './pages/my-cases/my-cases.page';
import { AffidavitPage } from './pages/affidavit/affidavit.page';
import { AffidavitEditPage } from './pages/affidavit-edit/affidavit-edit.page';
import { ProfilePage } from './pages/profile/profile.page';
import { AdminPage } from './pages/admin/admin.page';
import { AdminAffidavitPage } from './pages/admin-affidavit/admin-affidavit.page';
import { adminChildGuard, adminGuard } from './core/admin.guard';
import { landingGuard } from './core/landing.guard';
import { myCasesGuard } from './core/my-cases.guard';
import { registerGuard } from './core/register.guard';
import { affidavitEditGuard } from './core/affidavit-edit.guard';

export const routes: Routes = [
	{ path: '', pathMatch: 'full', canActivate: [landingGuard], component: LoginPage },
	{ path: 'login', component: LoginPage },
	{ path: 'register', component: RegisterPage, canActivate: [registerGuard] },
	{ path: 'reset', component: ResetPage },
	{ path: 'forgot-password', component: ForgotPasswordPage },
	{ path: 'reset-password', component: ResetPasswordPage },
	{ path: 'my-cases', component: MyCasesPage, canActivate: [myCasesGuard] },
	{ path: 'affidavit', component: AffidavitPage },
	{ path: 'affidavit/edit', component: AffidavitEditPage, canActivate: [affidavitEditGuard] },
	{ path: 'profile', component: ProfilePage },
	{
		path: 'admin',
		component: AdminPage,
		canActivate: [adminGuard],
		canActivateChild: [adminChildGuard],
		children: [
			{ path: '', pathMatch: 'full', redirectTo: 'users' },
			{ path: 'users', component: UsersPage },
			{ path: 'users/:id/profile', component: ProfilePage },
			{ path: 'cases', component: CasesPage },
			{ path: 'affidavit', component: AdminAffidavitPage }
		]
	},
	{ path: 'users', redirectTo: 'admin/users' },
	{ path: 'cases', redirectTo: 'my-cases' },
	{ path: '**', redirectTo: '' }
];
