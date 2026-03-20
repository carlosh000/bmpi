import { HttpErrorResponse } from '@angular/common/http';

export function extractHttpErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return 'Sin conexion con backend/proxy. Verifica que el stack este arriba (frontend 4200 y backend 8080).';
    }
    const statusPart = err.status ? `status ${err.status}` : 'sin status';
    if (typeof err.error === 'string' && err.error.trim()) {
      return `${err.error.trim()} (${statusPart})`;
    }
    if (err.error && typeof err.error.message === 'string' && err.error.message.trim()) {
      return `${err.error.message.trim()} (${statusPart})`;
    }
    if (err.message?.trim()) {
      return `${err.message.trim()} (${statusPart})`;
    }
    return `Error de backend (${statusPart})`;
  }

  const asError = err as Error;
  if (asError?.message?.trim()) {
    return asError.message.trim();
  }
  return '';
}
