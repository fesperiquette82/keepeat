import React from 'react';
import { Redirect, Slot } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { isAdminUser } from '../../utils/adminAccess';

export default function AdminLayout() {
  const user = useAuthStore((state) => state.user);
  const isLoaded = useAuthStore((state) => state.isLoaded);

  if (!isLoaded) return null;
  if (!user) return <Redirect href="/login" />;
  if (!isAdminUser(user)) return <Redirect href="/settings" />;

  return <Slot />;
}
