export interface LogoutConfirmationCopy {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
}

export function buildLogoutConfirmationCopy(t: (key: string) => string): LogoutConfirmationCopy {
  return {
    title: t('logoutConfirmTitle'),
    message: t('logoutConfirmMessage'),
    cancelLabel: t('cancel'),
    confirmLabel: t('logoutButton'),
  };
}
