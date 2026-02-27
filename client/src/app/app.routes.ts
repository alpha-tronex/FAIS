import { Routes } from '@angular/router';
import { adminChildGuard, adminGuard } from './core/admin.guard';
import { landingGuard } from './core/landing.guard';
import { myCasesGuard } from './core/my-cases.guard';
import { registerGuard } from './core/register.guard';
import { affidavitEditGuard } from './core/affidavit-edit.guard';
import { upcomingEventsGuard } from './core/upcoming-events.guard';

export const routes: Routes = [
	{
		path: '',
		pathMatch: 'full',
		canActivate: [landingGuard],
		loadChildren: () => import('./pages/login/login.module').then((m) => m.LoginModule)
	},
	{
		path: 'login',
		loadChildren: () => import('./pages/login/login.module').then((m) => m.LoginModule)
	},
	{
		path: 'register',
		canActivate: [registerGuard],
		loadChildren: () => import('./pages/register/register.module').then((m) => m.RegisterModule)
	},
	{
		path: 'reset',
		loadChildren: () => import('./pages/reset/reset.module').then((m) => m.ResetModule)
	},
	{
		path: 'forgot-password',
		loadChildren: () =>
			import('./pages/forgot-password/forgot-password.module').then((m) => m.ForgotPasswordModule)
	},
	{
		path: 'reset-password',
		loadChildren: () =>
			import('./pages/reset-password/reset-password.module').then((m) => m.ResetPasswordModule)
	},
	{
		path: 'my-cases',
		canActivate: [myCasesGuard],
		loadChildren: () => import('./pages/my-cases/my-cases.module').then((m) => m.MyCasesModule)
	},
	{
		path: 'affidavit',
		loadChildren: () =>
			import('./pages/affidavit/affidavit.module').then((m) => m.AffidavitModule)
	},
	{
		path: 'affidavit/edit',
		canActivate: [affidavitEditGuard],
		loadChildren: () =>
			import('./pages/affidavit-edit/affidavit-edit.module').then((m) => m.AffidavitEditModule)
	},
	{
		path: 'profile',
		loadChildren: () =>
			import('./pages/profile/profile.module').then((m) => m.ProfileModule)
	},
	{
		path: 'upcoming-events',
		canActivate: [upcomingEventsGuard],
		loadChildren: () =>
			import('./pages/upcoming-events/upcoming-events.module').then((m) => m.UpcomingEventsModule)
	},
	{
		path: 'admin',
		canActivate: [adminGuard],
		loadChildren: () => import('./pages/admin/admin.module').then((m) => m.AdminModule)
	},
	{ path: 'users', redirectTo: 'admin/users' },
	{ path: 'cases', redirectTo: 'my-cases' },
	{ path: '**', redirectTo: '' }
];
