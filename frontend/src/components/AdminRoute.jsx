import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from "../context/LocaleContext";
import ProtectedRoute from './ProtectedRoute';

const AdminRoute = ({ children }) => {
  const { isAdmin, loading } = useAuth();
  const { select } = useLocale();

  if (loading) {
    return <div>{select("\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644...", "Loading...")}</div>;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" />;
  }

  return <ProtectedRoute>{children}</ProtectedRoute>;
};

export default AdminRoute;
