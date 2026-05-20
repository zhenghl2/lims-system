import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Spin } from "antd";
import NipptLayout from "../components/NipptLayout";
import { useAuthStore } from "../store/auth";

const NipptDashboard   = lazy(() => import("./NipptDashboard"));
const Cases            = lazy(() => import("./Cases"));
const NipptRegistration = lazy(() => import("./NipptRegistration"));
const SampleReceiving  = lazy(() => import("./SampleReceiving"));
const LabWorkflow      = lazy(() => import("./LabWorkflow"));
const NipptReports     = lazy(() => import("./NipptReports"));
const PublicRegister   = lazy(() => import("./PublicRegister"));

const PageLoading = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200 }}>
    <Spin size="large" />
  </div>
);

const Protected = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = !!useAuthStore(s => s.accessToken);
  const initialized = useAuthStore(s => s.initialized);
  if (!initialized) return <PageLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
};

export default function NipptRouter() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Public registration (no auth) */}
        <Route path="/register/:token" element={<PublicRegister />} />

        {/* Protected NIPPT routes */}
        <Route path="/nippt/dashboard"    element={<Protected><NipptLayout><NipptDashboard /></NipptLayout></Protected>} />
        <Route path="/nippt/cases"        element={<Protected><NipptLayout><Cases /></NipptLayout></Protected>} />
        <Route path="/nippt/cases/:id"    element={<Protected><NipptLayout><Cases /></NipptLayout></Protected>} />
        <Route path="/nippt/registration"  element={<Protected><NipptLayout header="Sample Registration"><NipptRegistration /></NipptLayout></Protected>} />
        <Route path="/nippt/receiving"     element={<Protected><NipptLayout><SampleReceiving /></NipptLayout></Protected>} />
        <Route path="/nippt/workflow"      element={<Protected><NipptLayout><LabWorkflow /></NipptLayout></Protected>} />
        <Route path="/nippt/reports"       element={<Protected><NipptLayout><NipptReports /></NipptLayout></Protected>} />

        {/* Redirect */}
        <Route path="/nippt" element={<Navigate to="/nippt/dashboard" replace />} />
        <Route path="/nippt/*" element={<Navigate to="/nippt/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
