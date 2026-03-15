import { Type } from '@angular/core';
import { Routes } from '@angular/router';
import { adminChildGuard, adminGuard } from './core/admin.guard';
import { splashLandingGuard } from './core/splash-landing.guard';
import { homeGuard } from './core/home.guard';
import { myCasesGuard } from './core/my-cases.guard';
import { registerGuard } from './core/register.guard';
import { affidavitEditGuard } from './core/affidavit-edit.guard';
import { childSupportWorksheetEditGuard } from './core/child-support-worksheet-edit.guard';
import { upcomingEventsGuard } from './core/upcoming-events.guard';
import { messagesGuard } from './core/messages.guard';
import { queryGuard } from './core/query.guard';

export const routes: Routes = [
	{
		path: '',
		pathMatch: 'full',
		canActivate: [splashLandingGuard],
		loadChildren: () => import('./pages/landing/landing.module').then((m) => m.LandingModule)
	},
	{
		path: 'home',
		canActivate: [homeGuard],
		loadChildren: () => import('./pages/home/home.module').then((m) => m.HomeModule)
	},
	{
		path: 'login',
		loadChildren: () => import('./pages/login/login.module').then((m) => m.LoginModule)
	},
	{
		path: 'demo',
		loadChildren: () =>
			import('./pages/demo/demo-public.module').then((m: { DemoModule?: unknown; default?: unknown }) => {
				const mod = m.DemoModule ?? m.default;
				if (!mod) throw new Error('Demo module not found');
				return mod as Type<unknown>;
			})
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
		path: 'child-support-worksheet',
		loadChildren: () =>
			import('./pages/child-support-worksheet/child-support-worksheet.module').then((m) => m.ChildSupportWorksheetModule)
	},
	{
		path: 'child-support-worksheet/edit',
		canActivate: [childSupportWorksheetEditGuard],
		loadChildren: () =>
			import('./pages/child-support-worksheet-edit/child-support-worksheet-edit.module').then((m) => m.ChildSupportWorksheetEditModule)
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
		path: 'messages',
		canActivate: [messagesGuard],
		loadChildren: () =>
			import('./pages/messages/messages.module').then((m) => m.MessagesModule)
	},
	{
		path: 'documents',
		canActivate: [homeGuard],
		loadChildren: () =>
			import('./pages/documents/documents.module').then((m) => m.DocumentsModule)
	},
	{
		path: 'query',
		canActivate: [queryGuard],
		loadChildren: () =>
			import('./pages/query/query.module').then((m) => m.QueryModule)
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
