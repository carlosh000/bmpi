export function resolveStoredAuthToken(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const localToken = window.localStorage.getItem('bmpi_auth_token');
    if (localToken && localToken.trim() !== '') {
      return localToken.trim();
    }
    const token = window.sessionStorage.getItem('bmpi_auth_token');
    return token?.trim() ?? '';
  } catch {
    return '';
  }
}
