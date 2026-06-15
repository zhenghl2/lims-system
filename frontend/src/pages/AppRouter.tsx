import { Routes, Route, Navigate } from "react-router-dom";

import { lazy, Suspense } from "react";

import { Spin } from "antd";

import AuthLayout from "../components/AuthLayout";

import DashboardLayout from "../components/DashboardLayout";

import { useAuthStore } from "../store/auth";



// Lazy-loaded pages — all real implementations

const Login           = lazy(() => import("./Login"));


const NiptSamples     = lazy(() => import("./NiptSamples"));

const NiptReceiving   = lazy(() => import("./NiptReceiving"));
const NiptPlasmaSep   = lazy(() => import("./NiptPlasmaSeparation"));

const NiptWorkflow    = lazy(() => import("./NiptWorkflow"));
const NiptDashboard   = lazy(() => import("./NiptDashboard"));
const NiptReports     = lazy(() => import("./NiptReports"));
const Instruments     = lazy(() => import("./Instruments"));

const Reagents        = lazy(() => import("./Reagents"));

const QC              = lazy(() => import("./QC"));

const Documents       = lazy(() => import("./Documents"));

const Training        = lazy(() => import("./Training"));

const Bioinformatics  = lazy(() => import("./Bioinformatics"));

const Quality         = lazy(() => import("./Quality"));

const AuditLog        = lazy(() => import("./AuditLog"));

const Notifications   = lazy(() => import("./Notifications"));



// Loading fallback

const PageLoading = () => (

  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>

    <Spin size="large" tip="Loading..." />

  </div>

);



// Auth guard

const Protected = ({ children }: { children: React.ReactNode }) => {

  const isAuthenticated = !!useAuthStore(s => s.accessToken);

  const initialized = useAuthStore(s => s.initialized);

  if (!initialized) return <PageLoading />;

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;


};



export default function AppRouter() {

  return (

    <Suspense fallback={<PageLoading />}>

      <Routes>

        {/* Public */}

        <Route path="/login" element={<AuthLayout><Login /></AuthLayout>} />



        {/* Protected — fully implemented */}

        <Route path="/"       element={<Protected><DashboardLayout><NiptDashboard /></DashboardLayout></Protected>} />

        <Route path="/samples"   element={<Protected><DashboardLayout><NiptSamples /></DashboardLayout></Protected>} />

        <Route path="/receiving" element={<Protected><DashboardLayout><NiptReceiving /></DashboardLayout></Protected>} />
        <Route path="/plasma-separation" element={<Protected><DashboardLayout><NiptPlasmaSep /></DashboardLayout></Protected>} />


        <Route path="/instruments" element={<Protected><Instruments /></Protected>} />

        <Route path="/reagents"    element={<Protected><Reagents /></Protected>} />



        {/* QC — implemented */}

        <Route path="/qc"   element={<Protected><QC /></Protected>} />



        {/* Documents, Training, Bioinformatics — now implemented */}

        <Route path="/documents"      element={<Protected><Documents /></Protected>} />

        <Route path="/training"       element={<Protected><Training /></Protected>} />

        <Route path="/bioinformatics" element={<Protected><Bioinformatics /></Protected>} />



        {/* Quality, Audit, Notifications — now implemented */}

        <Route path="/quality"           element={<Protected><Quality /></Protected>} />

        <Route path="/audit"             element={<Protected><AuditLog /></Protected>} />

        <Route path="/notifications"     element={<Protected><Notifications /></Protected>} />



        <Route path="/workflow"   element={<Protected><NiptWorkflow /></Protected>} />
        <Route path="/dashboard-nipt" element={<Protected><DashboardLayout><NiptDashboard /></DashboardLayout></Protected>} />
        <Route path="/reports-nipt"   element={<Protected><DashboardLayout><NiptReports /></DashboardLayout></Protected>} />


        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>

    </Suspense>

  );

}