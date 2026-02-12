import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AttendanceRecord {
  id: number;
  name: string;
  timestamp: string;
}

export interface EmbeddingResult {
  fileName: string;
  embedding: number[];
  dimensions: number;
}

export interface EmbeddingExtractResponse {
  results: EmbeddingResult[];
  errors: string[];
}

export interface RegisterEmployeePayload {
  name: string;
  employee_id: string;
  image: string;
}

export interface RegisterEmployeeResponse {
  success: boolean;
  message: string;
  employee_id?: string;
  name?: string;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private apiBaseUrl = '/api';

  constructor(private http: HttpClient) {}

  getAttendance(): Observable<AttendanceRecord[]> {
    return this.http.get<AttendanceRecord[]>(`${this.apiBaseUrl}/attendance`);
  }

  extractEmbeddings(files: { name: string; data: string }[]): Observable<EmbeddingExtractResponse> {
    return this.http.post<EmbeddingExtractResponse>(`${this.apiBaseUrl}/embeddings/extract`, { files });
  }

  registerEmployee(payload: RegisterEmployeePayload): Observable<RegisterEmployeeResponse> {
    return this.http.post<RegisterEmployeeResponse>(`${this.apiBaseUrl}/employees/register`, payload);
  }
}
