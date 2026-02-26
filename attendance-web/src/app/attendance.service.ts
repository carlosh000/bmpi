import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AttendanceRecord {
  row_id?: number;
  id: number;
  name: string;
  timestamp: string;
}

export interface CreateAttendanceRequest {
  employee_id: string;
  name?: string;
  timestamp?: string;
}

export interface UpdateAttendanceRequest {
  employee_id: string;
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

export interface EmployeeRecord {
  employee_id: string;
  name: string;
}

export interface RegisterPhotosRequest {
  employeeName: string;
  employeeId: string;
  files: { name: string; data: string }[];
}

export interface RegisterPhotosResponse {
  saved: { employeeId: string; employeeName: string; photosProcessed: number; failedPhotos: number }[];
  errors: string[];
  qualityWarnings?: string[];
}

export interface EmployeeStorageRecord {
  employee_id: string;
  name: string;
  embedding_bytes: number;
  photo_bytes: number;
  photo_data_url: string;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private apiBaseUrl = '/api';

  constructor(private http: HttpClient) {}

  getAttendance(date?: string): Observable<AttendanceRecord[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return this.http.get<AttendanceRecord[]>(`${this.apiBaseUrl}/attendance${query}`);
  }

  createAttendance(payload: CreateAttendanceRequest): Observable<AttendanceRecord> {
    return this.http.post<AttendanceRecord>(`${this.apiBaseUrl}/attendance`, payload);
  }

  updateAttendance(rowId: number, payload: UpdateAttendanceRequest): Observable<AttendanceRecord> {
    return this.http.put<AttendanceRecord>(`${this.apiBaseUrl}/attendance/${rowId}`, payload);
  }

  deleteAttendance(rowId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiBaseUrl}/attendance/${rowId}`);
  }

  getEmployees(): Observable<EmployeeRecord[]> {
    return this.http.get<EmployeeRecord[]>(`${this.apiBaseUrl}/employees`);
  }

  extractEmbeddings(files: { name: string; data: string }[]): Observable<EmbeddingExtractResponse> {
    return this.http.post<EmbeddingExtractResponse>(`${this.apiBaseUrl}/embeddings/extract`, { files });
  }

  registerEmployeePhotos(payload: RegisterPhotosRequest): Observable<RegisterPhotosResponse> {
    return this.http.post<RegisterPhotosResponse>(`${this.apiBaseUrl}/employees/register-photos`, payload);
  }

  getEmployeeStorage(): Observable<EmployeeStorageRecord[]> {
    return this.http.get<EmployeeStorageRecord[]>(`${this.apiBaseUrl}/employees/storage`);
  }
}
