/**
 * Company Router — nested routes under /:company/*
 *
 * This is the main router for company-scoped pages.
 * Add new feature routes here following the existing pattern.
 *
 * Route structure:
 *   /:company/book-writing    → BookWritingPage
 *   /:company/dashboard       → DashboardPage (when created)
 *   /:company/settings        → SettingsPage (when created)
 */

import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { CompanySidebar } from "@/components/sidebar/CompanySidebar";

// Lazy-load pages for code splitting
const BookWritingPage = lazy(() => import("@/pages/BookWritingPage"));
const GymPage = lazy(() => import("@/pages/GymPage").then((m) => ({ default: m.GymPage })));
const SkillsCatalog = lazy(() =>
  import("@/pages/SkillsCatalog").then((m) => ({ default: m.SkillsCatalog })),
);
const WorldViewPage = lazy(() => import("@/pages/WorldView").then((m) => ({ default: m.WorldView })));

// Placeholder loading component
function PageLoading() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    </div>
  );
}

/**
 * Company-scoped layout with sidebar and main content area.
 */
function CompanyLayout() {
  const { company } = useParams<{ company: string }>();
  return (
    <div className="flex h-full w-full">
      <CompanySidebar companySlug={company} />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Company Router — mounts feature routes under /:company/*
 */
export function CompanyRouter() {
  return (
    <Routes>
      <Route element={<CompanyLayout />}>
        {/* Book Writing feature */}
        <Route path="book-writing" element={
          <Suspense fallback={<PageLoading />}>
            <BookWritingPage />
          </Suspense>
        } />

        {/* Gym / Agent Training */}
        <Route path="gym" element={
          <Suspense fallback={<PageLoading />}>
            <GymPage />
          </Suspense>
        } />

        {/* World View — Global Intelligence */}
        <Route path="world-view" element={
          <Suspense fallback={<PageLoading />}>
            <WorldViewPage />
          </Suspense>
        } />

        {/* Skills — Per-Agent Usage */}
        <Route path="skills" element={
          <Suspense fallback={<PageLoading />}>
            <SkillsCatalog />
          </Suspense>
        } />

        {/* Dashboard (placeholder) */}
        <Route path="dashboard" element={
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center">
              <div className="text-4xl mb-4">📊</div>
              <h2 className="text-lg font-semibold text-gray-100">Dashboard</h2>
              <p className="text-sm text-gray-500 mt-2">Coming soon</p>
            </div>
          </div>
        } />

        {/* Settings (placeholder) */}
        <Route path="settings" element={
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center">
              <div className="text-4xl mb-4">⚙️</div>
              <h2 className="text-lg font-semibold text-gray-100">Settings</h2>
              <p className="text-sm text-gray-500 mt-2">Coming soon</p>
            </div>
          </div>
        } />

        {/* Default redirect to book-writing */}
        <Route index element={<Navigate to="book-writing" replace />} />
        <Route path="*" element={<Navigate to="book-writing" replace />} />
      </Route>
    </Routes>
  );
}

export default CompanyRouter;
