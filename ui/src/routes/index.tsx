/**
 * Main App Router — top-level routing
 *
 * Mounts the CompanyRouter under /:company scope.
 */

import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CompanyRouter } from "@/routes/company-router";

function AppLoading() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="text-sm text-gray-500">Paperclip</span>
      </div>
    </div>
  );
}

/**
 * Root application router.
 */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<AppLoading />}>
        <Routes>
          {/* Company-scoped routes */}
          <Route path="/:company/*" element={<CompanyRouter />} />

          {/* Root redirect to a default company */}
          <Route path="/" element={<Navigate to="/default/book-writing" replace />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/default/book-writing" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default AppRouter;
