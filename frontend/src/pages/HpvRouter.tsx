import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Spin } from "antd";
import HpvLayout from "../components/HpvLayout";
import { useAuthStore } from "../store/auth";

const HpvDashboard      = lazy(() => import("./HpvDashboard"));
const HpvSamples        = lazy(() => import("./HpvSamples"));
const HpvReceiving      = lazy(() => import("./HpvReceiving"));
const HpvWorkflow       = lazy(() => import("./HpvWorkflow"));
const HpvReports        = lazy(() => import("./HpvReports"));

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

export default function HpvRouter() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Protected HPV routes */}
        <Route path="/hpv/dashboard"   element={<Protected><HpvLayout><HpvDashboard /></HpvLayout></Protected>} />
        <Route path="/hpv/samples"     element={<Protected><HpvLayout header="Sample Registration"><HpvSamples /></HpvLayout></Protected>} />
        <Route path="/hpv/receiving"   element={<Protected><HpvLayout header="Sample Receiving"><HpvReceiving /></HpvLayout></Protected>} />
        <Route path="/hpv/workflow"    element={<Protected><HpvLayout header="Lab Workflow"><HpvWorkflow /></HpvLayout></Protected>} />
        <Route path="/hpv/reports"     element={<Protected><HpvLayout header="Reports"><HpvReports /></HpvLayout></Protected>} />

        {/* Redirect */}
        <Route path="/hpv" element={<Navigate to="/hpv/dashboard" replace />} />
        <Route path="/hpv/*" element={<Navigate to="/hpv/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
